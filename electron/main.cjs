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

      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 300, height: 200 },
        fetchWindowIcons: true,
      })

      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('capture:sources', sources.map((s) => ({
          id: s.id,
          name: s.name,
          thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
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
  return readConfig()
})

ipcMain.handle('config:save', async (_event, payload) => {
  await fs.writeFile(CONFIG_FILE(), JSON.stringify(payload), 'utf-8')
  return { ok: true }
})

const GROQ_MAX_BYTES = 24 * 1024 * 1024
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

async function transcribeChunk(filePath, groqApiKey, model, language) {
  const audioBuffer = await fs.readFile(filePath)
  const ext = path.extname(filePath).slice(1) || 'mp3'
  const blob = new Blob([audioBuffer], { type: `audio/${ext}` })
  const formData = new FormData()
  formData.append('file', blob, path.basename(filePath))
  formData.append('model', model || 'whisper-large-v3')
  if (language && language !== 'auto') formData.append('language', language)
  formData.append('response_format', 'verbose_json')
  formData.append('diarize', 'true')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120000)
  let response
  try {
    response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqApiKey}` },
      body: formData,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Error de Groq: ${errorText}`)
  }

  const data = await response.json()
  const rawSegments = Array.isArray(data.segments) ? data.segments : []
  const segments = filterHallucinatedSegments(rawSegments)

  if (segments.some((s) => s.speaker !== undefined)) {
    return formatDiarizedTranscript(segments)
  }

  // Si Groq no devolvió segmentos (no debería pasar con verbose_json) usamos el
  // texto plano tal cual, porque no hay forma de filtrar sin las métricas por segmento.
  return rawSegments.length
    ? segments.map((s) => (s.text || '').trim()).filter(Boolean).join(' ')
    : (data.text || '')
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

async function transcribeAudio(filePath, groqApiKey, model, language, chunkDurationSec = DEFAULT_CHUNK_DURATION_SEC) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-'))

  try {
    const mp3Path = path.join(tmpDir, 'audio.mp3')
    await convertToMp3(filePath, mp3Path)

    const stat = await fs.stat(mp3Path)

    if (stat.size <= GROQ_MAX_BYTES) {
      return await transcribeChunk(mp3Path, groqApiKey, model, language)
    }

    const durationSec = await getAudioDurationSec(mp3Path)
    if (!durationSec) throw new Error('No se pudo leer la duración del audio.')

    const chunkPaths = await splitMp3IntoChunks(mp3Path, durationSec, tmpDir, chunkDurationSec)
    const texts = await Promise.all(chunkPaths.map((p) => transcribeChunk(p, groqApiKey, model, language)))
    return texts.join('\n\n')
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function identifySpeakers(transcript, groqApiKey, summaryModel, candidateName) {
  if (!transcript || !groqApiKey) return transcript
  const candidateHint = candidateName
    ? `El nombre del candidato es "${candidateName}". Si aparece ese nombre en el texto (o alguien se presenta con él), esa persona es el [Candidato].`
    : ''
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: summaryModel || 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content:
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
            '- Responde ÚNICAMENTE con la transcripción etiquetada, sin explicaciones ni texto adicional',
        },
        { role: 'user', content: transcript },
      ],
      temperature: 0.1,
      max_tokens: 8000,
    }),
  })
  if (!response.ok) return transcript
  const data = await response.json()
  return data.choices?.[0]?.message?.content || transcript
}

// ── Separación determinista de hablantes por pistas ──────────────────────────
// Cuando se graba con audio de sistema, además de la mezcla (mic+sistema) se guarda
// una pista SOLO con el audio del sistema = voz limpia del interlocutor. Transcribiendo
// ambas y conociendo qué pista es quién, ya NO hace falta que una IA adivine hablantes.
//
// Variante de transcribeChunk que devuelve los segmentos crudos (con marcas de tiempo)
// en vez del texto ya formateado, para poder combinarlos entre pistas.
async function transcribeChunkSegments(filePath, groqApiKey, model, language) {
  const audioBuffer = await fs.readFile(filePath)
  const ext = path.extname(filePath).slice(1) || 'mp3'
  const blob = new Blob([audioBuffer], { type: `audio/${ext}` })
  const formData = new FormData()
  formData.append('file', blob, path.basename(filePath))
  formData.append('model', model || 'whisper-large-v3')
  if (language && language !== 'auto') formData.append('language', language)
  formData.append('response_format', 'verbose_json')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120000)
  let response
  try {
    response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqApiKey}` },
      body: formData,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Error de Groq: ${errorText}`)
  }

  const data = await response.json()
  const rawSegments = Array.isArray(data.segments) ? data.segments : []
  const segments = filterHallucinatedSegments(rawSegments)
  const text = segments.map((s) => (s.text || '').trim()).filter(Boolean).join(' ') || (data.text || '')
  return { text, segments }
}

async function transcribeAudioSegments(filePath, groqApiKey, model, language, chunkDurationSec = DEFAULT_CHUNK_DURATION_SEC) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-'))
  try {
    const mp3Path = path.join(tmpDir, 'audio.mp3')
    await convertToMp3(filePath, mp3Path)

    const stat = await fs.stat(mp3Path)
    if (stat.size <= GROQ_MAX_BYTES) {
      return await transcribeChunkSegments(mp3Path, groqApiKey, model, language)
    }

    const durationSec = await getAudioDurationSec(mp3Path)
    if (!durationSec) throw new Error('No se pudo leer la duración del audio.')

    const chunkPaths = await splitMp3IntoChunks(mp3Path, durationSec, tmpDir, chunkDurationSec)
    const results = await Promise.all(chunkPaths.map((p) => transcribeChunkSegments(p, groqApiKey, model, language)))
    const text = results.map((r) => r.text).join('\n\n')
    // Reajusta las marcas de tiempo de cada chunk a la línea temporal absoluta.
    const segments = results.flatMap((r, i) => r.segments.map((s) => ({
      ...s,
      start: (s.start ?? 0) + i * chunkDurationSec,
      end: (s.end ?? 0) + i * chunkDurationSec,
    })))
    return { text, segments }
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
  if (!config.groqApiKey) {
    throw new Error('API key de Groq no configurada. Abrela en Ajustes.')
  }
  const VALID_MODELS = ['whisper-large-v3', 'whisper-large-v3-turbo']
  const savedModel = config.transcriptionModel || 'whisper-large-v3'
  const model = VALID_MODELS.includes(savedModel) ? savedModel : 'whisper-large-v3'
  const chunkDuration = (config.chunkDuration && config.chunkDuration >= 5) ? config.chunkDuration : DEFAULT_CHUNK_DURATION_SEC

  const systemExists = systemFilePath
    ? await fs.access(systemFilePath).then(() => true).catch(() => false)
    : false

  // CAMINO NUEVO: separación determinista por pistas (cuando existe la pista de sistema).
  if (systemExists) {
    try {
      const [mixed, system] = await Promise.all([
        transcribeAudioSegments(filePath, config.groqApiKey, model, language || 'auto', chunkDuration),
        transcribeAudioSegments(systemFilePath, config.groqApiKey, model, language || 'auto', chunkDuration),
      ])
      // Etiquetas fijas [Entrevistador] / [Candidato]: el resumen depende de ellas.
      const merged = mergeSeparatedTranscript(mixed.segments, system.segments, 'Entrevistador', 'Candidato')
      const text = merged || [mixed.text, system.text].filter(Boolean).join('\n')
      return { text }
    } catch (err) {
      // Si algo falla en la vía separada, caemos al camino clásico de una sola pista
      // en vez de romper la transcripción.
      console.error('Fallo en la separación por pistas, usando pista única:', err)
    }
  }

  // CAMINO CLÁSICO (sin cambios): una sola pista mezclada + diarización por IA.
  let text = await transcribeAudio(filePath, config.groqApiKey, model, language || 'auto', chunkDuration)

  if (text.trim().length > 0) {
    text = await identifySpeakers(text, config.groqApiKey, config.summaryModel || 'llama-3.3-70b-versatile', candidateName || '').catch(() => text)
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

ipcMain.handle('summary:generate', async (_event, { transcript, criteria, summaryType, candidateName }) => {
  const config = await readConfig()
  if (!config.groqApiKey) {
    throw new Error('API key de Groq no configurada. Abrela en Ajustes.')
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
  const effectiveCriteria = criteriaList && criteriaList.length > 0 ? criteriaList : null

  const fidelityRules =
    'REGLAS ESTRICTAS DE FIDELIDAD:\n' +
    '- La transcripción usa etiquetas [Entrevistador]: y [Candidato]:. Extrae información solo de lo que dice el [Candidato]: salvo que se indique lo contrario.\n' +
    '- Extrae ÚNICAMENTE información mencionada de forma explícita en la transcripción. No infieras ni supongas nada.\n' +
    '- Presta máxima atención a los nombres de empresas y los tiempos de permanencia: cada duración debe asociarse exactamente a la empresa a la que corresponde según la transcripción. No intercambies ni mezcles datos de distintas empresas o períodos.\n' +
    '- Si un dato concreto (fecha, duración, nombre) no aparece claramente en la transcripción, omítelo en lugar de suponerlo.\n' +
    'Responde en español.'

  let systemPrompt
  let userPrompt

  const candidateRef = candidateName ? `El candidato/a se llama ${candidateName}. Refiérete a él/ella por su nombre en el informe.` : ''

  if (summaryType === 'listado') {
    systemPrompt =
      'Eres un asistente experto en análisis de entrevistas de trabajo. ' +
      'Genera un listado estructurado por secciones basándote en los criterios indicados. ' +
      'Para cada sección usa un título en negrita seguido de bullets con la información extraída. ' +
      'Sé conciso y directo. No incluyas frases del tipo "el entrevistador preguntó" o "el candidato respondió".\n\n' +
      (candidateRef ? candidateRef + '\n\n' : '') +
      fidelityRules

    userPrompt = effectiveCriteria
      ? `Secciones a analizar:\n${effectiveCriteria.join('\n')}\n\nTranscripción:\n${transcript}`
      : `Transcripción:\n${transcript}`
  } else {
    const topicSentence = effectiveCriteria
      ? `Cubre específicamente los siguientes aspectos (en este orden si aplican): ${effectiveCriteria.join(', ')}.`
      : 'Organiza el contenido en párrafos temáticos: situación actual y disponibilidad, trayectoria profesional, competencias técnicas y habilidades clave, y adecuación al puesto.'

    systemPrompt =
      'Eres un experto en selección de personal. Tu tarea es redactar un informe narrativo del candidato ' +
      'basado en la transcripción de una entrevista de trabajo. ' +
      'Escribe en tercera persona, con prosa fluida y densa en información relevante. ' +
      `${topicSentence} ` +
      'NO uses listas con guiones o puntos. ' +
      'NO incluyas frases como "el entrevistador preguntó" o "el candidato respondió". ' +
      'Escribe como si fueran las notas de un reclutador experto que ha sintetizado la conversación.\n\n' +
      (candidateRef ? candidateRef + '\n\n' : '') +
      fidelityRules

    userPrompt = `Transcripción:\n${transcript}`
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.summaryModel || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Error de Groq: ${errorText}`)
  }

  const data = await response.json()
  return { text: data.choices[0].message.content }
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
