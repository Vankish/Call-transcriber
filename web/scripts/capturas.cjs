// Capturas de la web con datos inventados, sin tocar el escritorio de nadie.
//
// Abre una ventana de Electron que nunca se enseña (offscreen: pinta en memoria,
// no en pantalla), carga cada página de `vite preview` y guarda un PNG. El
// escritorio del PC es compartido con otras sesiones: nada de ventanas visibles
// ni de clics de verdad; lo que haga falta pulsar se pulsa por JavaScript.
//
// Uso:
//   npm run web:build && npm run web:video
//   npx vite preview --config vite.web.config.ts      (en otra terminal)
//   npm run web:capturas                               → docs/capturas/web/

const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync, mkdtempSync } = require('node:fs')
const { join } = require('node:path')
const os = require('node:os')

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

const BASE = process.env.WEB_URL || 'http://localhost:5181'
const SALIDA = join(__dirname, '..', '..', 'docs', 'capturas', 'web')

// Perfil propio y temporal: ni la sesión ni la caché de la app de verdad.
app.setPath('userData', mkdtempSync(join(os.tmpdir(), 'ct-web-capturas-')))
app.disableHardwareAcceleration()

const TAMANOS = {
  escritorio: { width: 1440, height: 900, movil: false },
  movil: { width: 390, height: 844, movil: true },
}

// Cada captura: ruta, si hay sesión, idioma y lo que se hace antes de disparar.
const CAPTURAS = [
  { nombre: 'entrar', ruta: '/', sesion: false },
  { nombre: 'lista', ruta: '/' },
  { nombre: 'lista-filtrada', ruta: '/?proyecto=p-frontend', solo: 'escritorio' },
  { nombre: 'llamada-comentarios', ruta: '/i/i-brisa', antes: `ir(1256); await pausa(1200); pestana('Comentarios'); await pausa(300)` },
  { nombre: 'llamada-comentando', ruta: '/i/i-brisa', solo: 'escritorio', antes: `ir(1256); await pausa(800); boton('Comentar en este momento'); await pausa(300); document.querySelector('.formulario-comentario textarea').value=''` },
  { nombre: 'llamada-transcripcion', ruta: '/i/i-brisa', solo: 'movil', antes: `ir(540); await pausa(1500)` },
  { nombre: 'llamada-resumen', ruta: '/i/i-brisa', antes: `pestana('Resumen'); await pausa(300)` },
  { nombre: 'llamada-enlaces', ruta: '/i/i-brisa', antes: `pestana('Compartir con el cliente'); await pausa(300)` },
  { nombre: 'llamada-coach', ruta: '/i/i-taller', solo: 'escritorio', antes: `ir(185); await pausa(1000)` },
  { nombre: 'llamada-solo-audio', ruta: '/i/i-javier', solo: 'escritorio', antes: `ir(300); await pausa(800)` },
  { nombre: 'llamada-subiendo', ruta: '/i/i-clinica', solo: 'escritorio' },
  { nombre: 'llamada-en', ruta: '/i/i-brisa', idioma: 'en', solo: 'escritorio', antes: `ir(1256); await pausa(1200)` },
  { nombre: 'cliente', ruta: '/l/demo-activo', sesion: false, antes: `ir(400); await pausa(1200)` },
  { nombre: 'cliente-caducado', ruta: '/l/demo-caducado', sesion: false },
  { nombre: 'personas', ruta: '/personas' },
  { nombre: 'no-existe', ruta: '/i/no-existe', solo: 'escritorio' },
]

// Ayudantes que se inyectan en la página antes de cada `antes`.
const AYUDANTES = `
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  const ir = (s) => { const m = document.querySelector('video, audio'); if (m) { m.currentTime = s; m.dispatchEvent(new Event('timeupdate')) } };
  const boton = (txt) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(txt))?.click();
  const pestana = (txt) => [...document.querySelectorAll('.pestana')].find((b) => b.textContent.includes(txt))?.click();
`

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

async function capturar(win, c, tam) {
  const wc = win.webContents
  // Sesión e idioma se dejan en localStorage antes de cargar la página buena.
  // A veces la primera carga de una ventana recien creada se aborta: un reintento.
  await wc.loadURL(BASE + '/no-existe-aun').catch(() => wc.loadURL(BASE + '/no-existe-aun'))
  await wc.executeJavaScript(`
    localStorage.clear();
    ${c.sesion === false ? '' : "localStorage.setItem('ct-web-demo-sesion', '1');"}
    localStorage.setItem('ct-web-idioma', '${c.idioma || 'es'}');
  `)
  await wc.loadURL(BASE + c.ruta)
  await espera(1400) // los 500 ms de "carga" de los datos falsos y la URL del vídeo
  if (c.antes) await wc.executeJavaScript(`(async () => { ${AYUDANTES} ${c.antes} })()`)
  await espera(400)
  // Se alarga la ventana hasta el alto de la página (con tope) para que salga
  // también lo que queda por debajo del vídeo.
  const alto = Math.max(tam.height, Math.min(2400, await wc.executeJavaScript('document.documentElement.scrollHeight')))
  if (alto !== tam.height) {
    win.setContentSize(tam.width, alto)
    await espera(500)
  }
  const img = await wc.capturePage()
  const archivo = join(SALIDA, `${c.nombre}-${tam.movil ? 'movil' : 'escritorio'}.jpg`)
  // JPEG y no PNG: la carta de ajuste del video de prueba pesa mucho en PNG y
  // las capturas van al repositorio.
  writeFileSync(archivo, img.toJPEG(85))
  win.setContentSize(tam.width, tam.height)
  console.log('  ', archivo)
}

// Entre un tamano y otro no queda ninguna ventana abierta: sin esto Electron
// se cerraria ahi mismo.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  mkdirSync(SALIDA, { recursive: true })
  for (const [clave, tam] of Object.entries(TAMANOS)) {
    const win = new BrowserWindow({
      show: false,
      width: tam.width,
      height: tam.height,
      useContentSize: true,
      webPreferences: { offscreen: true, autoplayPolicy: 'no-user-gesture-required' },
    })
    win.webContents.setFrameRate(10)
    if (tam.movil) {
      win.webContents.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148')
    }
    win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('   [consola]', e.message) })
    console.log(clave)
    for (const c of CAPTURAS) {
      if (c.solo && c.solo !== clave) continue
      await capturar(win, c, tam)
    }
    win.destroy()
  }
  app.quit()
}).catch((e) => { console.error(e); app.exit(1) })
