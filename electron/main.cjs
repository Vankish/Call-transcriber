const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { spawn } = require('node:child_process')
const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  shell,
} = require('electron')
const ffmpegPath = require('ffmpeg-static')

const isDev = process.env.ELECTRON_DEV === '1'

function sanitizeName(value) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim()
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

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

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
      })

      callback({
        video: sources[0],
        audio: 'loopback',
      })
    },
    {
      useSystemPicker: false,
    },
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'call-transcriber-config.json')

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { groqApiKey: null }
  }
}

ipcMain.handle('recording:save', async (_event, payload) => {
  const recordingsDir = path.join(app.getPath('documents'), 'CallTranscriber')
  await fs.mkdir(recordingsDir, { recursive: true })

  const extension = payload.extension || 'webm'
  const candidateSafe = sanitizeName(payload.candidateName || 'candidata')
  const createdSafe = payload.createdAt.replace(/[:.]/g, '-')
  const fileName = `${candidateSafe}_${createdSafe}_${payload.interviewId}.${extension}`
  const filePath = path.join(recordingsDir, fileName)

  const buffer = Buffer.from(payload.audioBytes)
  await fs.writeFile(filePath, buffer)

  return { filePath }
})

ipcMain.handle('config:get', async () => {
  return readConfig()
})

ipcMain.handle('config:save', async (_event, payload) => {
  await fs.writeFile(CONFIG_FILE(), JSON.stringify(payload), 'utf-8')
  return { ok: true }
})

const GROQ_MAX_BYTES = 24 * 1024 * 1024
const CHUNK_DURATION_SEC = 600 // 10 minutos por chunk

function getAudioDurationSec(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', filePath])
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
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
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg conversión falló: ${stderr.slice(-300)}`))
    })
  })
}

async function transcribeChunk(filePath, groqApiKey) {
  const audioBuffer = await fs.readFile(filePath)
  const ext = path.extname(filePath).slice(1) || 'mp3'
  const blob = new Blob([audioBuffer], { type: `audio/${ext}` })
  const formData = new FormData()
  formData.append('file', blob, path.basename(filePath))
  formData.append('model', 'whisper-large-v3')
  formData.append('language', 'es')
  formData.append('response_format', 'text')

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqApiKey}` },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Error de Groq: ${errorText}`)
  }

  return response.text()
}

async function splitMp3IntoChunks(mp3Path, durationSec, tmpDir) {
  const numChunks = Math.ceil(durationSec / CHUNK_DURATION_SEC)
  const chunkPaths = []

  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_DURATION_SEC
    const chunkPath = path.join(tmpDir, `chunk_${i}.mp3`)
    await new Promise((resolve, reject) => {
      const args = ['-i', mp3Path, '-ss', String(start), '-t', String(CHUNK_DURATION_SEC), '-c', 'copy', '-y', chunkPath]
      const proc = spawn(ffmpegPath, args)
      let stderr = ''
      proc.stderr.on('data', (d) => { stderr += d.toString() })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg chunk ${i + 1} falló: ${stderr.slice(-300)}`))
      })
    })
    chunkPaths.push(chunkPath)
  }

  return chunkPaths
}

async function transcribeAudio(filePath, groqApiKey) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-'))

  try {
    // Paso 1: convertir a MP3 mono 16kHz 32kbps
    const mp3Path = path.join(tmpDir, 'audio.mp3')
    await convertToMp3(filePath, mp3Path)

    const stat = await fs.stat(mp3Path)

    // Paso 2: cabe en una sola llamada → transcribir directo
    if (stat.size <= GROQ_MAX_BYTES) {
      return transcribeChunk(mp3Path, groqApiKey)
    }

    // Paso 3: archivo muy largo → fragmentar y transcribir en paralelo
    const durationSec = await getAudioDurationSec(mp3Path)
    if (!durationSec) throw new Error('No se pudo leer la duración del audio.')

    const chunkPaths = await splitMp3IntoChunks(mp3Path, durationSec, tmpDir)
    const texts = await Promise.all(chunkPaths.map((p) => transcribeChunk(p, groqApiKey)))
    return texts.join(' ')
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

ipcMain.handle('transcription:run', async (_event, { filePath }) => {
  const config = await readConfig()
  if (!config.groqApiKey) {
    throw new Error('API key de Groq no configurada. Abrela en Ajustes.')
  }
  const text = await transcribeAudio(filePath, config.groqApiKey)
  return { text }
})

ipcMain.handle('summary:generate', async (_event, { transcript, instructions, summaryType }) => {
  const config = await readConfig()
  if (!config.groqApiKey) {
    throw new Error('API key de Groq no configurada. Abrela en Ajustes.')
  }

  let systemPrompt
  let userPrompt

  if (summaryType === 'listado') {
    systemPrompt =
      'Eres un asistente experto en análisis de entrevistas de trabajo. ' +
      'Genera un listado estructurado por secciones basándote en los temas indicados. ' +
      'Para cada sección usa un título en negrita seguido de bullets con la información extraída. ' +
      'Sé conciso y directo. No incluyas frases del tipo "el entrevistador preguntó" o "el candidato respondió". ' +
      'Responde en español.'

    userPrompt = instructions
      ? `Secciones a resumir:\n${instructions}\n\nTranscripción:\n${transcript}`
      : `Transcripción:\n${transcript}`
  } else {
    systemPrompt =
      'Eres un experto en selección de personal. Tu tarea es redactar un informe narrativo del candidato ' +
      'basado en la transcripción de una entrevista de trabajo. ' +
      'Escribe en tercera persona, con prosa fluida y densa en información relevante. ' +
      'Organiza el contenido en párrafos temáticos: situación actual y disponibilidad, trayectoria profesional, ' +
      'competencias técnicas y habilidades clave, y adecuación al puesto. ' +
      'NO uses listas con guiones o puntos. ' +
      'NO incluyas frases como "el entrevistador preguntó" o "el candidato respondió". ' +
      'Escribe como si fueran las notas de un reclutador experto que ha sintetizado la conversación. ' +
      'Responde en español.'

    userPrompt = instructions
      ? `Contexto del proceso: ${instructions}\n\nTranscripción:\n${transcript}`
      : `Transcripción:\n${transcript}`
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Error de Groq: ${errorText}`)
  }

  const data = await response.json()
  return { text: data.choices[0].message.content }
})

ipcMain.handle('recording:delete', async (_event, { filePath }) => {
  try {
    await fs.unlink(filePath)
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
