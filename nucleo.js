// =============================================================================
// Calculadora de Cartera Sugerida — núcleo (sin interfaz)
// Desarrollada por Ignacio Burd
// Funciona en el navegador y en Node (para pruebas).
// =============================================================================

export const TIPOS = ["Acción", "CEDEAR", "Bono", "ON"];
export const TIPOS_CADA_100 = new Set(["Bono", "ON"]);
export const API = "https://data912.com/live/";
export const PANELES = { arg_stocks: "Acción", arg_cedears: "CEDEAR", arg_bonds: "Bono", arg_notes: "Bono", arg_corp: "ON" };

// ----------------------------------------------------------------------------- números
export function numAR(s) {
  // "1.002.870,00" -> 1002870 ; "5000000" -> 5000000 ; "6,43" -> 6.43
  s = String(s ?? "").replace(/[$%\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function fmt(x, dec = 2) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "";
  return x.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// ----------------------------------------------------------------------------- precios
export async function descargarCotizaciones(fetchFn = fetch, proxy = "") {
  const res = {};
  const errores = [];
  await Promise.all(Object.entries(PANELES).map(async ([ep, tipo]) => {
    try {
      const url = proxy ? proxy.replace(/\/?$/, "/") + ep : API + ep;
      const r = await fetchFn(url, { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      for (const f of await r.json()) {
        const s = (f.symbol || "").toUpperCase();
        if (s && !res[s]) res[s] = { tipo, c: f.c, ask: f.px_ask, bid: f.px_bid };
      }
    } catch (e) { errores.push(`${ep}: ${e.message}`); }
  }));
  if (!Object.keys(res).length) throw new Error(errores.join(" · ") || "sin datos");
  return res;
}

export function elegirPrecio(f, criterio = "ask") {
  if (!f) return null;
  const ok = x => typeof x === "number" && x > 0;
  const orden = criterio === "ask" ? [f.ask, f.c, f.bid] : [f.c, f.ask, f.bid];
  return orden.find(ok) ?? null;
}

// ----------------------------------------------------------------------------- catálogo / tickers
const CONFUSIONES = { "0": "OD", "O": "0D", "D": "O0", "1": "IL", "I": "1L", "L": "1I", "5": "S", "S": "58",
  "8": "BS", "B": "8", "2": "Z", "Z": "2", "6": "G", "G": "6" };
const RE_TICKER_VALIDO = /^[A-Z]{2,5}[0-9]{0,3}[A-Z]?$/;

/** Corrige un ticker mal leído usando el catálogo. Devuelve {ticker, verificado} o null. */
export function corregirTicker(t, catalogo, aceptarNoListado = false) {
  t = (t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (t.length < 2) return null;
  const hayCat = catalogo && Object.keys(catalogo).length;
  if (!hayCat) return RE_TICKER_VALIDO.test(t) ? t : null;
  if (catalogo[t]) return t;
  const cands = [];
  const variantes = x => {
    const out = [];
    for (let i = 0; i < x.length; i++) for (const alt of CONFUSIONES[x[i]] || "") out.push(x.slice(0, i) + alt + x.slice(i + 1));
    return out;
  };
  const v1 = variantes(t);
  cands.push(...v1);
  for (const v of v1) cands.push(...variantes(v));               // hasta dos caracteres confundidos
  if (t.length > 3) for (let i = 0; i < t.length; i++) cands.push(t.slice(0, i) + t.slice(i + 1)); // carácter de más (WVIST, QQ0Q)
  for (const c of cands) if (catalogo[c]) return c;
  return aceptarNoListado && RE_TICKER_VALIDO.test(t) && t.length >= 3 ? t : null;
}

/** ECOGAS -> ECOG (nombre largo del PDF). */
export function buscarParecido(t, catalogo) {
  const c = Object.keys(catalogo || {}).filter(s => ["Acción", "CEDEAR"].includes(catalogo[s].tipo) &&
    s.length >= 3 && (t.startsWith(s) || s.startsWith(t)));
  return c.sort((a, b) => b.length - a.length)[0] || null;
}

export function buscarEspecies(texto, catalogo, limite = 150) {
  const t = (texto || "").trim().toUpperCase();
  return Object.keys(catalogo).filter(s => !t || s.includes(t))
    .sort((a, b) => (b.startsWith(t) - a.startsWith(t)) || a.localeCompare(b)).slice(0, limite);
}

// ----------------------------------------------------------------------------- PDF de cartera sugerida
const CATEGORIAS = {
  acciones: ["Acciones", ["Acción"]], cedear: ["CEDEARs", ["CEDEAR"]], cedears: ["CEDEARs", ["CEDEAR"]],
  renta: ["Renta fija / USD", ["Bono", "ON"]], bonos: ["Bonos", ["Bono"]], soberanos: ["Bonos", ["Bono"]],
  obligaciones: ["ONs", ["ON"]], ons: ["ONs", ["ON"]], corporativos: ["ONs", ["ON"]], letras: ["Letras", ["Bono"]],
};
const NO_TICKERS = new Set(["ARS", "USD", "MEP", "CCL", "PIN", "ETF", "ADR", "ON", "ONS", "FCI", "TOTAL", "CVAL"]);

/** paginas: [{items:[{str, x, y, w}]}]  (y crece hacia abajo) */
export function analizarPdf(paginas) {
  const activos = [];
  const vistos = new Set();
  let categorias = [];
  for (const pag of paginas) {
    // Reconstruir líneas agrupando por altura
    const items = pag.items.filter(i => i.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
    const lineas = [];
    for (const it of items) {
      const l = lineas.find(l => Math.abs(l.y - it.y) < 3);
      if (l) l.items.push(it); else lineas.push({ y: it.y, items: [it] });
    }
    for (const l of lineas) {
      const txt = l.items.sort((a, b) => a.x - b.x).map(i => i.str).join(" ").replace(/\s+/g, " ").trim();
      const m = txt.match(/^([A-Z][A-Z0-9.]{1,7})\s+[—–]\s+\S/);
      if (m && !vistos.has(m[1]) && !NO_TICKERS.has(m[1])) {
        vistos.add(m[1]);
        activos.push({ ticker: m[1].replace(/\./g, ""), nombre: txt.split(/[—–]/)[1].trim(), pct: null });
      }
      const p = txt.match(/^([A-Z][A-Z0-9]{1,7})\s+(\d{1,2}(?:,\d+)?)\s*%$/);
      if (p) { const a = activos.find(a => a.ticker === p[1]); if (a) a.pct = numAR(p[2]); }
    }
    if (!categorias.length) categorias = categoriasEnPagina(pag.items);
  }
  return { categorias, activos };
}

function categoriasEnPagina(items) {
  const pcts = [], etiquetas = [];
  for (const it of items) {
    for (const palabra of it.str.trim().split(/\s+/)) {
      const cx = it.x + it.w / 2, cy = it.y;
      const m = palabra.match(/^(\d{1,3}(?:,\d+)?)%$/);
      if (m && numAR(m[1]) > 0 && numAR(m[1]) <= 100) pcts.push({ v: numAR(m[1]), cx, cy });
      else if (CATEGORIAS[palabra.toLowerCase()]) etiquetas.push({ cat: CATEGORIAS[palabra.toLowerCase()], cx, cy });
    }
  }
  if (pcts.length < 2 || !etiquetas.length) return [];
  const pares = [];
  etiquetas.forEach((e, ei) => pcts.forEach((p, pi) => pares.push({ d: Math.hypot(e.cx - p.cx, e.cy - p.cy), ei, pi })));
  pares.sort((a, b) => a.d - b.d);
  const usE = new Set(), usP = new Set(), res = {};
  for (const { d, ei, pi } of pares) {
    if (usE.has(ei) || usP.has(pi) || d > 300) continue;
    const [nombre, tipos] = etiquetas[ei].cat;
    if (res[nombre]) continue;
    usE.add(ei); usP.add(pi);
    res[nombre] = { nombre, pct: pcts[pi].v, tipos };
  }
  const lista = Object.values(res);
  const total = lista.reduce((s, c) => s + c.pct, 0);
  return lista.length >= 2 && Math.abs(total - 100) <= 1.5 ? lista : [];
}

/** Lee un PDF con pdf.js y lo analiza. */
export async function leerPdf(pdfjsLib, datos) {
  const doc = await pdfjsLib.getDocument({ data: datos, isEvalSupported: false }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const alto = p.getViewport({ scale: 1 }).height;
    const tc = await p.getTextContent();
    paginas.push({ items: tc.items.map(i => ({ str: i.str, x: i.transform[4], y: alto - i.transform[5], w: i.width })) });
  }
  return analizarPdf(paginas);
}

/** Objetivo (%) de cada ticker a partir de la cartera sugerida. */
export function objetivosDesdeSugerida(sug, activosActuales, catalogo) {
  const avisos = [];
  const lista = [];
  for (const a of sug.activos || []) {
    let t = a.ticker.toUpperCase();
    let tipo = catalogo[t]?.tipo;
    if (!tipo && Object.keys(catalogo).length) {
      const alt = buscarParecido(t, catalogo);
      if (alt) { avisos.push(`${t} no existe en BYMA: se usó ${alt}.`); t = alt; tipo = catalogo[alt].tipo; }
      else avisos.push(`${t} no se encontró en BYMA: revisalo.`);
    }
    lista.push({ ticker: t, tipo, pct: a.pct });
  }
  const cats = sug.categorias || [];
  const obj = {};
  if (!cats.length) {
    avisos.push("No encontré los % por categoría en el PDF: repartí 100% en partes iguales. Ajustalos a mano.");
    for (const a of lista) obj[a.ticker] = { tipo: a.tipo || "CEDEAR", pct: 100 / lista.length };
    return { obj, avisos };
  }
  const asignados = new Set();
  for (const cat of cats) {
    const tipos = new Set(cat.tipos);
    const miembros = lista.filter(a => tipos.has(a.tipo) && !asignados.has(a.ticker));
    if (!miembros.length) {
      const propios = activosActuales.filter(a => tipos.has(a.tipo) && (a.cantidad || a.valorArs));
      if (propios.length) {
        for (const a of propios) obj[a.ticker] = { tipo: a.tipo, pct: cat.pct / propios.length };
        avisos.push(`«${cat.nombre}» (${fmt(cat.pct, 0)}%) no nombra activos: se repartió entre los que ya tenés (${propios.map(a => a.ticker).join(", ")}).`);
      } else avisos.push(`«${cat.nombre}» (${fmt(cat.pct, 0)}%) no nombra activos y no tenés ninguno: agregalos a mano.`);
      continue;
    }
    const fijos = miembros.filter(a => a.pct != null).reduce((s, a) => s + a.pct, 0);
    const libres = miembros.filter(a => a.pct == null);
    const resto = Math.max(0, cat.pct - fijos);
    for (const a of miembros) { asignados.add(a.ticker); obj[a.ticker] = { tipo: a.tipo, pct: a.pct ?? resto / libres.length }; }
    if (libres.length) avisos.push(`«${cat.nombre}» ${fmt(cat.pct, 0)}%: repartido en partes iguales entre ${libres.length} activos.`);
  }
  const sueltos = lista.filter(a => !obj[a.ticker]).map(a => a.ticker);
  if (sueltos.length) avisos.push(`Sin categoría (quedan en 0%): ${sueltos.join(", ")}.`);
  return { obj, avisos };
}

// ----------------------------------------------------------------------------- captura (OCR)
const RE_MONTO = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;
const RE_TICKER = /^[A-Z][A-Z0-9]{1,7}$/;
const SECCIONES = { acciones: "Acción", cedears: "CEDEAR", cedear: "CEDEAR", bonos: "Bono", obligaciones: "ON", letras: "Bono" };
const OTROS = new Set(["dólares", "dolares", "pesos", "fci", "fondos", "cauciones", "caución", "efectivo"]);

function palabrasDe(data) {
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words)
    out.push({ t: w.text.trim(), x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 });
  // Unir números que el OCR partió: "2.025.194," + "80"  o  "21.244.496" + "40"
  const ws = out.filter(w => w.t);
  const res = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], n = ws[i + 1];
    const mismaFila = n && Math.abs(n.y0 - w.y0) < (w.y1 - w.y0) * 0.6 && n.x0 - w.x1 < (w.y1 - w.y0) * 1.5;
    if (mismaFila && /^\d{1,3}(\.\d{3})*,$/.test(w.t) && /^\d{2}$/.test(n.t)) {
      res.push({ ...w, t: w.t + n.t, x1: n.x1 }); i++;
    } else if (mismaFila && /^\d{1,3}(\.\d{3})+$/.test(w.t) && /^\d{2}$/.test(n.t)) {
      res.push({ ...w, t: w.t + "," + n.t, x1: n.x1 }); i++;
    } else res.push(w);
  }
  return res;
}

const solape = (a, b) => {
  const i = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return i > 0 ? i / Math.min(a.y1 - a.y0, b.y1 - b.y0) : 0;
};

/**
 * Lee la tenencia desde una captura.
 * worker: worker de tesseract.js ya creado. imagen: lo que acepte worker.recognize (canvas, url, ruta).
 * ancho: ancho de la imagen en px.  catalogo: {TICKER:{tipo}}.
 */
export async function leerCaptura(worker, imagen, ancho, catalogo = {}) {
  await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
  const { data } = await worker.recognize(imagen, {}, { blocks: true });
  const pal = palabrasDe(data);

  // Montos: número argentino que sigue a "ARS" (o "$")
  const montos = [];
  pal.forEach((w, i) => {
    const t = w.t.replace(/^ARS/i, "");
    if (RE_MONTO.test(t) && !t.startsWith("-")) {
      const prev = pal[i - 1];
      const conArs = /^ARS$|^\$$/i.test(prev?.t || "") || /^ARS/i.test(w.t);
      if (conArs) montos.push({ ...w, v: numAR(t), ars: /^ARS/i.test(w.t) ? w : prev });
    }
  });
  if (!montos.length) return { activos: [], otros: [], patrimonio: null, sinTicker: 0 };

  // Patrimonio total (el monto debajo de "Patrimonio")
  let patrimonio = null;
  const pw = pal.find(w => /^patrimonio$/i.test(w.t));
  if (pw) {
    const m = montos.filter(m => m.y0 > pw.y0 - 5 && m.y0 < pw.y1 + (pw.y1 - pw.y0) * 6).sort((a, b) => a.y0 - b.y0)[0];
    if (m) patrimonio = m.v;
  }

  // Las tenencias están alineadas a la derecha: nos quedamos con los montos del borde derecho
  const derecha = Math.max(...montos.filter(m => m.v !== patrimonio).map(m => m.x1));
  const valores = montos.filter(m => m.v !== patrimonio && m.x1 >= derecha - ancho * 0.05);

  // Secciones (para el tipo y para descartar dólares/pesos)
  const secciones = pal.filter(w => SECCIONES[w.t.toLowerCase()] || OTROS.has(w.t.toLowerCase()))
    .map(w => ({ y: w.y0, tipo: SECCIONES[w.t.toLowerCase()] || "otros", nombre: w.t })).sort((a, b) => a.y - b.y);
  const otros = [...new Set(secciones.filter(s => s.tipo === "otros").map(s => s.nombre))];

  const activos = {};
  let sinTicker = 0;
  for (const m of valores) {
    const sec = secciones.filter(s => s.y < m.y0).pop();
    if (sec?.tipo === "otros") continue;
    const limite = (m.ars || m).x0;
    // Candidatos en la misma fila, a la izquierda del monto: el más cercano primero
    const cands = pal.filter(w => w.x1 <= limite && solape(w, m) > 0.3)
      .sort((a, b) => b.x0 - a.x0).map(w => w.t.replace(/[^A-Za-z0-9]/g, ""));
    let ticker = null;
    for (const c of cands) {
      if (!RE_TICKER.test(c.toUpperCase()) || NO_TICKERS.has(c.toUpperCase())) continue;
      ticker = corregirTicker(c, catalogo, c === cands.find(x => RE_TICKER.test(x.toUpperCase())));
      if (ticker) break;
    }
    if (!ticker) {
      // Segunda lectura solo de ese renglón, con letras y números
      const alto = m.y1 - m.y0;
      await worker.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 " });
      const r = await worker.recognize(imagen, {
        rectangle: { left: Math.round(limite * 0.12), top: Math.max(0, Math.round(m.y0 - alto * 0.6)),
                     width: Math.round(limite * 0.75), height: Math.round(alto * 2.2) } });
      await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
      for (const c of (r.data.text || "").split(/\s+/).reverse()) {
        if (c.length < 2) continue;
        ticker = corregirTicker(c, catalogo);
        if (ticker) break;
      }
    }
    if (!ticker) { sinTicker++; continue; }
    activos[ticker] = { ticker, tipoSeccion: sec?.tipo || null, valorArs: m.v };
  }
  return { activos: Object.values(activos), otros, patrimonio, sinTicker };
}

// ----------------------------------------------------------------------------- cálculo
export const factor = a => (TIPOS_CADA_100.has(a.tipo) ? 100 : 1);
export const precioUnit = a => (a.precio ? a.precio / factor(a) : null);
export const valorActual = a => (precioUnit(a) ? a.cantidad * precioUnit(a) : 0);

/**
 * modo: "comprar" (solo usa el aporte) | "rebalancear" (compra y vende)
 * Devuelve { filas, resumen }.
 */
export function calcular(activos, aporte, modo = "comprar", comisionPct = 0) {
  const val = activos.filter(a => precioUnit(a));
  if (!val.length) throw new Error("Ningún activo tiene precio.");
  const k = 1 + comisionPct / 100;
  const sumaObj = val.reduce((s, a) => s + (a.objetivo || 0), 0);
  if (sumaObj <= 0) throw new Error("Los % sugeridos suman 0.");
  const peso = a => (a.objetivo || 0) / sumaObj;
  const actualTotal = val.reduce((s, a) => s + valorActual(a), 0);
  const totalFinal = actualTotal + aporte / k;
  const objetivo = new Map(val.map(a => [a, peso(a) * totalFinal]));
  const op = new Map(val.map(a => [a, 0]));
  const vf = a => (a.cantidad + op.get(a)) * precioUnit(a);
  let caja;

  if (modo === "comprar") {
    const def = new Map(val.map(a => [a, Math.max(0, objetivo.get(a) - valorActual(a))]));
    const sumaDef = [...def.values()].reduce((s, x) => s + x, 0);
    const escala = sumaDef > 0 ? Math.min(1, (aporte / k) / sumaDef) : 0;
    for (const a of val) op.set(a, Math.floor(def.get(a) * escala / precioUnit(a) + 1e-9));
    caja = aporte - k * val.reduce((s, a) => s + op.get(a) * precioUnit(a), 0);
  } else {
    for (const a of val) {
      const dif = objetivo.get(a) - valorActual(a);
      let n = dif > 0 ? Math.floor(dif / precioUnit(a) + 1e-9) : -Math.floor(-dif / precioUnit(a) + 1e-9);
      op.set(a, Math.max(n, -Math.floor(a.cantidad)));
    }
    const compras = val.reduce((s, a) => s + Math.max(0, op.get(a)) * precioUnit(a), 0);
    const ventas = val.reduce((s, a) => s + Math.max(0, -op.get(a)) * precioUnit(a), 0);
    caja = aporte + ventas / k - k * compras;
    while (caja < -1e-6) {
      const c = val.filter(a => op.get(a) > 0).sort((a, b) => (vf(b) - objetivo.get(b)) - (vf(a) - objetivo.get(a)))[0];
      if (!c) break;
      op.set(c, op.get(c) - 1); caja += k * precioUnit(c);
    }
  }
  // Repartir el sobrante: de a una unidad al más atrasado (en %) respecto de su objetivo
  for (;;) {
    const c = val.filter(a => (a.objetivo || 0) > 0 && k * precioUnit(a) <= caja + 1e-6)
      .sort((a, b) => (vf(a) - objetivo.get(a)) / Math.max(objetivo.get(a), 1) - (vf(b) - objetivo.get(b)) / Math.max(objetivo.get(b), 1))[0];
    if (!c || vf(c) + precioUnit(c) > objetivo.get(c) * 1.02 + precioUnit(c)) break;
    op.set(c, op.get(c) + 1); caja -= k * precioUnit(c);
  }
  const totalPost = val.reduce((s, a) => s + vf(a), 0);
  const filas = val.map(a => ({
    ticker: a.ticker, tipo: a.tipo, precio: a.precio, operar: op.get(a), monto: op.get(a) * precioUnit(a),
    pctHoy: actualTotal ? 100 * valorActual(a) / actualTotal : 0, pctObj: 100 * peso(a),
    pctFinal: totalPost ? 100 * vf(a) / totalPost : 0,
  }));
  const compras = filas.reduce((s, f) => s + Math.max(0, f.monto), 0);
  const ventas = filas.reduce((s, f) => s + Math.max(0, -f.monto), 0);
  return {
    filas,
    resumen: { compras, ventas, comisiones: (k - 1) * (compras + ventas), sobrante: caja,
               sinPrecio: activos.filter(a => !precioUnit(a) && (a.objetivo || a.cantidad || a.valorArs)).map(a => a.ticker) },
  };
}
