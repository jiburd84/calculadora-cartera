// Calculadora de Cartera Sugerida — interfaz web. Desarrollada por Ignacio Burd.
import * as N from "./nucleo.js";

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/";
const CLAVE = "calc_cartera_sugerida_v1";
const $ = id => document.getElementById(id);

// ----------------------------------------------------------------------------- estado
let est = {
  activos: [],          // {ticker, tipo, objetivo, cantidad, valorArs, precioManual}
  sugerida: null,       // {categorias, activos}
  paso1: "", paso2: "", paso2Alerta: false,
  monto: "", modo: "comprar", comision: 0.5, ultimo: false, avisos: [],
};
let cot = {};           // cotizaciones {TICKER:{tipo,c,ask,bid}}
let horaPrecios = null;
let resultado = null;

function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify(est)); } catch (e) { /* sin almacenamiento */ } }
function cargar() {
  try { const d = JSON.parse(localStorage.getItem(CLAVE) || "null"); if (d) est = { ...est, ...d }; return !!d; }
  catch (e) { return false; }
}

// ----------------------------------------------------------------------------- utilidades UI
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("ver");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("ver"), 2600);
}
function estado(n, txt, clase = "") { const e = $("est" + n); e.textContent = txt; e.className = "estado " + clase; }
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function guia() {
  const p1 = !!est.sugerida, p2 = !!est.paso2, monto = N.numAR(est.monto) || 0;
  let txt, actual;
  if (!p1) { actual = 1; txt = "👉 Paso 1: tocá «Elegir PDF» y abrí el informe de cartera sugerida."; }
  else if (!p2) { actual = 2; txt = "👉 Paso 2: elegí la captura de tu cartera en la app del broker."; }
  else if (!monto && est.modo === "comprar") { actual = 3; txt = "👉 Paso 3: escribí cuánto vas a invertir y tocá CALCULAR."; }
  else if (!resultado) { actual = 3; txt = "👉 Tocá CALCULAR."; }
  else { actual = 0; txt = "✅ Listo: cargá las órdenes en tu broker. Si cambiás el monto o el modo, se recalcula solo."; }
  $("guia").textContent = txt;
  [1, 2, 3].forEach(n => {
    const s = $("paso" + n);
    const hecho = (n === 1 && p1) || (n === 2 && p2) || (n === 3 && !!resultado);
    s.classList.toggle("hecho", hecho);
    s.classList.toggle("actual", !hecho && n === actual);
    s.querySelector(".num").textContent = hecho ? "✓" : n;
  });
}

// ----------------------------------------------------------------------------- precios
async function actualizarPrecios() {
  $("estPrecios").textContent = "Actualizando precios…";
  try {
    cot = await N.descargarCotizaciones();
    horaPrecios = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    $("estPrecios").textContent = `Precios de las ${horaPrecios} · ${Object.keys(cot).length} especies`;
    $("catalogo").innerHTML = Object.keys(cot).sort().map(s => `<option value="${s}">${cot[s].tipo}</option>`).join("");
  } catch (e) {
    $("estPrecios").textContent = "⚠ No se pudieron traer precios. Revisá la conexión y tocá ⟳";
  }
  aplicarPrecios();
  if (resultado) calcularUI(true);
}

function aplicarPrecios() {
  for (const a of est.activos) {
    a.precio = a.precioManual || N.elegirPrecio(cot[a.ticker], est.ultimo ? "ultimo" : "ask");
    if (cot[a.ticker]) a.tipo = cot[a.ticker].tipo;
    if (a.valorArs && !a.cantidad && a.precio) { a.cantidad = Math.round(a.valorArs / N.precioUnit(a)); a.valorArs = null; }
  }
  dibujarFilas();
}

// ----------------------------------------------------------------------------- paso 1: PDF
let pdfjs = null;
async function cargarPdf(file) {
  estado(1, "⏳ Leyendo el PDF…");
  try {
    if (!pdfjs) {
      pdfjs = await import(PDFJS + "pdf.min.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
    }
    const sug = await N.leerPdf(pdfjs, new Uint8Array(await file.arrayBuffer()));
    if (!sug.activos.length && !sug.categorias.length) {
      estado(1, "⚠ No encontré una cartera en ese PDF. ¿Es el informe de cartera sugerida?", "error"); return;
    }
    est.sugerida = sug;
    aplicarSugerida();
    const cats = sug.categorias.map(c => `${c.nombre} ${N.fmt(c.pct, 0)}%`).join(" · ");
    est.paso1 = `✓ Cartera sugerida cargada: ${sug.activos.length} activos\n${cats}`;
    estado(1, est.paso1, "ok");
    despuesDeCargar();
  } catch (e) {
    console.error(e); estado(1, "⚠ No pude leer el PDF: " + e.message, "error");
  }
}

function aplicarSugerida() {
  if (!est.sugerida) return;
  const { obj, avisos } = N.objetivosDesdeSugerida(est.sugerida, est.activos, cot);
  est.avisos = avisos;
  for (const a of est.activos) a.objetivo = obj[a.ticker]?.pct || 0;
  for (const [t, o] of Object.entries(obj))
    if (!est.activos.some(a => a.ticker === t)) est.activos.push({ ticker: t, tipo: o.tipo || "CEDEAR", objetivo: o.pct, cantidad: 0 });
  limpiar();
  aplicarPrecios();
}

// ----------------------------------------------------------------------------- paso 2: capturas
let worker = null;
async function cargarCapturas(files) {
  const barra = $("barra2"), relleno = barra.firstElementChild;
  barra.style.display = "block"; relleno.style.width = "5%";
  estado(2, worker ? "⏳ Leyendo la captura…" : "⏳ Preparando el lector (la primera vez tarda unos segundos)…");
  try {
    if (!worker) {
      worker = await Tesseract.createWorker("eng", 1, {
        logger: m => { if (m.status === "recognizing text") relleno.style.width = (10 + m.progress * 80) + "%"; },
      });
    }
    const leidos = {}; let patrimonio = null, otros = [], sinTicker = 0;
    let i = 0;
    for (const f of files) {
      i++;
      estado(2, `⏳ Leyendo captura ${i} de ${files.length}…`);
      const { canvas, ancho } = await prepararImagen(f);
      const r = await N.leerCaptura(worker, canvas, ancho, cot);
      for (const a of r.activos) if (!leidos[a.ticker]) leidos[a.ticker] = a;
      patrimonio ??= r.patrimonio; otros.push(...r.otros); sinTicker += r.sinTicker;
    }
    relleno.style.width = "100%";
    const lista = Object.values(leidos);
    if (!lista.length) {
      estado(2, "⚠ No reconocí activos. Probá con una captura más nítida donde se vean los tickers y los montos en pesos.", "error");
      return;
    }
    // La captura reemplaza la tenencia anterior
    for (const a of est.activos) { a.cantidad = 0; a.valorArs = null; }
    for (const x of lista) {
      let a = est.activos.find(a => a.ticker === x.ticker);
      if (!a) { a = { ticker: x.ticker, tipo: cot[x.ticker]?.tipo || x.tipoSeccion || "CEDEAR", objetivo: 0, cantidad: 0 }; est.activos.push(a); }
      a.valorArs = x.valorArs || null;
    }
    aplicarSugerida();
    limpiar();
    aplicarPrecios();
    const total = lista.reduce((s, x) => s + x.valorArs, 0);
    let txt = `✓ Leí ${lista.length} activos por $ ${N.fmt(total, 0)}`;
    otros = [...new Set(otros)];
    if (otros.length) txt += `\n(no se cuentan: ${otros.join(", ")})`;
    est.paso2Alerta = false;
    if (patrimonio && total < 0.8 * patrimonio) {
      txt += `\n⚠ Tu patrimonio es $ ${N.fmt(patrimonio, 0)}: puede que falten activos. Si scrolleaste, elegí todas las capturas juntas.`;
      est.paso2Alerta = true;
    }
    if (sinTicker) {
      txt += `\n⚠ Hubo ${sinTicker} monto(s) sin ticker reconocible: revisá en «Revisar / corregir».`;
      est.paso2Alerta = true;
    }
    est.paso2 = txt;
    estado(2, txt, est.paso2Alerta ? "alerta" : "ok");
    despuesDeCargar();
  } catch (e) {
    console.error(e); estado(2, "⚠ No pude leer la imagen: " + e.message, "error");
  } finally {
    setTimeout(() => { barra.style.display = "none"; relleno.style.width = "0"; }, 600);
  }
}

/** Escala la captura (las de WhatsApp vienen chicas) y la pasa a grises para leer mejor. */
async function prepararImagen(file) {
  const bmp = await createImageBitmap(file);
  const escala = Math.min(3, Math.max(1, 1100 / bmp.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * escala); canvas.height = Math.round(bmp.height * escala);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.filter = "grayscale(1) contrast(1.15)";
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { canvas, ancho: canvas.width };
}

// ----------------------------------------------------------------------------- comunes
function limpiar() { est.activos = est.activos.filter(a => a.objetivo || a.cantidad || a.valorArs); }

function despuesDeCargar() {
  resultado = null;
  $("secRes").classList.add("oculto");
  guardar();
  dibujarFilas();
  const listo = est.sugerida && est.paso2;
  if (listo && (N.numAR(est.monto) || est.modo === "rebalancear")) calcularUI(true);
  guia();
}

// ----------------------------------------------------------------------------- revisar / corregir
function dibujarFilas() {
  $("avisos").innerHTML = (est.avisos || []).map(a => `<div>ℹ ${esc(a)}</div>`).join("");
  const orden = [...est.activos].sort((a, b) => (N.TIPOS.indexOf(a.tipo) - N.TIPOS.indexOf(b.tipo)) || (b.objetivo - a.objetivo));
  const total = est.activos.reduce((s, a) => s + N.valorActual(a), 0);
  $("filas").innerHTML = orden.map(a => {
    const i = est.activos.indexOf(a);
    const v = a.precio ? N.valorActual(a) : (a.valorArs || 0);
    return `<div class="fila ${a.precio ? "" : "sinprecio"}">
      <div class="cab"><b>${esc(a.ticker)}</b><span class="tipo">${esc(a.tipo || "")}${total && a.precio ? ` · hoy ${N.fmt(100 * N.valorActual(a) / total, 1)}%` : ""}</span>
        <button data-quitar="${i}" aria-label="Quitar">×</button></div>
      <div class="campos">
        <label>% sugerido<input data-i="${i}" data-c="objetivo" inputmode="decimal" value="${N.fmt(a.objetivo || 0)}"></label>
        <label>Tenés ($)<input data-i="${i}" data-c="valor" inputmode="numeric" value="${v ? N.fmt(v, 0) : ""}"></label>
        <label>Precio${a.precioManual ? " ✎" : ""}<input data-i="${i}" data-c="precio" inputmode="decimal" value="${a.precio ? N.fmt(a.precio) : ""}" placeholder="cargar"></label>
      </div></div>`;
  }).join("") || `<p class="ayuda">Todavía no hay activos. Cargá el PDF y tu captura.</p>`;
  const s = est.activos.reduce((x, a) => x + (a.objetivo || 0), 0);
  const ok = Math.abs(s - 100) < 0.05;
  $("suma").innerHTML = `Suma de % sugeridos: <span style="color:${ok ? "var(--verde)" : "var(--rojo)"}">${N.fmt(s)}% ${ok ? "✓" : "⚠ debería ser 100%"}</span>`;
}

$("filas").addEventListener("change", e => {
  const inp = e.target.closest("input[data-i]"); if (!inp) return;
  const a = est.activos[+inp.dataset.i]; const v = N.numAR(inp.value);
  if (inp.dataset.c === "objetivo") a.objetivo = v || 0;
  if (inp.dataset.c === "precio") a.precioManual = v || null;
  if (inp.dataset.c === "valor") {
    if (a.precio || a.precioManual) { aplicarPrecios(); a.cantidad = Math.round((v || 0) / N.precioUnit(a)); a.valorArs = null; }
    else { a.valorArs = v || null; a.cantidad = 0; }
  }
  aplicarPrecios(); guardar();
  if (resultado) calcularUI(true);
});
$("filas").addEventListener("click", e => {
  const b = e.target.closest("[data-quitar]"); if (!b) return;
  const a = est.activos[+b.dataset.quitar];
  if (confirm(`¿Quitar ${a.ticker}?`)) { est.activos.splice(+b.dataset.quitar, 1); dibujarFilas(); guardar(); if (resultado) calcularUI(true); }
});
$("btnAgregar").onclick = () => {
  const t = $("inAgregar").value.trim().toUpperCase();
  if (!t) return;
  if (est.activos.some(a => a.ticker === t)) { toast(`${t} ya está en la lista`); return; }
  if (Object.keys(cot).length && !cot[t] && !confirm(`${t} no figura en la lista de precios. ¿Agregarlo igual? (vas a tener que cargar el precio a mano)`)) return;
  est.activos.push({ ticker: t, tipo: cot[t]?.tipo || "CEDEAR", objetivo: 0, cantidad: 0 });
  $("inAgregar").value = ""; aplicarPrecios(); guardar(); toast(`${t} agregado: poné su % sugerido`);
};

// ----------------------------------------------------------------------------- cálculo
function calcularUI(silencioso = false) {
  est.monto = $("inMonto").value;
  const aporte = N.numAR(est.monto) || 0;
  if (!est.sugerida) { if (!silencioso) { toast("Primero cargá el PDF (paso 1)"); $("paso1").scrollIntoView({ behavior: "smooth" }); } return; }
  if (!est.paso2 && !silencioso && !confirm("No cargaste tu cartera actual (paso 2). ¿Calcular como si arrancaras de cero?")) return;
  if (aporte <= 0 && est.modo === "comprar") { if (!silencioso) { toast("Escribí cuánto vas a invertir"); $("inMonto").focus(); } return; }
  if (est.modo === "rebalancear" && !silencioso) {
    const vender = est.activos.filter(a => !a.objetivo && a.cantidad > 0 && a.precio).map(a => a.ticker);
    if (vender.length && !confirm(`Estos activos no están en la cartera sugerida y se venderían completos:\n\n${vender.join(", ")}\n\n¿Seguir?`)) return;
  }
  try { resultado = N.calcular(est.activos, aporte, est.modo, est.comision); }
  catch (e) { if (!silencioso) toast(e.message); return; }
  if (aporte) $("inMonto").value = N.fmt(aporte, 0);
  guardar(); dibujarResultado(); guia();
  if (!silencioso) $("secRes").scrollIntoView({ behavior: "smooth", block: "start" });
}

function dibujarResultado() {
  const { filas, resumen } = resultado;
  const orden = [...filas].sort((a, b) => ((b.operar > 0) - (a.operar > 0)) || ((a.operar === 0) - (b.operar === 0)) || Math.abs(b.monto) - Math.abs(a.monto));
  let html = orden.map(f => {
    const vn = N.TIPOS_CADA_100.has(f.tipo) ? " VN" : "";
    const tag = f.operar > 0 ? ["c", "COMPRAR"] : f.operar < 0 ? ["v", "VENDER"] : ["n", "NADA"];
    return `<div class="orden"><span class="tag ${tag[0]}">${tag[1]}</span>
      <span class="tk">${esc(f.ticker)}<small>${esc(f.tipo)}</small></span>
      <span class="cant">${f.operar ? N.fmt(Math.abs(f.operar), 0) + vn : "—"}</span>
      <span class="det">a $ ${N.fmt(f.precio)} · ${N.fmt(f.pctHoy, 1)}% → ${N.fmt(f.pctFinal, 1)}% (sug. ${N.fmt(f.pctObj, 1)}%)</span>
      <span class="monto-op">${f.operar ? "$ " + N.fmt(Math.abs(f.monto), 0) : ""}</span></div>`;
  }).join("");
  html += resumen.sinPrecio.map(t => `<div class="orden"><span class="tag s">SIN PRECIO</span>
      <span class="tk">${esc(t)}</span><span class="cant"></span>
      <span class="det">Cargá su precio en «Revisar / corregir» para incluirlo.</span><span></span></div>`).join("");
  $("ordenes").innerHTML = html;
  $("resumen").innerHTML = `<span>Comprás</span><b>$ ${N.fmt(resumen.compras, 0)}</b>` +
    (resumen.ventas ? `<span>Vendés</span><b>$ ${N.fmt(resumen.ventas, 0)}</b>` : "") +
    `<span>Comisiones aprox.</span><b>$ ${N.fmt(resumen.comisiones, 0)}</b><span>Te sobran</span><b>$ ${N.fmt(resumen.sobrante, 0)}</b>`;
  $("secRes").classList.remove("oculto");
}

function textoOrdenes() {
  const l = resultado.filas.filter(f => f.operar).sort((a, b) => b.operar - a.operar)
    .map(f => `${f.operar > 0 ? "COMPRAR" : "VENDER"} ${N.fmt(Math.abs(f.operar), 0)} ${N.TIPOS_CADA_100.has(f.tipo) ? "VN " : ""}${f.ticker} (~$ ${N.fmt(Math.abs(f.monto), 0)})`);
  return `Órdenes (${new Date().toLocaleDateString("es-AR")}):\n` + l.join("\n");
}
$("btnCopiar").onclick = async () => {
  try { await navigator.clipboard.writeText(textoOrdenes()); toast("📋 Órdenes copiadas"); }
  catch (e) { toast("No se pudo copiar"); }
};
$("btnCompartir").onclick = async () => {
  if (navigator.share) { try { await navigator.share({ text: textoOrdenes() }); } catch (e) { /* cancelado */ } }
  else $("btnCopiar").click();
};

// ----------------------------------------------------------------------------- eventos
$("inPdf").onchange = e => { const f = e.target.files[0]; if (f) cargarPdf(f); e.target.value = ""; };
$("inCap").onchange = e => { const f = [...e.target.files]; if (f.length) cargarCapturas(f); e.target.value = ""; };
$("btnCalc").onclick = () => calcularUI(false);
$("inMonto").addEventListener("input", () => { est.monto = $("inMonto").value; guardar(); guia(); });
$("inMonto").addEventListener("keydown", e => { if (e.key === "Enter") calcularUI(false); });
$("inMonto").addEventListener("blur", () => { const v = N.numAR($("inMonto").value); if (v) $("inMonto").value = N.fmt(v, 0); });
document.querySelectorAll("input[name=modo]").forEach(r => r.onchange = () => {
  est.modo = r.value; guardar(); if (resultado) calcularUI(true); guia();
});
$("inCom").onchange = () => { est.comision = N.numAR($("inCom").value) || 0; guardar(); if (resultado) calcularUI(true); };
$("inUltimo").onchange = () => { est.ultimo = $("inUltimo").checked; aplicarPrecios(); guardar(); if (resultado) calcularUI(true); };
$("btnPrecios").onclick = actualizarPrecios;
$("btnBorrar").onclick = () => {
  if (!confirm("¿Borrar la cartera sugerida, tu tenencia y el monto?")) return;
  est = { ...est, activos: [], sugerida: null, paso1: "", paso2: "", avisos: [], monto: "" };
  resultado = null; guardar(); location.reload();
};
$("btnAyuda").onclick = () => $("dlgAyuda").showModal();
$("btnCerrarAyuda").onclick = () => $("dlgAyuda").close();

// ----------------------------------------------------------------------------- inicio
const habia = cargar();
$("inMonto").value = est.monto ? N.fmt(N.numAR(est.monto) || 0, 0) : "";
document.querySelector(`input[name=modo][value=${est.modo}]`).checked = true;
$("inCom").value = N.fmt(est.comision);
$("inUltimo").checked = !!est.ultimo;
if (est.paso1) estado(1, est.paso1, "ok");
if (est.paso2) estado(2, est.paso2, est.paso2Alerta ? "alerta" : "ok");
dibujarFilas(); guia();
if (!habia) $("dlgAyuda").showModal();
actualizarPrecios();
