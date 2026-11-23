// Banco de pruebas de la grabación con vídeo: cuánto CPU, memoria y disco cuesta
// cada códec y resolución, sin tocar los datos de la app ni la pantalla real.
//
// Por qué existe: grabar con vídeo saturaba el PC pasada media hora y había varias
// sospechas (VP8 por software, memoria que crece, ffmpeg...). Esto las mide.
//
// Qué hace: abre una ventana OCULTA de Electron (con userData en una carpeta
// temporal, nada de %APPDATA%), pinta en un canvas algo parecido a una llamada de
// Meet (fondo fijo, una "cámara" con ruido que se mueve y texto que cambia) a 8 fps,
// y lo graba con MediaRecorder exactamente como la app: trozos de 1 s que viajan por
// IPC al proceso principal y se escriben a disco, vista previa en un <video> y una
// pista de audio mezclada con AudioContext. Cada 5 s apunta CPU (núcleos usados) y
// memoria por tipo de proceso. Al acabar cada prueba saca tamaño en MB/hora y los
// fotogramas reales del archivo con ffmpeg.
//
// Uso (desde la raíz del repo):
//   npx electron scripts/bench-grabacion-video.cjs --minutos 3
//   npx electron scripts/bench-grabacion-video.cjs --minutos 30 --pruebas vp8-1080-4000,h264-720-1000
// Cada prueba es códec-alto-kbps (alto 1080 o 720), con "-pantalla" al final para
// capturar la pantalla de verdad en vez del canvas (no se guarda nada: solo se
// cuentan bytes y fotogramas; sirve para ver si el capturador respeta fps y tamaño). Códecs: vp8, vp9, h264, av1, ninguno
// (ninguno = solo pintar el canvas, sin grabar, para restar lo que cuesta la escena).
// Los resultados quedan en %TEMP%\ct-bench-video-<fecha>\ (resultados.json y los .webm).
// Con --sin-hw se desactiva el codificador por hardware, para ver un PC que no lo tiene.
// Con --borrar se eliminan los vídeos al acabar y solo queda el JSON.

const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron')

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const MINUTES = Number(arg('minutos', '3'))
const TESTS = arg('pruebas', 'ninguno-1080-0,vp8-1080-4000,vp8-720-2000,vp9-720-1000,h264-1080-4000,h264-720-1000,av1-720-1000').split(',')
const DELETE_VIDEOS = process.argv.includes('--borrar')
// --sumidero nada: la ventana tira los trozos en vez de mandarlos por IPC.
const SINK = arg('sumidero', 'ipc')
// --gc: fuerza la recogida de basura cada 30 s, para distinguir memoria retenida
// de verdad de memoria que V8 aún no se ha molestado en liberar.
const FORCE_GC = process.argv.includes('--gc')
let mainGc = null
if (FORCE_GC) {
  app.commandLine.appendSwitch('js-flags', '--expose-gc')
  require('node:v8').setFlagsFromString('--expose-gc')
  mainGc = require('node:vm').runInNewContext('gc')
}
// --sin-hw: como un PC sin codificador en la tarjeta gráfica (H.264 cae a OpenH264).
if (process.argv.includes('--sin-hw')) app.commandLine.appendSwitch('disable-accelerated-video-encode')
const OUT_DIR = path.join(os.tmpdir(), `ct-bench-video-${new Date().toISOString().replace(/[:.]/g, '-')}`)
fs.mkdirSync(OUT_DIR, { recursive: true })
// Nada de la app real: perfil de Chromium aparte, en la carpeta temporal.
app.setPath('userData', path.join(OUT_DIR, 'userData'))

let ffmpegPath = null
try { ffmpegPath = require('ffmpeg-static') } catch { /* sin ffmpeg no se cuentan fotogramas */ }

const MIME = {
  vp8: 'video/webm;codecs=vp8,opus',
  vp9: 'video/webm;codecs=vp9,opus',
  h264: 'video/webm;codecs=h264,opus',
  av1: 'video/webm;codecs=av01,opus',
}

const RENDERER = String.raw`
<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c"></canvas><video id="pip" autoplay muted playsinline width="320" height="180"></video>
<script>
const { ipcRenderer } = require('electron')
const cfg = JSON.parse(decodeURIComponent(location.hash.slice(1)))
const W = cfg.height === 720 ? 1280 : 1920, H = cfg.height === 720 ? 720 : 1080
const c = document.getElementById('c'); c.width = W; c.height = H
const g = c.getContext('2d')
// Ruido precalculado a baja resolución y ampliado: se parece a una webcam (detalle
// que cambia en cada fotograma) sin gastar CPU en generarlo cada vez.
const noise = []
for (let n = 0; n < 6; n++) {
  const nc = document.createElement('canvas'); nc.width = 160; nc.height = 90
  const nx = nc.getContext('2d'); const img = nx.createImageData(160, 90)
  for (let i = 0; i < img.data.length; i += 4) { const v = 80 + Math.random() * 120; img.data[i] = v; img.data[i + 1] = v * 0.8; img.data[i + 2] = v * 0.7; img.data[i + 3] = 255 }
  nx.putImageData(img, 0, 0); noise.push(nc)
}
let f = 0
const draw = () => {
  f++
  g.fillStyle = '#202124'; g.fillRect(0, 0, W, H)
  // "Cámara" del interlocutor: ocupa medio ancho, como en un Meet a dos.
  const cw = W * 0.6, ch = cw * 9 / 16, cx = (W - cw) / 2 + Math.sin(f / 40) * 20, cy = (H - ch) / 2
  g.drawImage(noise[f % noise.length], cx, cy, cw, ch)
  g.fillStyle = 'rgba(230,180,150,0.9)'; g.beginPath(); g.ellipse(cx + cw / 2 + Math.sin(f / 7) * 30, cy + ch / 2, ch / 5, ch / 4, 0, 0, 7); g.fill()
  g.fillStyle = '#e8eaed'; g.font = Math.round(H / 40) + 'px sans-serif'
  for (let l = 0; l < 6; l++) g.fillText('Linea de texto ' + l + ' · ' + Math.floor(f / 40 + l), 40, 60 + l * H / 30)
  g.fillText(new Date().toISOString(), 40, H - 40)
}
let track
const probes = {}
const getTrack = async () => {
  if (!cfg.pantalla) {
    const stream = c.captureStream(0)
    track = stream.getVideoTracks()[0]
    setInterval(() => { draw(); track.requestFrame() }, 125) // 8 fps, como la app
    return
  }
  // Captura real de la pantalla, con las mismas restricciones que pide la app.
  const video = { frameRate: { ideal: 8, max: 12 } }
  if (cfg.height === 720) Object.assign(video, { width: { max: 1280 }, height: { max: 720 } })
  const s = await navigator.mediaDevices.getDisplayMedia({ video, audio: false })
  track = s.getVideoTracks()[0]
  probes.settings = track.getSettings()
  // Fotogramas que entrega de verdad el capturador (no los que se piden).
  const proc = new MediaStreamTrackProcessor({ track: track.clone() })
  const reader = proc.readable.getReader(); let n = 0; const t0 = performance.now()
  ;(async () => { for (;;) { const r = await reader.read(); if (r.done) break; r.value.close(); n++; probes.captureFps = +(n * 1000 / (performance.now() - t0)).toFixed(2) } })()
  setInterval(() => ipcRenderer.send('bench:probe', { captureFps: probes.captureFps, settings: track.getSettings() }), 5000)
}

// Audio "mezclado" como en la app: una fuente que pasa por AudioContext.
;(async () => {
await getTrack()
const ctx = new AudioContext(); const osc = ctx.createOscillator(); const dest = ctx.createMediaStreamDestination()
osc.connect(dest); osc.start()
const recStream = new MediaStream([track, ...dest.stream.getAudioTracks()])
document.getElementById('pip').srcObject = recStream
  for (const [k, codec] of Object.entries({ h264: 'avc1.42002a', vp8: 'vp8', vp9: 'vp09.00.10.08', av1: 'av01.0.04M.08' })) {
    try { probes[k] = (await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: 1e6, framerate: 8, hardwareAcceleration: 'prefer-hardware' })).supported } catch { probes[k] = 'error' }
  }
  const supported = cfg.mime ? MediaRecorder.isTypeSupported(cfg.mime) : null
  if (cfg.mime && !supported) { ipcRenderer.send('bench:ready', { probes, supported, error: 'no soportado' }); return }
  let rec = null
  if (cfg.mime) {
    rec = new MediaRecorder(recStream, { mimeType: cfg.mime, videoBitsPerSecond: cfg.kbps * 1000, audioBitsPerSecond: 128000 })
    // Mismo camino que openRecordingSink: cola, arrayBuffer y IPC por trozo.
    let q = Promise.resolve()
    // cfg.sink 'nada': el trozo se lee y se tira en la ventana, para separar lo que
    // retiene el IPC de lo que retiene MediaRecorder.
    rec.ondataavailable = e => { if (e.data.size > 0) { const d = e.data; q = q.then(async () => { const b = new Uint8Array(await d.arrayBuffer()); if (cfg.sink === 'nada') return; return ipcRenderer.invoke('bench:append', b) }) } }
    if (cfg.gc) setInterval(() => window.gc?.(), 30000)
    setInterval(() => { const m = process.memoryUsage(); ipcRenderer.send('bench:mem', { heapMB: Math.round(m.heapUsed / 1048576), externalMB: Math.round(m.external / 1048576), arrayBuffersMB: Math.round(m.arrayBuffers / 1048576) }) }, 5000)
    rec.onstop = () => { q.then(() => ipcRenderer.send('bench:stopped')) }
    rec.start(1000)
  }
  ipcRenderer.send('bench:ready', { probes, supported, mimeType: rec?.mimeType ?? null })
  ipcRenderer.on('bench:stop', () => { if (rec) rec.stop(); else ipcRenderer.send('bench:stopped') })
})()
</script></body></html>`

const htmlPath = path.join(OUT_DIR, 'bench.html')
fs.writeFileSync(htmlPath, RENDERER)

const sample = (prev) => {
  const now = Date.now()
  const byType = {}
  for (const m of app.getAppMetrics()) {
    const e = byType[m.type] ?? (byType[m.type] = { memMB: 0, cpuSec: 0 })
    e.memMB += (m.memory?.workingSetSize ?? 0) / 1024
    e.privMB = (e.privMB ?? 0) + (m.memory?.privateBytes ?? 0) / 1024
    e.cpuSec += m.cpu?.cumulativeCPUUsage ?? 0
  }
  const out = { t: now, byType }
  if (prev) {
    const dt = (now - prev.t) / 1000
    out.cores = {}
    for (const [type, e] of Object.entries(byType)) out.cores[type] = +(((e.cpuSec - (prev.byType[type]?.cpuSec ?? 0)) / dt).toFixed(3))
  }
  return out
}

const runTest = async (spec) => {
  const [codec, h, kbps, mode] = spec.split('-')
  const pantalla = mode === 'pantalla'
  const cfg = { codec, height: Number(h), kbps: Number(kbps), mime: MIME[codec] ?? null, pantalla, sink: SINK, gc: FORCE_GC }
  const filePath = path.join(OUT_DIR, `${spec}.webm`)
  // Con la pantalla real no se guarda nada: solo se cuentan los bytes, para no
  // dejar en disco lo que hubiera en el escritorio.
  const handle = cfg.mime && !pantalla ? await fsp.open(filePath, 'w') : null
  let bytes = 0
  let lastProbe = null
  ipcMain.removeAllListeners('bench:probe')
  ipcMain.on('bench:probe', (_e, p) => { lastProbe = p })
  let rendererMem = null
  ipcMain.removeAllListeners('bench:mem')
  ipcMain.on('bench:mem', (_e, m) => { rendererMem = m })
  const gcTimer = FORCE_GC ? setInterval(() => mainGc?.(), 30000) : null
  ipcMain.removeHandler('bench:append')
  ipcMain.handle('bench:append', async (_e, chunk) => { if (handle) await handle.write(Buffer.from(chunk)); bytes += chunk.length; return true })

  const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } })
  const ready = new Promise(r => ipcMain.once('bench:ready', (_e, info) => r(info)))
  await win.loadFile(htmlPath, { hash: encodeURIComponent(JSON.stringify(cfg)) })
  const info = await ready
  if (info.error) { win.destroy(); await handle?.close(); return { spec, ...info } }

  const samples = []
  let prev = sample(null)
  const start = Date.now()
  await new Promise(resolve => {
    const timer = setInterval(() => {
      const s = sample(prev); prev = s
      const total = Object.values(s.cores).reduce((a, b) => a + b, 0)
      samples.push({ s: Math.round((s.t - start) / 1000), cores: s.cores, total: +total.toFixed(3), memMB: Object.fromEntries(Object.entries(s.byType).map(([k, e]) => [k, Math.round(e.memMB)])), privMB: Object.fromEntries(Object.entries(s.byType).map(([k, e]) => [k, Math.round(e.privMB)])), writtenMB: +(bytes / 1048576).toFixed(1), jsVentana: rendererMem, jsPrincipal: (m => ({ heapMB: Math.round(m.heapUsed / 1048576), externalMB: Math.round(m.external / 1048576), arrayBuffersMB: Math.round(m.arrayBuffers / 1048576) }))(process.memoryUsage()) })
      if (Date.now() - start >= MINUTES * 60_000) { clearInterval(timer); if (gcTimer) clearInterval(gcTimer); resolve() }
    }, 5000)
  })
  const stopped = new Promise(r => ipcMain.once('bench:stopped', r))
  win.webContents.send('bench:stop')
  await stopped
  win.destroy()
  await handle?.close()

  // Fotogramas reales que hay en el archivo: si el codificador no da abasto, aquí se ve.
  let frames = null
  if (handle && ffmpegPath) {
    const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', filePath, '-map', '0:v', '-f', 'null', '-'], { encoding: 'utf8' })
    const m = [...(r.stderr || '').matchAll(/frame=\s*(\d+)/g)].pop()
    frames = m ? Number(m[1]) : null
  }
  const secs = (Date.now() - start) / 1000
  const half = Math.floor(samples.length / 2)
  const avg = (arr, key) => +(arr.reduce((a, x) => a + (key ? (x.cores[key] ?? 0) : x.total), 0) / Math.max(arr.length, 1)).toFixed(3)
  const firstHalf = samples.slice(1, half), secondHalf = samples.slice(half)
  const summary = {
    spec, mimeType: info.mimeType, hwProbe: info.probes,
    coresTotal: { primeraMitad: avg(firstHalf), segundaMitad: avg(secondHalf) },
    coresRenderer: { primeraMitad: avg(firstHalf, 'Tab'), segundaMitad: avg(secondHalf, 'Tab') },
    coresGpu: { primeraMitad: avg(firstHalf, 'GPU'), segundaMitad: avg(secondHalf, 'GPU') },
    memRendererMB: { inicio: samples[1]?.privMB.Tab, final: samples.at(-1)?.privMB.Tab },
    memGpuMB: { inicio: samples[1]?.privMB.GPU, final: samples.at(-1)?.privMB.GPU },
    memBrowserMB: { inicio: samples[1]?.privMB.Browser, final: samples.at(-1)?.privMB.Browser },
    MB: +(bytes / 1048576).toFixed(1), MBporHora: +((bytes / 1048576) * 3600 / secs).toFixed(0),
    fotogramas: frames, fpsReal: frames ? +(frames / secs).toFixed(2) : null,
    captura: pantalla ? lastProbe : undefined,
    sumidero: SINK, gc: FORCE_GC,
    jsVentana: { inicio: samples[1]?.jsVentana, final: samples.at(-1)?.jsVentana },
    jsPrincipal: { inicio: samples[1]?.jsPrincipal, final: samples.at(-1)?.jsPrincipal },
  }
  if (DELETE_VIDEOS && handle) await fsp.rm(filePath, { force: true })
  console.log(JSON.stringify(summary))
  return { ...summary, samples }
}

app.whenReady().then(async () => {
  // Como la app en modo "solo audio": pantalla principal sin selector.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const screens = await desktopCapturer.getSources({ types: ['screen'] })
    cb(screens[0] ? { video: screens[0] } : {})
  })
  console.log(`Resultados en ${OUT_DIR} · ${MINUTES} min por prueba · ${TESTS.join(', ')}`)
  const results = []
  for (const spec of TESTS) {
    results.push(await runTest(spec.trim()))
    await fsp.writeFile(path.join(OUT_DIR, 'resultados.json'), JSON.stringify(results, null, 1))
    await new Promise(r => setTimeout(r, 5000)) // que se calme la CPU entre prueba y prueba
  }
  app.quit()
})
app.on('window-all-closed', () => { /* no salir entre prueba y prueba */ })
