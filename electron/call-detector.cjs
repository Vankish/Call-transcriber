// ── Detector de llamadas ──────────────────────────────────────────────────────
// A David se le olvidaba darle a grabar antes de las llamadas. En vez de un bot que
// entra en la reunión (de pago y lo ve el lead), la app mira el propio Windows:
// qué programas tienen una sesión de audio activa en algún micrófono. Si un
// navegador graba del micro y una de sus ventanas es un Meet, hay llamada.
//
// Antes se leía del registro (CapabilityAccessManager), pero desde Windows 11
// 26300 eso ya no se actualiza: va a una base de datos que solo lee un
// administrador. Las sesiones de audio las ve cualquier programa.
//
// Lo lee un PowerShell que se queda en marcha (mic-watch.ps1) en vez de un módulo
// nativo: no hay nada que compilar para Electron.
const { execFile, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const POLL_MS = 2000
// Tres lecturas seguidas con llamada (~6 s) antes de empezar: abrir Meet un segundo
// para mirar algo no debe crear una grabación.
const START_HITS = 3
// Al colgar, Meet suelta el micro en el acto. Se para en cuanto dos lecturas
// seguidas (~2-4 s) lo ven libre: David quiere que pare al colgar, no 20 s después.
// Con una sola lectura, cambiar de micrófono en mitad de la llamada la partiría.
const END_MISSES = 2
// Un navegador con el micro abierto sin ventana de Meet a la vista (otra pestaña
// delante, o una llamada de WhatsApp Web) también cuenta, pero solo si sigue así
// ~45 s: un audio de WhatsApp o un dictado no llegan.
const START_HITS_WEAK = 22

// Navegadores: solo cuentan si una ventana suya es un Meet (el micro del navegador
// también lo usan WhatsApp Web, un dictado…). En la pestaña de la llamada Meet se
// titula "Meet - abc-defg-hij" o con el nombre del evento.
const BROWSERS = ['chrome.exe', 'msedge.exe', 'brave.exe', 'firefox.exe', 'opera.exe', 'vivaldi.exe']
const MEET_TITLE = /(^|[\s(])(Google\s)?Meet(\b|$)/i
// Apps de escritorio que solo abren el micro para llamar.
const CALL_APPS = [
  { name: 'Zoom', match: /^zoom\.exe$/i, exe: 'Zoom.exe' },
  { name: 'Teams', match: /^(ms-)?teams\.exe$/i, exe: 'ms-teams.exe' },
]

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)))
  })
}

// ── El vigilante del micro ──
// Su última lectura: los .exe que graban del micro, y cuándo llegó.
let micLast = { users: [], at: 0 }
let watcher = null
let watcherStopped = false

function startMicWatcher(log) {
  if (watcher || watcherStopped) return
  // PowerShell no puede leer un script de dentro del asar: se copia a temp.
  const script = path.join(os.tmpdir(), 'call-transcriber-mic-watch.ps1')
  try {
    fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'mic-watch.ps1')))
  } catch (err) {
    log?.warn(`[llamada] no se pudo preparar el vigilante del micro: ${err?.message || err}`)
    return
  }
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  watcher = child
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += String(d)
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('MIC ')) micLast = { users: line.slice(4).split('|').filter(Boolean), at: Date.now() }
      else if (line.startsWith('ERR ')) log?.warn(`[llamada] vigilante del micro: ${line.slice(4)}`)
    }
  })
  child.stderr.on('data', (d) => log?.warn(`[llamada] vigilante del micro: ${String(d).trim().slice(0, 300)}`))
  const restart = () => {
    if (watcher !== child) return
    watcher = null
    // Si se cae, vuelve a arrancar; una llamada en curso no se corta por eso.
    if (!watcherStopped) setTimeout(() => startMicWatcher(log), 5000)
  }
  child.on('exit', restart)
  child.on('error', (err) => { log?.warn(`[llamada] no arranca el vigilante del micro: ${err?.message || err}`); restart() })
}

// Programas con el micro abierto ahora mismo (nombre del .exe), o null si el
// vigilante no ha dicho nada en los últimos segundos (no se sabe).
async function micUsers() {
  return Date.now() - micLast.at < 6000 ? micLast.users : null
}

// Títulos de las ventanas de un programa. Si no está en marcha devuelve [] (y eso
// también descarta los LastUsedTimeStop = 0 que deja un programa que se colgó).
async function windowTitles(exe) {
  const out = await run('tasklist', ['/v', '/fo', 'csv', '/nh', '/fi', `imagename eq ${exe}`])
  const titles = []
  for (const line of out.split(/\r?\n/)) {
    const cols = line.match(/"([^"]*)"/g)
    if (cols && cols.length >= 9) titles.push(cols[cols.length - 1].slice(1, -1))
  }
  return titles
}

const exeName = (p) => (p.split('\\').pop() ?? '').toLowerCase()

// ¿Hay una llamada ahora? Devuelve { app, title }, null si no, o undefined si no se
// sabe (el vigilante del micro no responde).
// `strict`: al empezar se exige la ventana de Meet; durante la llamada basta con
// que el navegador siga con el micro (la pestaña de Meet puede no ser la activa).
async function detectCall(strict, current) {
  const users = await micUsers()
  if (!users) return undefined
  let weak = null
  for (const u of users) {
    const name = exeName(u)
    if (BROWSERS.includes(name)) {
      const titles = await windowTitles(name)
      if (!titles.length) continue
      if (!strict && current?.exe === name) return current
      const meet = titles.find(t => MEET_TITLE.test(t))
      if (meet) return { app: 'Google Meet', exe: name, title: meet.replace(/\s+-\s+(Google Chrome|Microsoft Edge|Brave|Mozilla Firefox|Opera|Vivaldi)$/i, '') }
      weak = weak ?? { app: 'Google Meet', exe: name, title: '', weak: true }
      continue
    }
    const callApp = CALL_APPS.find(a => a.match.test(u))
    if (callApp) {
      return { app: callApp.name, exe: name || callApp.exe, title: '' }
    }
  }
  return weak
}

// Arranca el sondeo. `onEvent` recibe { type: 'start' | 'end', app, title }.
function startCallDetector({ isEnabled, onEvent, log }) {
  if (process.platform !== 'win32') return () => {}
  watcherStopped = false
  startMicWatcher(log)
  let current = null
  let hits = 0
  let misses = 0
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      if (!current && !isEnabled()) { hits = 0; return }
      const call = await detectCall(!current, current)
      if (call === undefined) return // sin lectura del micro: ni empieza ni se corta
      if (!current) {
        hits = call ? hits + 1 : 0
        if (call && hits >= (call.weak ? START_HITS_WEAK : START_HITS)) {
          current = call; hits = 0; misses = 0
          log?.info(`[llamada] empieza: ${call.app} ${call.title}`)
          onEvent({ type: 'start', app: call.app, title: call.title })
        }
      } else if (call) {
        misses = 0
      } else if (++misses >= END_MISSES) {
        log?.info(`[llamada] termina: ${current.app}`)
        const ended = current
        current = null; misses = 0
        onEvent({ type: 'end', app: ended.app, title: ended.title })
      }
    } catch (err) {
      log?.warn(`[llamada] fallo al comprobar: ${err?.message || err}`)
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => { void tick() }, POLL_MS)
  return () => {
    clearInterval(timer)
    watcherStopped = true
    watcher?.kill()
    watcher = null
  }
}

// La ventana que se graba cuando la grabación con vídeo la lanza el detector. Nadie
// está mirando para elegirla en el selector, así que se busca la ventana de la
// llamada por su título (el que vio el detector, sin el " - Google Chrome" del final)
// y, si no aparece, la pantalla principal: una grabación sin la ventana justa vale
// más que una grabación esperando a un clic que no llega.
function findCallSource(sources, title) {
  const windows = sources.filter(s => !s.id.startsWith('screen:'))
  const wanted = (title || '').trim()
  const byTitle = wanted && windows.find(s => s.name === wanted || s.name.startsWith(`${wanted} - `))
  return byTitle || sources.find(s => s.id.startsWith('screen:')) || null
}

module.exports = { startCallDetector, detectCall, findCallSource }
