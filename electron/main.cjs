const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')
const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  session,
  shell,
} = require('electron')
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked')
const providers = require('./providers.cjs')
const { autoUpdater } = require('electron-updater')
const log = require('electron-log')

const isDev = process.env.ELECTRON_DEV === '1'

let mainWindowRef = null
let pendingCaptureSourceResolve = null
let nextCaptureWantsVideo = false

// ── Auto-actualización (electron-updater + GitHub Releases) ───────────────────
function sendUpdaterEvent(payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:event', payload)
  }
}

function setupAutoUpdater() {
  log.transports.file.level = 'info'
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => sendUpdaterEvent({ status: 'checking' }))
  autoUpdater.on('update-available', (info) => sendUpdaterEvent({ status: 'available', version: info?.version }))
  autoUpdater.on('update-not-available', () => sendUpdaterEvent({ status: 'not-available' }))
  autoUpdater.on('error', (err) => sendUpdaterEvent({ status: 'error', message: String(err?.message || err) }))
  autoUpdater.on('download-progress', (p) => sendUpdaterEvent({ status: 'downloading', percent: Math.round(p?.percent || 0) }))
  autoUpdater.on('update-downloaded', (info) => sendUpdaterEvent({ status: 'downloaded', version: info?.version }))

  // No bloquear el arranque; comprobar tras un breve margen.
  if (!isDev) {
    setTimeout(() => { autoUpdater.checkForUpdates().catch((e) => log.warn('checkForUpdates failed', e)) }, 4000)
  }
}

ipcMain.handle('updates:check', async () => {
  if (isDev) return { ok: false, dev: true }
  try {
    const r = await autoUpdater.checkForUpdates()
    return { ok: true, version: r?.updateInfo?.version }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
})

ipcMain.handle('updates:install', () => {
  autoUpdater.quitAndInstall()
})

ipcMain.handle('app:get-version', () => app.getVersion())

function startAuthCallbackServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Autenticando...</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0f4ff}
.box{background:#fff;border-radius:12px;padding:2rem 3rem;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1)}
h2{color:#2563eb;margin:0 0 .5rem}p{color:#555;margin:0}</style></head>
<body><div class="box"><h2>Iniciando sesión...</h2><p>Puedes cerrar esta ventana.</p></div>
<script>
const hash = window.location.hash.substring(1)
const params = new URLSearchParams(hash)
const data = {}
for (const [k,v] of params) data[k]=v
fetch('/auth-callback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
  .then(()=>{document.querySelector('h2').textContent='✓ Sesión iniciada'})
  .catch(()=>{})
</script></body></html>`)
      return
    }
    if (req.method === 'POST' && req.url === '/auth-callback') {
      // Seguridad: solo aceptar el callback de la propia página servida en localhost:3000.
      // Una web externa que intente inyectar tokens traerá su propio Origin → se rechaza.
      const origin = req.headers.origin
      const allowed = ['http://localhost:3000', 'http://127.0.0.1:3000']
      if (origin && !allowed.includes(origin)) {
        res.writeHead(403); res.end('forbidden')
        return
      }
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          if (mainWindowRef && !mainWindowRef.isDestroyed()) {
            mainWindowRef.webContents.send('auth:magic-link-tokens', data)
          }
        } catch {}
        res.writeHead(200); res.end('ok')
      })
      return
    }
    res.writeHead(404); res.end()
  })
  server.listen(3000, '127.0.0.1')
}

function sanitizeName(value) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim()
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    useContentSize: true,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    // Empaquetada, el icono va incrustado en el .exe por electron-builder. En
    // desarrollo no hay .exe propio, así que sin esto saldría el logo genérico
    // de Electron. build/icon.ico no se empaqueta (no está en build.files), de
    // ahí que solo se pase en dev.
    ...(isDev ? { icon: path.join(__dirname, '..', 'build', 'icon.ico') } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindowRef = mainWindow
  mainWindow.maximize()

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    return
  }

  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
}

// ── Instancia única ───────────────────────────────────────────────────────────
// Sin esto, cada vez que se abre el acceso directo se lanza una app nueva (varias
// ventanas + choque del servidor de login en el puerto 3000). Con el lock, la
// segunda apertura simplemente enfoca la ventana que ya está abierta.
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = mainWindowRef
    if (w && !w.isDestroyed()) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })

  app.whenReady().then(() => {
  startAuthCallbackServer()

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      // Modo "solo audio": no hay que elegir ventana/pantalla, solo necesitamos
      // el audio de sistema vía loopback. Se auto-selecciona la pantalla principal
      // sin mostrar ningún selector, igual que antes de que existiera la grabación de vídeo.
      if (!nextCaptureWantsVideo) {
        const screens = await desktopCapturer.getSources({ types: ['screen'] })
        if (!screens[0]) { callback({}); return }
        callback({ video: screens[0], audio: 'loopback' })
        return
      }

      // fetchWindowIcons desactivado: el icono no se envía ni se usa en ningún sitio
      // de la UI (solo se manda id/name/thumbnail) — pedirlo era trabajo tirado que
      // solo alargaba la espera de este selector, tanto más cuantas más ventanas hay abiertas.
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 300, height: 200 },
        fetchWindowIcons: false,
      })

      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('capture:sources', sources.map((s) => ({
          id: s.id,
          name: s.name,
          thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
          type: s.id.startsWith('screen:') ? 'screen' : 'window',
        })))
      }

      const chosenId = await new Promise((resolve) => { pendingCaptureSourceResolve = resolve })
      const chosen = sources.find((s) => s.id === chosenId)
      if (!chosen) { callback({}); return }
      callback({ video: chosen, audio: 'loopback' })
    },
    {
      useSystemPicker: false,
    },
  )

  createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
  })
}

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'call-transcriber-config.json')

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { groqApiKey: null, transcriptionModel: 'whisper-large-v3', transcriptionLanguage: 'es', summaryModel: 'llama-3.3-70b-versatile' }
  }
}

function convertToFormat(inputPath, outputPath, format) {
  return new Promise((resolve, reject) => {
    const args = format === 'wav'
      ? ['-i', inputPath, '-vn', '-ar', '44100', '-ac', '2', '-y', outputPath]
      : ['-i', inputPath, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '128k', '-y', outputPath]
    const proc = spawn(ffmpegPath, args)
    let stderr = ''
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('error', err => reject(new Error(`ffmpeg conversion failed: ${err.message}`)))
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg conversion failed: ${stderr.slice(-300)}`))
    })
  })
}

ipcMain.handle('recording:save', async (_event, payload) => {
  const recordingsDir = path.join(app.getPath('documents'), 'CallTranscriber')
  await fs.mkdir(recordingsDir, { recursive: true })

  const rawExtension = payload.extension || 'webm'
  const desiredFormat = payload.format || null
  const candidateSafe = sanitizeName(payload.candidateName || 'candidata')
  const createdSafe = payload.createdAt.replace(/[:.]/g, '-')
  const buffer = Buffer.from(payload.audioBytes)

  const rawPath = path.join(recordingsDir, `${candidateSafe}_${createdSafe}_${payload.interviewId}.${rawExtension}`)
  await fs.writeFile(rawPath, buffer)

  if (desiredFormat && desiredFormat !== rawExtension) {
    const convertedPath = path.join(recordingsDir, `${candidateSafe}_${createdSafe}_${payload.interviewId}.${desiredFormat}`)
    try {
      await convertToFormat(rawPath, convertedPath, desiredFormat)
      await fs.unlink(rawPath).catch(() => {})
      return { filePath: convertedPath }
    } catch {
      // If conversion fails, keep the raw file
    }
  }

  return { filePath: rawPath }
})

ipcMain.handle('recording:save-system', async (_event, payload) => {
  const recordingsDir = path.join(app.getPath('documents'), 'CallTranscriber')
  await fs.mkdir(recordingsDir, { recursive: true })

  const rawExtension = payload.extension || 'webm'
  const candidateSafe = sanitizeName(payload.candidateName || 'candidata')
  const createdSafe = payload.createdAt.replace(/[:.]/g, '-')
  const buffer = Buffer.from(payload.audioBytes)

  const filePath = path.join(recordingsDir, `${candidateSafe}_${createdSafe}_${payload.interviewId}_system.${rawExtension}`)
  await fs.writeFile(filePath, buffer)

  return { filePath }
})

ipcMain.handle('capture:set-mode', (_event, wantsVideo) => {
  nextCaptureWantsVideo = !!wantsVideo
  return { ok: true }
})

ipcMain.handle('capture:pick-source', (_event, sourceId) => {
  if (pendingCaptureSourceResolve) { pendingCaptureSourceResolve(sourceId); pendingCaptureSourceResolve = null }
  return { ok: true }
})

ipcMain.handle('recording:save-video', async (_event, payload) => {
  const recordingsDir = path.join(app.getPath('documents'), 'CallTranscriber')
  await fs.mkdir(recordingsDir, { recursive: true })

  const candidateSafe = sanitizeName(payload.candidateName || 'candidata')
  const createdSafe = payload.createdAt.replace(/[:.]/g, '-')
  const buffer = Buffer.from(payload.videoBytes)

  const videoPath = path.join(recordingsDir, `${candidateSafe}_${createdSafe}_${payload.interviewId}_video.webm`)
  await fs.writeFile(videoPath, buffer)

  return { filePath: videoPath }
})

ipcMain.handle('config:get', async () => {
  const config = await readConfig()
  // Se entrega siempre con stt/llm resueltos, para que la interfaz no tenga que
  // saber nada del formato antiguo ni duplicar la lógica de migración.
  return { ...config, ...providers.migrateConfig(config) }
})

ipcMain.handle('config:save', async (_event, payload) => {
  await fs.writeFile(CONFIG_FILE(), JSON.stringify(payload), 'utf-8')
  return { ok: true }
})

const DEFAULT_CHUNK_DURATION_SEC = 600 // 10 minutos por chunk

function getAudioDurationSec(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', filePath])
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', () => resolve(null))
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
      resolve(m ? parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]) : null)
    })
  })
}

function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = ['-i', inputPath, '-vn', '-ar', '16000', '-ac', '1', '-b:a', '32k', '-y', outputPath]
    const proc = spawn(ffmpegPath, args)
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', (err) => reject(new Error(`ffmpeg no pudo iniciarse: ${err.message}`)))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg conversión falló: ${stderr.slice(-300)}`))
    })
  })
}

// Whisper (y por tanto Groq, que usa el mismo modelo) a veces "alucina" frases
// hechas (p.ej. "gracias por ver el vídeo", coletillas repetidas) cuando el tramo
// de audio es silencio o ruido sin voz real, en vez de devolver un segmento vacío.
// Los mismos umbrales que usa el propio Whisper de OpenAI para descartar esto:
// probabilidad alta de "no es voz" + confianza baja, o texto muy repetitivo.
function filterHallucinatedSegments(rawSegments) {
  return rawSegments.filter((s) => {
    const noSpeechProb = s.no_speech_prob ?? 0
    const avgLogprob = s.avg_logprob ?? 0
    const compressionRatio = s.compression_ratio ?? 0
    if (noSpeechProb > 0.6 && avgLogprob < -1) return false
    if (compressionRatio > 2.4) return false
    return true
  })
}

function formatDiarizedTranscript(segments) {
  const speakerMap = {}
  let speakerCount = 0
  let result = ''
  let currentSpeaker = null

  for (const segment of segments) {
    const rawSpeaker = segment.speaker ?? null
    if (!rawSpeaker) continue

    if (!(rawSpeaker in speakerMap)) {
      speakerCount++
      speakerMap[rawSpeaker] = `Hablante ${speakerCount}`
    }

    const speaker = speakerMap[rawSpeaker]
    const text = (segment.text || '').trim()
    if (!text) continue

    if (speaker !== currentSpeaker) {
      if (result) result += '\n'
      result += `[${speaker}]: ${text}`
      currentSpeaker = speaker
    } else {
      result += ' ' + text
    }
  }

  return result
}

async function transcribeChunk(filePath, provider, language) {
  const audioBuffer = await fs.readFile(filePath)
  const { text, segments: rawSegments } = await providers.transcribe(provider, {
    buffer: audioBuffer,
    fileName: path.basename(filePath),
    language,
  })

  const segments = filterHallucinatedSegments(rawSegments)

  if (segments.some((s) => s.speaker !== undefined)) {
    return formatDiarizedTranscript(segments)
  }

  // Si el proveedor no devolvió segmentos usamos el texto plano tal cual, porque
  // no hay forma de filtrar sin las métricas por segmento.
  return rawSegments.length
    ? segments.map((s) => (s.text || '').trim()).filter(Boolean).join(' ')
    : text
}

async function splitMp3IntoChunks(mp3Path, durationSec, tmpDir, chunkDurationSec = DEFAULT_CHUNK_DURATION_SEC) {
  const numChunks = Math.ceil(durationSec / chunkDurationSec)
  const chunkPaths = []

  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkDurationSec
    const chunkPath = path.join(tmpDir, `chunk_${i}.mp3`)
    await new Promise((resolve, reject) => {
      const args = ['-i', mp3Path, '-ss', String(start), '-t', String(chunkDurationSec), '-c', 'copy', '-y', chunkPath]
      const proc = spawn(ffmpegPath, args)
      let stderr = ''
      proc.stderr.on('data', (d) => { stderr += d.toString() })
      proc.on('error', (err) => reject(new Error(`ffmpeg no pudo iniciarse (chunk ${i + 1}): ${err.message}`)))
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg chunk ${i + 1} falló: ${stderr.slice(-300)}`))
      })
    })
    chunkPaths.push(chunkPath)
  }

  return chunkPaths
}

async function transcribeAudio(filePath, provider, language, chunkDurationSec = DEFAULT_CHUNK_DURATION_SEC) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-'))

  try {
    const mp3Path = path.join(tmpDir, 'audio.mp3')
    await convertToMp3(filePath, mp3Path)

    const stat = await fs.stat(mp3Path)

    // Cada proveedor declara su propio límite de tamaño; ya no es el de Groq.
    if (stat.size <= provider.maxBytes) {
      return await transcribeChunk(mp3Path, provider, language)
    }

    const durationSec = await getAudioDurationSec(mp3Path)
    if (!durationSec) throw new Error('No se pudo leer la duración del audio.')

    const chunkPaths = await splitMp3IntoChunks(mp3Path, durationSec, tmpDir, chunkDurationSec)
    const texts = await Promise.all(chunkPaths.map((p) => transcribeChunk(p, provider, language)))
    return texts.join('\n\n')
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function identifySpeakers(transcript, llmProvider, candidateName) {
  if (!transcript || !llmProvider.apiKey) return transcript
  const candidateHint = candidateName
    ? `El nombre del candidato es "${candidateName}". Si aparece ese nombre en el texto (o alguien se presenta con él), esa persona es el [Candidato].`
    : ''
  const system =
    'Eres un asistente experto en entrevistas de trabajo. Recibirás la transcripción de una entrevista ' +
    '(puede venir con etiquetas genéricas como [Hablante 1] / [Hablante 2] o sin etiquetas).\n' +
    'Tu tarea es reetiquétar CADA turno de conversación con exactamente una de estas etiquetas: [Entrevistador]: o [Candidato]:\n\n' +
    'SEÑALES para identificar al entrevistador:\n' +
    '- Hace preguntas sobre el historial, experiencia o motivaciones del candidato\n' +
    '- Presenta la empresa, el puesto o el proceso de selección\n' +
    '- Conduce y estructura la conversación\n' +
    '- Habla en nombre de la empresa ("nosotros buscamos...", "el equipo es...")\n\n' +
    'SEÑALES para identificar al candidato:\n' +
    '- Habla de su propia trayectoria, empresas donde ha trabajado, estudios\n' +
    '- Usa primera persona para describir su experiencia ("yo estuve en...", "llevo X años...")\n' +
    '- Responde preguntas sobre sí mismo\n' +
    (candidateHint ? candidateHint + '\n\n' : '') +
    'REGLAS:\n' +
    '- Conserva el texto EXACTAMENTE como está; solo sustituye o añade la etiqueta al inicio de cada turno\n' +
    '- Agrupa frases consecutivas del mismo hablante bajo una sola etiqueta\n' +
    '- Si un fragmento es completamente ambiguo, asígnalo al hablante más probable por contexto\n' +
    '- Responde ÚNICAMENTE con la transcripción etiquetada, sin explicaciones ni texto adicional'

  // Si el proveedor de resumen falla aquí, se devuelve la transcripción sin
  // etiquetar en vez de romper: mejor sin etiquetas que sin transcripción.
  try {
    const out = await providers.chat(llmProvider, { system, user: transcript, temperature: 0.1, maxTokens: 8000 })
    return out || transcript
  } catch {
    return transcript
  }
}

// ── Separación determinista de hablantes por pistas ──────────────────────────
// Cuando se graba con audio de sistema, además de la mezcla (mic+sistema) se guarda
// una pista SOLO con el audio del sistema = voz limpia del interlocutor. Transcribiendo
// ambas y conociendo qué pista es quién, ya NO hace falta que una IA adivine hablantes.
//
// Variante de transcribeChunk que devuelve los segmentos crudos (con marcas de tiempo)
// en vez del texto ya formateado, para poder combinarlos entre pistas.
async function transcribeChunkSegments(filePath, provider, language) {
  const audioBuffer = await fs.readFile(filePath)
  const { text: fullText, segments: rawSegments, words } = await providers.transcribe(provider, {
    buffer: audioBuffer,
    fileName: path.basename(filePath),
    language,
  })

  const segments = filterHallucinatedSegments(rawSegments)
  const text = segments.map((s) => (s.text || '').trim()).filter(Boolean).join(' ') || fullText
  return { text, segments, words: words ?? [] }
}

async function transcribeAudioSegments(filePath, provider, language, chunkDurationSec = DEFAULT_CHUNK_DURATION_SEC) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-'))
  try {
    const mp3Path = path.join(tmpDir, 'audio.mp3')
    await convertToMp3(filePath, mp3Path)

    const stat = await fs.stat(mp3Path)
    if (stat.size <= provider.maxBytes) {
      return await transcribeChunkSegments(mp3Path, provider, language)
    }

    const durationSec = await getAudioDurationSec(mp3Path)
    if (!durationSec) throw new Error('No se pudo leer la duración del audio.')

    const chunkPaths = await splitMp3IntoChunks(mp3Path, durationSec, tmpDir, chunkDurationSec)
    const results = await Promise.all(chunkPaths.map((p) => transcribeChunkSegments(p, provider, language)))
    const text = results.map((r) => r.text).join('\n\n')
    // Reajusta las marcas de tiempo de cada chunk a la línea temporal absoluta.
    const shift = (items, i) => items.map((x) => ({
      ...x,
      start: (x.start ?? 0) + i * chunkDurationSec,
      end: (x.end ?? 0) + i * chunkDurationSec,
    }))
    const segments = results.flatMap((r, i) => shift(r.segments, i))
    const words = results.flatMap((r, i) => shift(r.words, i))
    return { text, segments, words }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

// Fracción de la duración de `seg` que solapa temporalmente con cualquier segmento de `others`.
function segOverlapFraction(seg, others) {
  const a0 = seg.start ?? 0
  const a1 = seg.end ?? a0
  const dur = Math.max(a1 - a0, 0.001)
  let overlap = 0
  for (const o of others) {
    const b0 = o.start ?? 0
    const b1 = o.end ?? b0
    const lo = Math.max(a0, b0)
    const hi = Math.min(a1, b1)
    if (hi > lo) overlap += hi - lo
  }
  return overlap / dur
}

// Tramos con voz de una pista, MEDIDOS sobre el audio con ffmpeg.
//
// No se usan las marcas de tiempo del proveedor a propósito: en pistas con
// silencios largos (la del audio de sistema lo es, porque el interlocutor calla
// mientras habla el entrevistador) ElevenLabs estira la primera palabra del turno
// hacia atrás hasta cubrir el silencio entero — se han visto "palabras" de 21
// segundos. Construir el recorte sobre eso se comía frases enteras del micro.
// La pista de sistema solo contiene una voz, así que "donde hay sonido, habla el
// interlocutor" es un criterio exacto y no necesita IA.
function getSpeechIntervals(filePath, noiseDb = -40, minSilenceSec = 0.6) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', filePath, '-af', `silencedetect=n=${noiseDb}dB:d=${minSilenceSec}`, '-f', 'null', '-'])
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', () => resolve(null))
    proc.on('close', () => {
      const hms = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + parseFloat(s)
      // Los .webm grabados en directo no llevan duración en la cabecera
      // (Duration: N/A), así que se toma la última marca de progreso que imprime
      // ffmpeg al terminar de decodificar, que sí es fiable.
      const d = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/)
      const progress = [...stderr.matchAll(/time=\s*(\d+):(\d+):([\d.]+)/g)].pop()
      const total = d ? hms(d[1], d[2], d[3]) : (progress ? hms(progress[1], progress[2], progress[3]) : null)
      if (!total) return resolve(null)

      const silences = []
      const re = /silence_start:\s*([-\d.]+)|silence_end:\s*([\d.]+)/g
      let m, open = null
      while ((m = re.exec(stderr))) {
        if (m[1] !== undefined) open = Math.max(0, parseFloat(m[1]))
        else if (open !== null) { silences.push([open, parseFloat(m[2])]); open = null }
      }
      if (open !== null) silences.push([open, total])

      // El complemento de los silencios es la voz.
      const speech = []
      let cursor = 0
      for (const [s, e] of silences) {
        if (s > cursor) speech.push([cursor, s])
        cursor = Math.max(cursor, e)
      }
      if (cursor < total) speech.push([cursor, total])
      resolve(speech)
    })
  })
}

// Descarta las palabras cuyo centro cae dentro de un tramo de voz del interlocutor.
// Al trabajar palabra a palabra, una pregunta pegada a la respuesta ya no se pierde
// entera: se recorta solo el eco.
function wordsOutsideIntervals(words, intervals, pad = 0.2) {
  return words.filter((w) => {
    const mid = ((w.start ?? 0) + (w.end ?? 0)) / 2
    return !intervals.some(([s, e]) => mid >= s - pad && mid <= e + pad)
  })
}

// Reagrupa palabras sueltas en frases, cortando por silencio.
function segmentsFromWords(words, gapSec = 0.8) {
  const segments = []
  let current = null
  for (const w of words) {
    if (!current || (w.start ?? 0) - (current.end ?? 0) > gapSec) {
      current = { start: w.start ?? 0, end: w.end ?? 0, text: w.text }
      segments.push(current)
    } else {
      current.text += ' ' + w.text
      current.end = w.end ?? current.end
    }
  }
  return segments
}

// Combina la mezcla (mic+sistema) con la pista limpia del sistema:
//  · sistema  → [Candidato] (voz del interlocutor, ya aislada, se conserva entera)
//  · mezcla   → [Entrevistador], PERO descartando los segmentos que solapan en el
//    tiempo con la voz del sistema. Eso elimina el eco/duplicado (la voz del candidato
//    que también aparece en la mezcla) — que fue justo lo que rompió el intento anterior.
function mergeSeparatedTranscript(mixedSegments, systemSegments, interviewerLabel, candidateLabel) {
  const rows = []
  for (const s of systemSegments) {
    const text = (s.text || '').trim()
    if (text) rows.push({ start: s.start ?? 0, label: candidateLabel, text })
  }
  for (const s of mixedSegments) {
    const text = (s.text || '').trim()
    if (!text) continue
    if (segOverlapFraction(s, systemSegments) > 0.5) continue // hablaba el candidato: ya está en la pista limpia
    rows.push({ start: s.start ?? 0, label: interviewerLabel, text })
  }
  rows.sort((a, b) => a.start - b.start)

  let result = ''
  let currentLabel = null
  for (const { label, text } of rows) {
    if (label !== currentLabel) {
      if (result) result += '\n'
      result += `[${label}]: ${text}`
      currentLabel = label
    } else {
      result += ' ' + text
    }
  }
  return result
}

ipcMain.handle('transcription:run', async (_event, { filePath, systemFilePath, language, candidateName }) => {
  const config = await readConfig()
  const stt = providers.resolveStt(config)
  const llm = providers.resolveLlm(config)
  if (!stt.apiKey && stt.id !== 'custom') {
    throw new Error(`Falta la API key de ${stt.label}. Configúrala en Ajustes → Motores de IA.`)
  }
  if (!stt.model) {
    throw new Error(`Falta indicar el modelo de ${stt.label}. Configúralo en Ajustes → Motores de IA.`)
  }
  const chunkDuration = (config.chunkDuration && config.chunkDuration >= 5) ? config.chunkDuration : DEFAULT_CHUNK_DURATION_SEC

  const systemExists = systemFilePath
    ? await fs.access(systemFilePath).then(() => true).catch(() => false)
    : false

  log.info(`[transcripción] ${stt.label}/${stt.model} · archivo=${path.basename(filePath)} · pista de sistema=${systemExists ? 'sí' : 'no'}`)

  // CAMINO NUEVO: separación determinista por pistas (cuando existe la pista de
  // sistema Y el proveedor devuelve marcas de tiempo — sin ellas no se pueden
  // cruzar las dos pistas, así que se cae al camino clásico sin avisar al usuario).
  if (systemExists && stt.canSegment) {
    try {
      const [mixed, system, speech] = await Promise.all([
        transcribeAudioSegments(filePath, stt, language || 'auto', chunkDuration),
        transcribeAudioSegments(systemFilePath, stt, language || 'auto', chunkDuration),
        getSpeechIntervals(systemFilePath),
      ])

      // Mejor camino: marcas por palabra + tramos de voz medidos en el audio.
      // Si el proveedor no da palabras (Whisper) o falla la medición, se cae a los
      // criterios anteriores en vez de romper.
      let mixedSegments
      let modo
      if (mixed.words?.length && speech?.length) {
        mixedSegments = segmentsFromWords(wordsOutsideIntervals(mixed.words, speech))
        modo = 'palabras + audio medido'
      } else if (mixed.words?.length) {
        mixedSegments = segmentsFromWords(wordsOutsideIntervals(mixed.words, system.segments.map((s) => [s.start ?? 0, s.end ?? 0])))
        modo = 'palabras + marcas del proveedor'
      } else {
        mixedSegments = mixed.segments
        modo = 'segmentos'
      }
      log.info(`[transcripción] recorte por ${modo}: ${mixed.segments.length} → ${mixedSegments.length} tramos del entrevistador`)
      // Etiquetas fijas [Entrevistador] / [Candidato]: el resumen depende de ellas.
      const merged = mergeSeparatedTranscript(mixedSegments, system.segments, 'Entrevistador', 'Candidato')
      const text = merged || [mixed.text, system.text].filter(Boolean).join('\n')
      return { text }
    } catch (err) {
      // Si algo falla en la vía separada, caemos al camino clásico de una sola pista
      // en vez de romper la transcripción.
      console.error('Fallo en la separación por pistas, usando pista única:', err)
    }
  }

  // CAMINO CLÁSICO: una sola pista mezclada. Si el proveedor ya separa hablantes
  // por sí mismo (Deepgram y similares), transcribeAudio devuelve el texto ya
  // etiquetado y no hace falta que un LLM lo adivine.
  let text = await transcribeAudio(filePath, stt, language || 'auto', chunkDuration)

  if (text.trim().length > 0 && !stt.canDiarize) {
    text = await identifySpeakers(text, llm, candidateName || '').catch(() => text)
  }

  return { text }
})

const CRITERIA_LABELS = {
  experiencia:    'Experiencia laboral',
  formacion:      'Formación académica',
  situacion:      'Situación personal',
  habilidades:    'Habilidades técnicas',
  idiomas:        'Idiomas',
  disponibilidad: 'Disponibilidad',
  salario:        'Pretensiones salariales',
  motivacion:     'Motivación y expectativas',
  blandas:        'Competencias interpersonales',
  adecuacion:     'Adecuación al puesto',
}

ipcMain.handle('summary:generate', async (_event, { transcript, criteria, summaryType, summaryContext, candidateName }) => {
  const config = await readConfig()
  const llm = providers.resolveLlm(config)
  if (llm.needsKey && !llm.apiKey) {
    throw new Error(`Falta la API key de ${llm.label}. Configúrala en Ajustes → Motores de IA.`)
  }

  const criteriaList = Array.isArray(criteria) && criteria.length > 0
    ? criteria.map(id => {
        if (id.startsWith('otros:')) {
          const text = id.slice(6).trim()
          return text || null
        }
        return CRITERIA_LABELS[id] || null
      }).filter(Boolean)
    : null
  // Enfoque del informe. La app nació para entrevistas de selección, pero el mismo
  // material sirve para reuniones de negocio, donde cambia el sujeto (ya no hay un
  // "candidato" a evaluar), los apartados y lo que se considera relevante.
  const isMeeting = summaryContext === 'reunion'

  const MEETING_SECTIONS = [
    'Acuerdos y próximos pasos (qué se decidió, quién hace qué y para cuándo)',
    'Necesidades y problemas del cliente',
    'Objeciones, riesgos y bloqueos',
    'Presupuesto, plazos y condiciones',
  ]

  // En modo reunión los apartados son SIEMPRE estos, ignorando los criterios de
  // evaluación del proyecto: son de selección de personal ("Formación académica",
  // "Pretensiones salariales") y en un acta de negocio solo producen secciones
  // vacías. Así "reunión" significa lo mismo en cualquier proyecto.
  const effectiveCriteria = isMeeting
    ? MEETING_SECTIONS
    : (criteriaList && criteriaList.length > 0 ? criteriaList : null)

  const fidelityRules =
    'REGLAS ESTRICTAS DE FIDELIDAD:\n' +
    (isMeeting
      // En una reunión ambas partes aportan: los compromisos y las peticiones
      // pueden salir de cualquiera de los dos lados de la mesa.
      ? '- La transcripción usa etiquetas [Entrevistador]: y [Candidato]:. Recoge lo relevante de AMBOS: acuerdos, peticiones y compromisos pueden venir de cualquiera de los dos.\n'
      : '- La transcripción usa etiquetas [Entrevistador]: y [Candidato]:. Extrae información solo de lo que dice el [Candidato]: salvo que se indique lo contrario.\n') +
    '- Extrae ÚNICAMENTE información mencionada de forma explícita en la transcripción. No infieras ni supongas nada.\n' +
    (isMeeting
      ? '- Presta máxima atención a cifras, fechas, plazos y nombres de empresas: asocia cada dato exactamente a aquello a lo que se refería, sin mezclarlos.\n'
      : '- Presta máxima atención a los nombres de empresas y los tiempos de permanencia: cada duración debe asociarse exactamente a la empresa a la que corresponde según la transcripción. No intercambies ni mezcles datos de distintas empresas o períodos.\n') +
    '- Si un dato concreto (fecha, duración, nombre) no aparece claramente en la transcripción, omítelo en lugar de suponerlo.\n' +
    'Responde en español.'

  let systemPrompt
  let userPrompt

  // Correspondencia explícita entre etiqueta y persona. Sin esto el modelo deduce
  // los nombres del propio texto y los cruza: cuando el entrevistador saluda
  // ("Hola Jarvis"), el nombre que aparece en SU turno es el del OTRO, y el modelo
  // acaba llamando Jarvis al entrevistador.
  const interviewerName = (config.userName || '').trim()
  const nameWarning =
    'No deduzcas los nombres a partir del texto: si un nombre propio aparece dentro de un turno, ' +
    'lo normal es que sea la persona a la que ese hablante se está dirigiendo, es decir, la OTRA.'
  const candidateRef = isMeeting
    ? 'CORRESPONDENCIA DE ETIQUETAS (es la única fuente válida para saber quién es quién):\n' +
      `- [Entrevistador]: ${interviewerName || 'quien convoca la reunión'}, por parte de nuestro equipo.\n` +
      `- [Candidato]: ${candidateName || 'la otra parte'}, el cliente o interlocutor externo.\n` +
      'Las etiquetas vienen de que la app se diseñó para entrevistas: aquí NO hay candidato que evaluar, ' +
      'sino dos partes reunidas. No hables de "el candidato" ni de "la entrevista" en el informe.\n' +
      nameWarning
    : 'CORRESPONDENCIA DE ETIQUETAS (es la única fuente válida para saber quién es quién):\n' +
      `- [Entrevistador]: ${interviewerName || 'quien conduce la entrevista'}. Hace las preguntas. NO es el sujeto del informe.\n` +
      `- [Candidato]: ${candidateName || 'la persona entrevistada'}. Responde. Es el sujeto del informe.\n` +
      nameWarning +
      (candidateName ? `\nRefiérete al candidato como ${candidateName} en el informe.` : '')

  if (summaryType === 'listado') {
    systemPrompt =
      (isMeeting
        ? 'Eres un analista de negocio que redacta actas de reuniones de trabajo. ' +
          'Genera un acta estructurada por secciones basándote en los apartados indicados. '
        : 'Eres un asistente experto en análisis de entrevistas de trabajo. ' +
          'Genera un listado estructurado por secciones basándote en los criterios indicados. ') +
      'Para cada sección usa un título en negrita seguido de bullets con la información extraída. ' +
      'Sé conciso y directo. ' +
      (isMeeting
        ? 'En los acuerdos y próximos pasos indica siempre responsable y plazo cuando se hayan mencionado. ' +
          'Si un apartado no se trató, escribe "No se trató" en vez de rellenarlo.'
        : 'No incluyas frases del tipo "el entrevistador preguntó" o "el candidato respondió".') +
      '\n\n' + candidateRef + '\n\n' + fidelityRules

    userPrompt = effectiveCriteria
      ? `Secciones a analizar:\n${effectiveCriteria.join('\n')}\n\nTranscripción:\n${transcript}`
      : `Transcripción:\n${transcript}`
  } else {
    const topicSentence = effectiveCriteria
      ? `Cubre específicamente los siguientes aspectos (en este orden si aplican): ${effectiveCriteria.join(', ')}.`
      : 'Organiza el contenido en párrafos temáticos: situación actual y disponibilidad, trayectoria profesional, competencias técnicas y habilidades clave, y adecuación al puesto.'

    systemPrompt =
      (isMeeting
        ? 'Eres un analista de negocio. Tu tarea es redactar un resumen narrativo de una reunión de trabajo ' +
          'a partir de su transcripción. ' +
          'Escribe en prosa fluida y densa en información útil para preparar el siguiente paso. ' +
          `${topicSentence} ` +
          'NO uses listas con guiones o puntos. ' +
          'Cierra siempre con los acuerdos alcanzados y los próximos pasos, indicando responsable y plazo si se mencionaron.\n\n'
        : 'Eres un experto en selección de personal. Tu tarea es redactar un informe narrativo del candidato ' +
          'basado en la transcripción de una entrevista de trabajo. ' +
          'Escribe en tercera persona, con prosa fluida y densa en información relevante. ' +
          `${topicSentence} ` +
          'NO uses listas con guiones o puntos. ' +
          'NO incluyas frases como "el entrevistador preguntó" o "el candidato respondió". ' +
          'Escribe como si fueran las notas de un reclutador experto que ha sintetizado la conversación.\n\n') +
      candidateRef + '\n\n' +
      fidelityRules

    userPrompt = `Transcripción:\n${transcript}`
  }

  const text = await providers.chat(llm, { system: systemPrompt, user: userPrompt, temperature: 0.1 })
  return { text }
})

// ── Catálogo y prueba de proveedores (Ajustes → Motores de IA) ───────────────

ipcMain.handle('providers:catalog', async () => ({
  stt: providers.STT_PRESETS,
  llm: providers.LLM_PRESETS,
}))

// Prueba la configuración que el usuario tiene en pantalla, sin necesidad de
// guardarla antes.
ipcMain.handle('providers:test', async (_event, { kind, draft }) => {
  const config = kind === 'stt' ? { stt: draft } : { llm: draft }
  if (kind === 'llm') return providers.testLlm(providers.resolveLlm(config))

  // Para transcripción hace falta un audio: se genera medio segundo de silencio
  // con ffmpeg, que basta para validar clave, URL y nombre de modelo.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-test-'))
  try {
    const probePath = path.join(tmpDir, 'probe.mp3')
    await new Promise((resolve, reject) => {
      const args = ['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '0.5', '-b:a', '32k', '-y', probePath]
      const proc = spawn(ffmpegPath, args)
      proc.on('error', reject)
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg falló generando el audio de prueba'))))
    })
    return await providers.testStt(providers.resolveStt(config), await fs.readFile(probePath))
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})

ipcMain.handle('export:pdf', async (_event, { html, fileName }) => {
  const { BrowserWindow, dialog } = require('electron')
  const { defaultPath } = await dialog.showSaveDialog({
    title: 'Guardar PDF',
    defaultPath: fileName || 'exportacion.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (!defaultPath) return { ok: false, cancelled: true }

  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise(resolve => win.webContents.once('did-finish-load', resolve))
  const pdfBuffer = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 1, bottom: 1, left: 1, right: 1 } })
  win.destroy()
  await fs.writeFile(defaultPath, pdfBuffer)
  return { ok: true, filePath: defaultPath }
})

ipcMain.handle('recordings:get-dir', async () => {
  const dir = path.join(app.getPath('documents'), 'CallTranscriber')
  await fs.mkdir(dir, { recursive: true })
  return dir
})

ipcMain.handle('shell:open-recordings-folder', async () => {
  const dir = path.join(app.getPath('documents'), 'CallTranscriber')
  await fs.mkdir(dir, { recursive: true })
  shell.openPath(dir)
})

ipcMain.handle('dialog:select-audio', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Importar grabación de audio',
    properties: ['openFile'],
    filters: [
      { name: 'Audio', extensions: ['mp3', 'mp4', 'm4a', 'wav', 'ogg', 'webm', 'flac', 'aac', 'opus', 'wma'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  })
  if (result.cancelled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('recording:delete', async (_event, { filePath }) => {
  try {
    await fs.unlink(filePath)
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

ipcMain.handle('auth:open-oauth-window', (_event, oauthUrl) => {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 560,
      height: 660,
      title: 'Iniciar sesión',
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })

    const interceptCallback = (url) => {
      if (url.startsWith('http://localhost')) {
        win.destroy()
        resolve(url)
        return true
      }
      return false
    }

    win.webContents.on('will-redirect', (event, url) => {
      if (interceptCallback(url)) event.preventDefault()
    })
    win.webContents.on('will-navigate', (event, url) => {
      if (interceptCallback(url)) event.preventDefault()
    })

    win.on('closed', () => resolve(null))
    win.loadURL(oauthUrl)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
