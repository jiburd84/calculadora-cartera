# Calculadora de Cartera Sugerida (versión web / celular)
**Desarrollada por Ignacio Burd**

Es la misma calculadora de la versión de PC, pero hecha como página web. Funciona en el navegador del celular (Android o iPhone) y de la compu, y se puede agregar a la pantalla de inicio para abrirla como una app.

> Herramienta independiente, no oficial de PIN Capital. No es una recomendación de inversión.

## Archivos
- `index.html`, `app.js`, `nucleo.js`: la app.
- `logo_pin.png`, `icono-192.png`, `icono-512.png`, `manifest.json`: el logo, el ícono y lo necesario para "Agregar a pantalla de inicio".
- `CalculadoraCarteraSugerida.html`: la misma app en **un solo archivo**. Sirve si preferís subir un solo archivo.
- `construir.py`: regenera el archivo único si cambiás el código.

## Publicarla gratis con GitHub Pages
La app necesita estar en internet para abrirse desde el celular. Con GitHub Pages es gratis:

1. Creá una cuenta en **github.com**. Si ya tenés, entrá.
2. Arriba a la derecha tocá **+ → New repository**. Ponele de nombre `calculadora-cartera`, dejalo **Public** y tocá **Create repository**.
3. En el repositorio nuevo tocá **uploading an existing file**. Arrastrá todos los archivos de esta carpeta (no la carpeta, los archivos) y tocá **Commit changes**.
4. Andá a **Settings → Pages**. En *Branch* elegí **main**, carpeta **/ (root)**, y tocá **Save**.
5. En uno o dos minutos la app queda publicada en
   `https://TU-USUARIO.github.io/calculadora-cartera/`

Ese es el link para compartir. Para actualizar la app, subí los archivos nuevos al mismo repositorio.

## Agregarla a la pantalla de inicio
- **Android (Chrome):** abrí el link, tocá el menú ⋮ y después **Agregar a pantalla de inicio**.
- **iPhone (Safari):** abrí el link, tocá Compartir y después **Agregar a inicio**.

## Cómo funciona
- El **PDF** y las **capturas** se leen en el propio celular, sin IA, y no se mandan a ningún lado.
- La primera vez que leés una captura, el navegador descarga el lector de texto, unos 5 MB. Después queda guardado. En el celular, cada lectura tarda entre 5 y 15 segundos.
- Los **precios** salen de data912.com, que es gratis y puede tener algunos minutos de demora.
- Los datos de cada persona (su cartera, el monto y las opciones) se guardan solo en su navegador.
