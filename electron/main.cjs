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

// ── Aviso de nueva versión (electron-updater + GitHub Releases) ───────────────
//
// DECIDIDO 2026-08-14: no se compra certificado de firma. Sin él, Windows rechaza
// aplicar el instalador descargado ("New version is not signed by the application
// owner"), así que descargar los ~120 MB en cada arranque solo servía para fallar
// en silencio. Ahora electron-updater se usa SOLO para enterarse de que hay versión
// nueva; la instalación es manual, descargando el .exe desde GitHub Releases.
const RELEASES_URL = 'https://github.com/Vankish/Call-transcriber/releases/latest'

function sendUpdaterEvent(payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:event', payload)
  }
}

function setupAutoUpdater() {
  log.transports.file.level = 'info'
  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

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

// Sin firma no se puede instalar desde dentro de la app: se abre la página de
// releases en el navegador para bajar el .exe a mano.
ipcMain.handle('updates:open-releases', async () => {
  await shell.openExternal(RELEASES_URL)
  return { ok: true }
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
    return { groqApiKey: null, transcriptionModel: 'whisper-large-v3', transcriptionLanguage: 'es', summaryModel: 'openai/gpt-oss-120b' }
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

// MediaRecorder escribe el .webm en directo, así que no sabe cuánto va a durar y
// deja la cabecera sin duración (`Duration: N/A`). El reproductor entonces no puede
// calcular la posición: la barra avanza sobre lo que lleva descargado, llega al
// final en unos segundos y luego se arrastra el resto del vídeo.
//
// Reempaquetar con ffmpeg SIN recodificar reescribe la cabecera con la duración
// real. Es copia de flujos: 300 MB en menos de medio segundo, y no toca la calidad.
async function writeDurationHeader(filePath) {
  const fixedPath = filePath.replace(/(\.[^.]+)$/, '.fixed$1')
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, ['-y', '-i', filePath, '-c', 'copy', fixedPath])
      proc.on('error', reject)
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg salió con ${code}`))))
    })
    // Solo se sustituye si el resultado tiene tamaño coherente: más vale un vídeo
    // con la barra torcida que un vídeo corrupto.
    const [orig, fixed] = await Promise.all([fs.stat(filePath), fs.stat(fixedPath)])
    if (fixed.size < orig.size * 0.9) throw new Error('el reempaquetado salió más pequeño de lo esperado')
    await fs.rename(fixedPath, filePath)
    return true
  } catch (err) {
    log.warn(`[grabación] no se pudo escribir la duración en ${path.basename(filePath)}: ${err.message}`)
    await fs.rm(fixedPath, { force: true }).catch(() => {})
    return false
  }
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
  if (rawExtension === 'webm') await writeDurationHeader(filePath)

  return { filePath }
})

// Repara grabaciones hechas ANTES de que se escribiera la duración al guardar.
// `getAudioDurationSec` devuelve null justo cuando falta la cabecera, así que
// sirve de comprobación: si ya está, no se toca el archivo.
ipcMain.handle('recording:ensure-duration', async (_event, { filePath }) => {
  try {
    if (!filePath || !/\.webm$/i.test(filePath)) return { ok: true, repaired: false }
    await fs.access(filePath)
    if (await getAudioDurationSec(filePath)) return { ok: true, repaired: false }
    log.info(`[grabación] ${path.basename(filePath)} no lleva duración en la cabecera, reempaquetando`)
    return { ok: true, repaired: await writeDurationHeader(filePath) }
  } catch {
    return { ok: false, repaired: false }
  }
})

// ── Puente para sincronizar audios con la nube ───────────────────────────────
// El renderer es quien habla con Supabase Storage (tiene la sesión), pero no
// puede leer ni escribir en disco. Estos tres canales le prestan ese acceso,
// siempre restringido a la carpeta de grabaciones.

// Devuelve true/false sin lanzar: sirve para saber si un audio está en ESTE PC.
ipcMain.handle('recording:exists', async (_event, { filePath }) => {
  try {
    if (!filePath) return { exists: false }
    const stat = await fs.stat(filePath)
    return { exists: stat.isFile(), size: stat.size }
  } catch {
    return { exists: false }
  }
})

// Lee un audio ya guardado para poder subirlo (grabaciones anteriores a esto).
ipcMain.handle('recording:read-bytes', async (_event, { filePath }) => {
  try {
    const buffer = await fs.readFile(filePath)
    // Uint8Array viaja por IPC como bytes; Buffer llegaría como objeto plano.
    return { ok: true, bytes: new Uint8Array(buffer) }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
})

// Escribe un audio descargado de la nube en la carpeta de grabaciones. Solo
// acepta un nombre de archivo, nunca una ruta, para que no se pueda escribir
// fuera de esa carpeta.
ipcMain.handle('recording:write-bytes', async (_event, { fileName, bytes }) => {
  try {
    const safeName = path.basename(String(fileName || ''))
    if (!safeName) return { ok: false, error: 'nombre de archivo vacío' }
    const recordingsDir = path.join(app.getPath('documents'), 'CallTranscriber')
    await fs.mkdir(recordingsDir, { recursive: true })
    const filePath = path.join(recordingsDir, safeName)
    await fs.writeFile(filePath, Buffer.from(bytes))
    // Las pistas .webm bajadas de la nube llegan sin duración en la cabecera si
    // se subieron antes de repararla; se reaplica igual que al grabar.
    if (/\.webm$/i.test(safeName) && !(await getAudioDurationSec(filePath))) {
      await writeDurationHeader(filePath)
    }
    log.info(`[nube] descargado ${safeName} (${bytes.length} bytes)`)
    return { ok: true, filePath }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
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
  await writeDurationHeader(videoPath)

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

async function identifySpeakers(transcript, llmProvider, candidateName, interviewerName) {
  if (!transcript || !llmProvider.apiKey) return transcript
  // Las etiquetas de salida son configurables: si hay nombre real de candidato/
  // entrevistador se usan tal cual, si no se cae en las palabras fijas de siempre.
  const ivTag = (interviewerName || '').trim() || 'Entrevistador'
  const cdTag = (candidateName || '').trim() || 'Candidato'
  const candidateHint = candidateName
    ? `El nombre del candidato es "${candidateName}". Si aparece ese nombre en el texto (o alguien se presenta con él), esa persona es el [${cdTag}].`
    : ''
  const interviewerHint = interviewerName
    ? `El nombre de quien entrevista/dirige la llamada es "${interviewerName}". Si aparece ese nombre en el texto (o alguien se presenta con él), esa persona es el [${ivTag}].`
    : ''
  const system =
    'Eres un asistente experto en entrevistas de trabajo. Recibirás la transcripción de una entrevista ' +
    '(puede venir con etiquetas genéricas como [Hablante 1] / [Hablante 2] o sin etiquetas).\n' +
    `Tu tarea es reetiquétar CADA turno de conversación con exactamente una de estas etiquetas: [${ivTag}]: o [${cdTag}]:\n\n` +
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
    (interviewerHint ? interviewerHint + '\n\n' : '') +
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

// Reparte las palabras de la mezcla entre los hablantes que YA ha identificado el
// proveedor, y decide cuál de ellos es el interlocutor comparando con la pista de
// sistema: la voz que suena a la vez que esa pista es, por fuerza, la suya.
//
// Es mejor que recortar por tiempo. Recortando se pierde toda palabra del
// entrevistador que caiga mientras el otro habla — o sea las interrupciones, los
// "ajá" y el arranque de cada pregunta encadenada. Aquí no se borra nada: solo se
// decide de quién es cada palabra, que es lo que el proveedor ya ha calculado (y
// que hasta ahora se estaba tirando a la basura).
//
// Devuelve null si la identificación no es concluyente, para caer al método por
// tiempo en vez de inventarse una separación.
function interviewerWordsBySpeaker(words, systemIntervals) {
  const bySpeaker = new Map()
  for (const w of words) {
    const key = w.speaker ?? '?'
    if (!bySpeaker.has(key)) bySpeaker.set(key, [])
    bySpeaker.get(key).push(w)
  }
  if (bySpeaker.size < 2) return null   // el proveedor no separó hablantes

  const suenaEnLaPistaDelOtro = (w) => {
    const mid = ((w.start ?? 0) + (w.end ?? 0)) / 2
    return systemIntervals.some(([s, e]) => mid >= s && mid <= e)
  }

  const stats = [...bySpeaker.entries()]
    .map(([speaker, ws]) => ({ speaker, words: ws, ratio: ws.filter(suenaEnLaPistaDelOtro).length / ws.length }))
    .sort((a, b) => b.ratio - a.ratio)

  // El interlocutor es quien más coincide con su propia pista; el resto es el
  // entrevistador (a veces el proveedor parte una misma voz en dos hablantes).
  const [interlocutor, ...resto] = stats
  if (interlocutor.ratio < 0.6) return null            // nadie encaja con la pista: no fiarse
  const entrevistador = resto.filter((s) => s.ratio < 0.4)
  if (!entrevistador.length) return null               // no se distingue una segunda voz

  return {
    words: entrevistador.flatMap((s) => s.words).sort((a, b) => (a.start ?? 0) - (b.start ?? 0)),
    detail: stats.map((s) => `${s.speaker}=${Math.round(s.ratio * 100)}%`).join(' '),
  }
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

// Marca de tiempo de cada turno, para poder saltar a ese punto del audio o del
// vídeo y comprobar que lo transcrito es lo que se dijo.
const stamp = (sec) => {
  const total = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  return `[${h > 0 ? `${h}:${mm}` : mm}:${String(s).padStart(2, '0')}]`
}

// Combina la mezcla (mic+sistema) con la pista limpia del sistema:
//  · sistema  → [Candidato] (voz del interlocutor, ya aislada, se conserva entera)
//  · mezcla   → [Entrevistador]
//
// `dropOverlapping` descarta los segmentos de la mezcla que solapan en el tiempo con
// la voz del sistema, para que la voz del interlocutor no salga duplicada. Solo hace
// falta cuando el entrevistador se ha aislado por TIEMPO. Si se ha aislado por
// HABLANTE (interviewerWordsBySpeaker), esas palabras ya son suyas con nombre y
// apellidos, y aplicar el filtro aquí volvería a borrar justo lo que se quería
// rescatar: lo que dice mientras el otro habla.
function mergeSeparatedTranscript(mixedSegments, systemSegments, interviewerLabel, candidateLabel, dropOverlapping = true) {
  const rows = []
  for (const s of systemSegments) {
    const text = (s.text || '').trim()
    if (text) rows.push({ start: s.start ?? 0, label: candidateLabel, text })
  }
  for (const s of mixedSegments) {
    const text = (s.text || '').trim()
    if (!text) continue
    if (dropOverlapping && segOverlapFraction(s, systemSegments) > 0.5) continue
    rows.push({ start: s.start ?? 0, label: interviewerLabel, text })
  }
  rows.sort((a, b) => a.start - b.start)

  let result = ''
  let currentLabel = null
  for (const { label, text, start } of rows) {
    if (label !== currentLabel) {
      if (result) result += '\n'
      result += `${stamp(start)} [${label}]: ${text}`
      currentLabel = label
    } else {
      result += ' ' + text
    }
  }
  return result
}

ipcMain.handle('transcription:run', async (_event, { filePath, systemFilePath, language, candidateName, interviewerName }) => {
  const config = await readConfig()
  // Etiquetas de salida: nombre real si se conoce, si no las palabras fijas de
  // siempre (así una llamada sin entrevistador/candidato asignado no cambia nada).
  const ivTag = (interviewerName || '').trim() || 'Entrevistador'
  const cdTag = (candidateName || '').trim() || 'Candidato'
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
      // Camino preferente: quedarse con las palabras del entrevistador por HABLANTE.
      // No borra nada, así que conserva lo que dice mientras el otro habla.
      const porHablante = mixed.words?.length && speech?.length
        ? interviewerWordsBySpeaker(mixed.words, speech)
        : null
      if (porHablante) {
        mixedSegments = segmentsFromWords(porHablante.words)
        modo = `hablantes del proveedor (coincidencia con la pista de sistema: ${porHablante.detail})`
      } else if (mixed.words?.length && speech?.length) {
        mixedSegments = segmentsFromWords(wordsOutsideIntervals(mixed.words, speech))
        modo = 'palabras + audio medido'
      } else if (mixed.words?.length) {
        mixedSegments = segmentsFromWords(wordsOutsideIntervals(mixed.words, system.segments.map((s) => [s.start ?? 0, s.end ?? 0])))
        modo = 'palabras + marcas del proveedor'
      } else {
        mixedSegments = mixed.segments
        modo = 'segmentos'
      }
      log.info(`[transcripción] separación por ${modo}: ${mixed.segments.length} → ${mixedSegments.length} tramos del entrevistador`)
      const merged = mergeSeparatedTranscript(mixedSegments, system.segments, ivTag, cdTag, !porHablante)
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
    text = await identifySpeakers(text, llm, candidateName || '', interviewerName || '').catch(() => text)
  }

  return { text }
})

// ── Resúmenes de transcripciones largas ──────────────────────────────────────
//
// Los planes gratuitos limitan los TOKENS POR MINUTO (Groq: 12.000) y cuentan en
// la misma petición el prompt y los tokens de salida reservados con `max_tokens`.
// Una entrevista de 40 minutos ya no cabe y la API devuelve 413 sin procesar nada.
//
// Dos medidas: reservar una salida realista (un informe no ocupa 8.000 tokens), y
// si aun así no cabe, trocear la transcripción por turnos, sacar de cada trozo una
// lista de hechos literales, y redactar el informe final sobre esas notas. Se
// pierde algo de matiz, pero es la diferencia entre tener informe y no tenerlo.

const SUMMARY_MAX_TOKENS = 2500   // techo del informe final
const NOTES_MAX_TOKENS = 2200     // techo de las notas de cada trozo

// Las notas copian lo concreto de cada fragmento, así que comprimen poco: en las
// pruebas ocupan algo más de la mitad del texto del que salen. Por eso un trozo
// no se mide solo por si CABE en la petición, sino por si CABEN SUS NOTAS en la
// respuesta. Si no, el modelo se queda a medias y devuelve las notas cortadas —
// o, con los modelos que razonan, nada en absoluto.
const NOTES_COMPRESSION = 0.75

// Cuántas veces se parte un fragmento que no ha dado notas antes de rendirse.
const MAX_SPLIT_RETRIES = 2

// Aproximación: en español un token ronda los 3,5 caracteres. Se queda corta a
// propósito — si nos pasamos por poco, el reintento por trozos lo cubre; si nos
// pasáramos de prudentes, trocearíamos entrevistas que sí cabían.
const estimateTokens = (text) => Math.ceil(String(text || '').length / 3.5)

// El proveedor rechaza por tamaño (413) o por cuota agotada (429), o acepta la
// petición pero se queda sin tokens de respuesta antes de escribir nada
// (`emptyByLength`, típico de los modelos que razonan). Los tres casos se
// resuelven igual: con menos texto por petición.
const isSizeOrRateError = (err) =>
  err?.emptyByLength === true ||
  /\b(413|429)\b|too large|rate.?limit|tokens per minute/i.test(String(err?.message || err))

/** Parte el texto en trozos de como mucho `maxTokens`, cortando por turnos de
 *  conversación para no dejar a nadie a media frase. */
function splitTranscript(text, maxTokens) {
  const maxChars = Math.max(2000, Math.floor(maxTokens * 3.5))
  const chunks = []
  let current = ''
  for (const line of String(text).split('\n')) {
    // Un turno más largo que un trozo entero (un monólogo sin saltos de línea) se
    // parte por frases, y si aun así no cabe, por longitud a secas.
    const pieces = line.length <= maxChars ? [line] : splitLongLine(line, maxChars)
    for (const piece of pieces) {
      if (current && current.length + piece.length + 1 > maxChars) {
        chunks.push(current)
        current = ''
      }
      current = current ? `${current}\n${piece}` : piece
    }
  }
  if (current.trim()) chunks.push(current)
  return chunks
}

function splitLongLine(line, maxChars) {
  const out = []
  let rest = line
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars)
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '))
    const at = cut > maxChars * 0.5 ? cut + 1 : maxChars
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at)
  }
  if (rest.trim()) out.push(rest.trim())
  return out
}

/** El límite es por MINUTO, así que tras gastar cuota no queda otra que esperar a
 *  que la ventana se libere. Mejor esperar que comerse un 429. */
function makePacer(tokensPerMinute, onWait = () => {}) {
  let spent = []
  return async (tokens) => {
    for (;;) {
      const now = Date.now()
      spent = spent.filter((e) => now - e.at < 60000)
      const used = spent.reduce((sum, e) => sum + e.tokens, 0)
      if (!spent.length || used + tokens <= tokensPerMinute) break
      const wait = 60000 - (now - spent[0].at) + 1000
      log.info(`[resumen] cuota del minuto agotada, esperando ${Math.round(wait / 1000)}s`)
      // Estas esperas son la mayor parte del tiempo de un resumen largo. Quien
      // mira la pantalla tiene derecho a saber que se está esperando, no fallando.
      onWait(wait)
      await new Promise((r) => setTimeout(r, wait))
      onWait(0)
    }
    spent.push({ at: Date.now(), tokens })
  }
}

/** Pide las notas de UN fragmento. Si el proveedor lo rechaza por tamaño o
 *  devuelve un hueco, se parte el fragmento en dos y se reintenta: la mitad de
 *  texto necesita la mitad de notas, así que lo que no cabía, cabe.
 *
 *  Lo que nunca hace es devolver vacío. Un fragmento sin notas que pasa
 *  desapercibido acaba en un informe pedido sobre notas que no existen, y el
 *  modelo responde pidiéndolas — que es lo que se veía en pantalla. */
async function notesForChunk(chunk, llm, { system, label, pace, depth = 0 }) {
  let notes = ''
  let fallo = null
  try {
    const user = `${label}:\n\n${chunk}`
    await pace(estimateTokens(system) + estimateTokens(user) + NOTES_MAX_TOKENS)
    notes = String(await providers.chat(llm, { system, user, temperature: 0, maxTokens: NOTES_MAX_TOKENS })).trim()
  } catch (err) {
    if (!isSizeOrRateError(err)) throw err
    fallo = err
  }
  if (notes) return notes

  const motivo = fallo ? fallo.message : 'el modelo devolvió una respuesta vacía'
  const mitades = depth < MAX_SPLIT_RETRIES
    ? splitTranscript(chunk, Math.ceil(estimateTokens(chunk) / 2))
    : []
  if (mitades.length < 2) {
    throw new Error(`No se pudieron extraer notas de un fragmento de la transcripción: ${motivo}`)
  }

  log.warn(`[resumen] "${label}" no dio notas (${motivo}); se reintenta partido en ${mitades.length}`)
  const partes = []
  for (let i = 0; i < mitades.length; i++) {
    partes.push(await notesForChunk(mitades[i], llm, {
      system, pace, depth: depth + 1, label: `${label}, parte ${i + 1} de ${mitades.length}`,
    }))
  }
  return partes.join('\n')
}

/** El prompt de las notas. Vive aparte porque lo necesitan dos: quien extrae las
 *  notas de verdad y quien calcula de antemano cuántas peticiones va a costar el
 *  resumen. Su tamaño entra en la cuenta del fragmento, así que si los dos no
 *  usan el mismo texto, la barra de progreso promete un total que no se cumple. */
function notesSystemPrompt(pase, { isMeeting, ivTag, cdTag }) {
  const encuentro = isMeeting ? 'reunión de trabajo' : 'entrevista de trabajo'
  return pase > 1
    ? `Recibes un BLOQUE de notas ya extraídas de una ${encuentro}, en viñetas y en orden cronológico.\n` +
      'Devuélvelas agrupadas y compactadas, en la mitad de viñetas o menos.\n' +
      'REGLAS:\n' +
      '- Conserva TODAS las cifras, fechas, plazos, importes y nombres de personas y empresas, cada uno asociado exactamente a aquello a lo que se refería.\n' +
      '- Fusiona en una sola viñeta lo que se repita o sea la misma idea dicha dos veces, y conserva la marca de tiempo de la primera vez que se dijo.\n' +
      '- Mantén la etiqueta de quien lo dijo al principio de cada viñeta y el orden cronológico.\n' +
      '- No interpretes, no valores y no saques conclusiones.\n' +
      '- No inventes ni completes nada que no esté en las notas.\n' +
      'Responde en español y solo con las viñetas.'
    : `Recibes un FRAGMENTO de la transcripción de una ${encuentro}, ` +
      `con los turnos etiquetados como [${ivTag}]: y [${cdTag}]:.\n` +
      'Devuelve una lista de viñetas con TODO lo concreto que se diga en el fragmento. Cada viñeta empieza por la ' +
      `etiqueta de quien lo dijo, así: "- [${cdTag}]: ...".\n` +
      'REGLAS:\n' +
      '- Copia literalmente cifras, fechas, plazos, importes y nombres de personas y empresas, y asócialos exactamente a aquello a lo que se referían. No los mezcles entre sí.\n' +
      '- Los turnos empiezan por una marca de tiempo entre corchetes, tipo [12:34]. Conserva al principio de cada viñeta la del turno del que sale, pero no la trates nunca como un dato de lo que se habla.\n' +
      '- No interpretes, no valores y no saques conclusiones: solo registra lo dicho.\n' +
      '- No inventes ni completes nada que no aparezca en el fragmento.\n' +
      '- Omite la charla intrascendente (saludos, cortesías, problemas de conexión).\n' +
      '- Si el fragmento empieza o termina a media frase, no la completes.\n' +
      'Responde en español y solo con las viñetas.'
}

/** Tamaño de fragmento para un pase. Dos topes, y manda el menor: lo que cabe en
 *  la petición y lo que cabe de vuelta en las notas. La segunda vuelta pide
 *  fusionar a la mitad, así que admite el doble de texto por la misma salida. */
function chunkTokensFor(pase, budget, systemTokens) {
  const compresion = pase > 1 ? 0.5 : NOTES_COMPRESSION
  const cabeEnLaPeticion = budget - systemTokens - NOTES_MAX_TOKENS - 100
  const cabenSusNotas = Math.floor(NOTES_MAX_TOKENS / compresion)
  return Math.max(600, Math.min(cabeEnLaPeticion, cabenSusNotas))
}

/** Cuántas peticiones al modelo va a costar el resumen. Repite la aritmética del
 *  bucle de pases sin llamar a nadie, solo para poder pintar una barra que avance.
 *
 *  No es exacta y no puede serlo: un fragmento que el proveedor rechace se parte
 *  y cuesta más de una petición, y el modelo puede comprimir mejor o peor de lo
 *  previsto. Da el orden de magnitud, que es lo que hace falta para una espera
 *  de minutos; el total se corrige sobre la marcha si se queda corto. */
function planSummaryRequests(text, { budget, fixedCost, isMeeting, ivTag, cdTag }) {
  let material = estimateTokens(text)
  let peticiones = 0
  for (let pase = 1; pase <= 3; pase++) {
    const systemTokens = estimateTokens(notesSystemPrompt(pase, { isMeeting, ivTag, cdTag }))
    peticiones += Math.max(1, Math.ceil(material / chunkTokensFor(pase, budget, systemTokens)))
    const antes = material
    material = Math.round(material * (pase > 1 ? 0.5 : NOTES_COMPRESSION))
    if (fixedCost + material <= budget) break
    if (pase === 3 || material > antes * 0.9) break
  }
  return peticiones + 1   // + la petición que redacta el informe
}

/** Convierte la transcripción en una lista de hechos literales, trozo a trozo.
 *  Es un paso de compresión, NO de redacción: aquí no se interpreta nada.
 *
 *  A partir del segundo pase lo que entra ya son notas, no conversación. Pedir
 *  otra vez "copia todo lo concreto" sobre algo que ya es todo concreto no
 *  comprime nada — el material se estanca y se gastan pases (y minutos de cuota)
 *  para nada. En esa segunda vuelta se pide fusionar en vez de copiar. */
async function condenseTranscript(text, llm, { isMeeting, budget, pace, ivTag, cdTag, pase = 1, onChunk = () => {}, onChunkDone = () => {} }) {
  const system = notesSystemPrompt(pase, { isMeeting, ivTag, cdTag })
  const chunks = splitTranscript(text, chunkTokensFor(pase, budget, estimateTokens(system)))
  const que = pase > 1 ? 'Bloque' : 'Fragmento'
  log.info(`[resumen] pase ${pase}: ${chunks.length} ${que.toLowerCase()}(s) de ${text.length} caracteres`)

  const notes = []
  for (let i = 0; i < chunks.length; i++) {
    onChunk({ pase, indice: i + 1, total: chunks.length })
    notes.push(await notesForChunk(chunks[i], llm, {
      system, pace, label: `${que} ${i + 1} de ${chunks.length}`,
    }))
    onChunkDone()
  }
  return notes.filter(Boolean).join('\n')
}

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

// Un trabajo de resumen cada vez. La cuota por minuto es GLOBAL a la clave del
// proveedor, asi que dos resumenes en paralelo no van al doble de velocidad: van
// los dos a 429. Encolarlos cuesta lo mismo y termina antes.
let colaResumen = Promise.resolve()
function enColaDeResumen(fn) {
  const turno = colaResumen.then(fn, fn)
  colaResumen = turno.then(() => {}, () => {})
  return turno
}

const errorSinNotas = () => new Error(
  'No se pudo condensar la transcripción: el modelo de resumen no devolvió notas de ningún fragmento. ' +
  'Prueba con otro modelo en Ajustes → Motores de IA.'
)

async function runSummary(event, { transcript, criteria, summaryType, summaryContext, candidateName, interviewerName, interviewId, soloPreparar = false, notasPreparadas = null }) {
  const config = await readConfig()
  const llm = providers.resolveLlm(config)
  if (llm.needsKey && !llm.apiKey) {
    throw new Error(`Falta la API key de ${llm.label}. Configúrala en Ajustes → Motores de IA.`)
  }
  // Mismas etiquetas que se usaron al transcribir: nombre real si se conoce, si no
  // las palabras fijas de siempre.
  const ivTag = (interviewerName || '').trim() || 'Entrevistador'
  const cdTag = (candidateName || '').trim() || 'Candidato'

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
      ? `- La transcripción usa etiquetas [${ivTag}]: y [${cdTag}]:. Recoge lo relevante de AMBOS: acuerdos, peticiones y compromisos pueden venir de cualquiera de los dos.\n`
      : `- La transcripción usa etiquetas [${ivTag}]: y [${cdTag}]:. Extrae información solo de lo que dice el [${cdTag}]: salvo que se indique lo contrario.\n`) +
    '- Extrae ÚNICAMENTE información mencionada de forma explícita en la transcripción. No infieras ni supongas nada.\n' +
    (isMeeting
      ? '- Presta máxima atención a cifras, fechas, plazos y nombres de empresas: asocia cada dato exactamente a aquello a lo que se refería, sin mezclarlos.\n'
      : '- Presta máxima atención a los nombres de empresas y los tiempos de permanencia: cada duración debe asociarse exactamente a la empresa a la que corresponde según la transcripción. No intercambies ni mezcles datos de distintas empresas o períodos.\n') +
    '- Si un dato concreto (fecha, duración, nombre) no aparece claramente en la transcripción, omítelo en lugar de suponerlo.\n' +
    // Sin esto el modelo toma los [12:34] por datos y acaba escribiendo cosas como
    // "a los 12 minutos mencionó..." o confundiéndolos con horas y fechas reales.
    '- Cada turno empieza por una marca de tiempo entre corchetes, tipo [12:34]: es el momento de la grabación en que se dijo, NO es contenido. No la cites ni la confundas con una hora, una fecha ni una cifra de las que se hablan.\n' +
    'Responde en español.'

  let systemPrompt
  let makeUserPrompt

  // Cuando la transcripción no cabe en una petición, al modelo no le llega la
  // conversación sino las notas extraídas de ella. Conviene que lo sepa: si cree
  // que tiene la transcripción entera, da por no tratado lo que no ve.
  // Y si además han tenido que recortarse, también: un informe que da por
  // cubierta una conversación de la que le falta el final miente sin saberlo.
  let recortado = false
  const bodyLabel = (isNotes) => isNotes
    ? 'Notas literales extraídas de la transcripción, en orden cronológico (la conversación era demasiado ' +
      'larga para procesarla de una vez; estas notas son la única fuente disponible' +
      (recortado ? ', y aun así han tenido que recortarse: falta el tramo final de la conversación' : '') + '):'
    : 'Transcripción:'

  // Correspondencia explícita entre etiqueta y persona. Sin esto el modelo deduce
  // los nombres del propio texto y los cruza: cuando el entrevistador saluda
  // ("Hola Jarvis"), el nombre que aparece en SU turno es el del OTRO, y el modelo
  // acaba llamando Jarvis al entrevistador.
  const nameWarning =
    'No deduzcas los nombres a partir del texto: si un nombre propio aparece dentro de un turno, ' +
    'lo normal es que sea la persona a la que ese hablante se está dirigiendo, es decir, la OTRA.'
  const candidateRef = isMeeting
    ? 'CORRESPONDENCIA DE ETIQUETAS (es la única fuente válida para saber quién es quién):\n' +
      `- [${ivTag}]: quien convoca la reunión, por parte de nuestro equipo.\n` +
      `- [${cdTag}]: la otra parte, el cliente o interlocutor externo.\n` +
      'Las etiquetas vienen de que la app se diseñó para entrevistas: aquí NO hay candidato que evaluar, ' +
      'sino dos partes reunidas. No hables de "el candidato" ni de "la entrevista" en el informe.\n' +
      nameWarning
    : 'CORRESPONDENCIA DE ETIQUETAS (es la única fuente válida para saber quién es quién):\n' +
      `- [${ivTag}]: quien conduce la entrevista. Hace las preguntas. NO es el sujeto del informe.\n` +
      `- [${cdTag}]: la persona entrevistada. Responde. Es el sujeto del informe.\n` +
      nameWarning +
      (candidateName ? `\nRefiérete al candidato como ${cdTag} en el informe.` : '')

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

    makeUserPrompt = (body, isNotes) => effectiveCriteria
      ? `Secciones a analizar:\n${effectiveCriteria.join('\n')}\n\n${bodyLabel(isNotes)}\n${body}`
      : `${bodyLabel(isNotes)}\n${body}`
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

    makeUserPrompt = (body, isNotes) => `${bodyLabel(isNotes)}\n${body}`
  }

  // Se aparta un margen del límite por minuto: la cuenta de tokens del proveedor
  // no tiene por qué coincidir con nuestra estimación.
  const budget = Math.max(2000, llm.tpm - 200)
  // Al preparar por adelantado no se sabe con que formato se pedira el informe
  // luego. Medido: el prompt mas largo (descriptivo con criterios) ocupa 105
  // tokens mas que el mas corto (listado). Se condensa contra el peor caso para
  // que las mismas notas sirvan para cualquier formato sin recortar nada: es lo
  // que hace que cambiar de formato y regenerar cueste segundos y no minutos.
  const MARGEN_FORMATO = 150
  const fixedCost = estimateTokens(systemPrompt) + SUMMARY_MAX_TOKENS + (soloPreparar ? MARGEN_FORMATO : 0)

  // -- Progreso hacia la pantalla ---------------------------------------------
  //
  // Un resumen largo son varios minutos que casi enteros se van en esperar cuota.
  // Con un spinner quieto eso es indistinguible de un cuelgue, y quien mira acaba
  // cerrando la app a los dos minutos creyendo que se ha roto. Se cuenta por
  // PETICIONES al modelo, que es la unidad real de trabajo y de espera.
  const t0 = Date.now()
  let hechas = 0
  let total = 1
  let fase = 'preparando'
  let etiqueta = 'Preparando el resumen'
  // Cuanto cuesta una peticion de notas, para traducir peticiones restantes a
  // minutos: la cuota es por minuto, asi que el coste marca el ritmo maximo.
  let costePeticion = fixedCost

  const emit = (esperaHasta = null) => {
    // Segundos por peticion: el suelo que impone la cuota y lo que estamos
    // midiendo de verdad, lo que sea mayor. Solo con la media medida, la primera
    // peticion (que no espera nada, porque la ventana del minuto esta vacia)
    // haria prometer un total ridiculo que luego se multiplica por diez.
    const porCuota = (60 * costePeticion) / budget
    const medido = hechas > 0 ? (Date.now() - t0) / 1000 / hechas : 0
    const restantes = Math.max(0, total - hechas)
    const etaSec = Math.round(restantes * Math.max(porCuota, medido))
    if (!event.sender.isDestroyed()) {
      event.sender.send('summary:progress', { interviewId, fase, etiqueta, hechas, total, etaSec, esperaHasta })
    }
  }
  const paso = (f, e) => { fase = f; etiqueta = e; emit() }

  /** Redacta el informe a partir de las notas: UNA peticion. Es lo unico que se
   *  paga cuando la conversacion ya se leyó al acabar de transcribir. */
  const redactarSobreNotas = async (notas, pace) => {
    let cuerpo = notas
    // Las notas pudieron prepararse contra un prompt algo mas corto (otros
    // criterios, otro tipo de informe). Si ahora no caben, se recortan aqui en
    // vez de dejar que el proveedor conteste 413 en la ultima peticion.
    const cabe = Math.floor((budget - fixedCost - 100) * 3.5)
    if (cuerpo.length > cabe) {
      log.warn(`[resumen] las notas preparadas (${cuerpo.length}) no caben con este informe; se recortan a ${cabe}`)
      cuerpo = cuerpo.slice(0, cabe)
      recortado = true
    }
    if (!cuerpo.trim()) throw errorSinNotas()
    if (hechas >= total) total = hechas + 1
    paso('redactando', 'Redactando el informe')
    // `recortado` ya está puesto: el prompt tiene que avisar al modelo de que le
    // falta el tramo final ANTES de construirse, o el informe mentirá sin saberlo.
    const notesPrompt = makeUserPrompt(cuerpo, true)
    const esperar = pace || makePacer(budget, (ms) => emit(ms > 0 ? Date.now() + ms : null))
    await esperar(fixedCost + estimateTokens(notesPrompt))
    const text = await providers.chat(llm, {
      system: systemPrompt, user: notesPrompt, temperature: 0.1, maxTokens: SUMMARY_MAX_TOKENS,
    })
    return { text }
  }

  // Notas ya preparadas de antemano (el trabajo caro se hizo al acabar de
  // transcribir). Solo queda redactar, que es UNA peticion.
  if (notasPreparadas && notasPreparadas.trim()) {
    return await redactarSobreNotas(notasPreparadas)
  }

  const fullPrompt = makeUserPrompt(transcript, false)
  if (fixedCost + estimateTokens(fullPrompt) <= budget) {
    // Cabe entera: no hay nada que preparar por adelantado, y quien pregunta se
    // ahorra ensenar una barra de preparacion que no va a tardar nada.
    if (soloPreparar) return { needed: false }
    paso('redactando', 'Redactando el informe')
    try {
      const text = await providers.chat(llm, {
        system: systemPrompt, user: fullPrompt, temperature: 0.1, maxTokens: SUMMARY_MAX_TOKENS,
      })
      return { text }
    } catch (err) {
      // Si nuestra estimación se quedó corta, se recae en el camino por trozos en
      // vez de devolverle el error al usuario.
      if (!isSizeOrRateError(err)) throw err
      log.warn(`[resumen] ${llm.label} rechazó la petición por tamaño; se reintenta por trozos: ${err.message}`)
    }
  }

  // A partir de aqui hay trabajo de verdad que medir: se estima el total antes de
  // empezar para que la barra tenga denominador desde el primer segundo.
  // En modo preparar no se redacta, asi que la peticion del informe que incluye
  // el plan no se va a gastar: si se contara, la barra se quedaria en el 90%.
  total = Math.max(1, planSummaryRequests(transcript, { budget, fixedCost, isMeeting, ivTag, cdTag }) - (soloPreparar ? 1 : 0))
  const sysNotasTokens = estimateTokens(notesSystemPrompt(1, { isMeeting, ivTag, cdTag }))
  costePeticion = sysNotasTokens + chunkTokensFor(1, budget, sysNotasTokens) + NOTES_MAX_TOKENS
  log.info(`[resumen] plan: ~${total} peticiones al modelo`)
  paso('analizando', soloPreparar ? 'Leyendo la conversación' : 'Analizando la conversación')

  const pace = makePacer(budget, (ms) => emit(ms > 0 ? Date.now() + ms : null))
  let material = transcript
  // Con transcripciones muy largas un solo pase de notas puede seguir sin caber:
  // se vuelve a condensar hasta que entre (con tope, para no dar vueltas si el
  // modelo deja de comprimir).
  for (let pase = 1; pase <= 3; pase++) {
    const antes = material.length
    material = await condenseTranscript(material, llm, {
      isMeeting, budget, pace, ivTag, cdTag, pase,
      onChunk: ({ pase: n, indice, total: cuantos }) => {
        const previstas = hechas + (cuantos - indice + 1) + (soloPreparar ? 0 : 1)
        if (previstas > total) total = previstas
        paso(n > 1 ? 'compactando' : 'analizando', n > 1
          ? `Compactando notas · bloque ${indice} de ${cuantos}`
          : `Analizando la conversación · fragmento ${indice} de ${cuantos}`)
      },
      onChunkDone: () => { hechas++; emit() },
    })
    if (fixedCost + estimateTokens(makeUserPrompt(material, true)) <= budget) break

    // Si un pase apenas ha recortado, el siguiente tampoco lo hará: el modelo ya
    // no ve de dónde quitar. Insistir solo gasta minutos de cuota, así que se
    // corta por lo sano y se avisa al modelo de que le falta el tramo final —
    // mejor un informe honesto sobre el 90% que un error tras diez minutos.
    if (pase === 3 || material.length > antes * 0.9) {
      const cabe = Math.floor((budget - fixedCost - 100) * 3.5)
      log.warn(`[resumen] las notas no bajan de ${material.length} caracteres; se recortan a ${cabe}`)
      material = material.slice(0, cabe)
      recortado = true
      break
    }
  }

  // Última red: pedir el informe con el cuerpo vacío no da un error, da un modelo
  // educado contestando "proporcióname las notas y con gusto lo redacto". Antes
  // que devolver eso como si fuera el informe, se dice lo que ha pasado.
  if (!material.trim()) throw errorSinNotas()

  if (soloPreparar) {
    log.info(`[resumen] notas preparadas: ${material.length} caracteres en ${hechas} peticiones`)
    return { needed: true, notes: material, recortado }
  }

  const informe = await redactarSobreNotas(material, pace)
  // Las notas acaban de costar ~10 peticiones y varios minutos de espera. Se
  // devuelven para guardarlas: sin esto, cambiar de formato las vuelve a pagar
  // enteras, que es justo lo que este trabajo venia a evitar.
  return { ...informe, notes: material, recortado }
}

// Los dos canales son el mismo trabajo partido en dos: 'prepare' hace la parte
// cara (leer la conversacion y tomar notas) y 'generate' la barata (redactar).
// Los dos entran por la misma cola: dos resumenes a la vez se pisan la cuota del
// minuto y acaban los dos en 429.
ipcMain.handle('summary:generate', (event, payload) => enColaDeResumen(() => runSummary(event, payload)))
ipcMain.handle('summary:prepare', (event, payload) => enColaDeResumen(() => runSummary(event, { ...payload, soloPreparar: true })))

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
