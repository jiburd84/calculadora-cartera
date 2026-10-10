"""Genera CalculadoraCarteraSugerida.html: la app entera en un solo archivo (para publicar o probar)."""
import base64, re, pathlib
d = pathlib.Path(__file__).parent
html = (d / "index.html").read_text(encoding="utf-8")
nucleo = (d / "nucleo.js").read_text(encoding="utf-8")
app = (d / "app.js").read_text(encoding="utf-8")
nombres = re.findall(r"^export (?:async )?(?:function|const) (\w+)", nucleo, re.M)
nucleo = re.sub(r"^export ", "", nucleo, flags=re.M)
app = app.replace('import * as N from "./nucleo.js";', "const N = { " + ", ".join(nombres) + " };")
b64 = lambda f: "data:image/png;base64," + base64.b64encode((d / f).read_bytes()).decode()
html = html.replace('src="logo_pin.png"', f'src="{b64("logo_pin.png")}"')
html = html.replace('href="icono-192.png"', f'href="{b64("icono-192.png")}"')
html = html.replace('<link rel="manifest" href="manifest.json">\n', "")
html = html.replace('<script type="module" src="app.js"></script>',
                    "<script type=\"module\">\n" + nucleo + "\n" + app + "\n</script>")
(d / "CalculadoraCarteraSugerida.html").write_text(html, encoding="utf-8")
print("ok", len(html), "bytes;", len(nombres), "funciones")
