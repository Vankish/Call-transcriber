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
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked')

const isDev = process.env.ELECTRON_DEV === '1'

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
    return { groqApiKey: null, transcriptionModel: 'whisper-large-v3', transcriptionLanguage: 'es', summaryModel: 'llama-3.3-70b-versatile' }
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

  if (data.segments && data.segments.some((s) => s.speaker !== undefined)) {
    return formatDiarizedTranscript(data.segments)
  }

  return data.text || ''
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

async function transcribeAudio(filePath, groqApiKey, model, language) {
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

    const chunkPaths = await splitMp3IntoChunks(mp3Path, durationSec, tmpDir)
    const texts = await Promise.all(chunkPaths.map((p) => transcribeChunk(p, groqApiKey, model, language)))
    return texts.join('\n\n')
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function identifySpeakers(transcript, groqApiKey, summaryModel) {
  if (!transcript || !groqApiKey) return transcript
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: summaryModel || 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content:
            'Eres un asistente experto en entrevistas de trabajo. Recibirás la transcripción de una entrevista. ' +
            'Tu tarea es identificar los turnos de conversación y etiquetarlos con [Entrevistador]: y [Candidato]:. ' +
            'Basa tu decisión en el contexto: el entrevistador hace preguntas y conduce la conversación; ' +
            'el candidato responde sobre sí mismo, su trayectoria y experiencia laboral. ' +
            'Conserva el texto EXACTAMENTE como está, solo añade las etiquetas al inicio de cada turno. ' +
            'Responde ÚNICAMENTE con la transcripción etiquetada, sin explicaciones ni texto adicional.',
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

ipcMain.handle('transcription:run', async (_event, { filePath }) => {
  const config = await readConfig()
  if (!config.groqApiKey) {
    throw new Error('API key de Groq no configurada. Abrela en Ajustes.')
  }
  const model = config.transcriptionModel || 'whisper-large-v3'
  let text = await transcribeAudio(filePath, config.groqApiKey, model, 'es')

  // If Groq diarization didn't find multiple speakers, use LLM to identify them
  const hasMultipleSpeakers = /\[Hablante [2-9]\]|\[Hablante [2-9]\]:/.test(text)
  if (!hasMultipleSpeakers && text.trim().length > 0) {
    text = await identifySpeakers(text, config.groqApiKey, config.summaryModel || 'llama-3.3-70b-versatile').catch(() => text)
  }

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
      'Para cada sección usa un título en negrita seguido de bullets con la información extraída.\n\n' +
      'REGLAS ESTRICTAS DE FIDELIDAD:\n' +
      '- La transcripción puede incluir etiquetas de hablante como [Hablante 1] y [Hablante 2]. Generalmente [Hablante 1] es el entrevistador y [Hablante 2] es la candidata, aunque puede variar. Úsalas para atribuir correctamente cada dato a quien lo dice.\n' +
      '- Extrae ÚNICAMENTE información mencionada de forma explícita en la transcripción. No infieras ni supongas nada.\n' +
      '- Presta máxima atención a los nombres de empresas y los tiempos de permanencia: cada duración debe asociarse exactamente a la empresa a la que corresponde según la transcripción. No intercambies ni mezcles datos de distintas empresas o períodos.\n' +
      '- Si un dato concreto (fecha, duración, nombre) no aparece claramente en la transcripción, omítelo en lugar de suponerlo.\n' +
      '- Sé conciso y directo. No incluyas frases del tipo "el entrevistador preguntó" o "el candidato respondió".\n' +
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
      'Escribe como si fueran las notas de un reclutador experto que ha sintetizado la conversación.\n\n' +
      'REGLAS ESTRICTAS DE FIDELIDAD:\n' +
      '- La transcripción puede incluir etiquetas de hablante como [Hablante 1] y [Hablante 2]. Generalmente [Hablante 1] es el entrevistador y [Hablante 2] es la candidata, aunque puede variar. Úsalas para atribuir correctamente cada dato a quien lo dice.\n' +
      '- Extrae ÚNICAMENTE información mencionada de forma explícita en la transcripción. No infieras ni supongas nada.\n' +
      '- Presta máxima atención a los nombres de empresas y los tiempos de permanencia: cada duración debe asociarse exactamente a la empresa a la que corresponde según la transcripción. No intercambies ni mezcles datos de distintas empresas o períodos.\n' +
      '- Si un dato concreto (fecha, duración, nombre) no aparece claramente en la transcripción, omítelo en lugar de suponerlo.\n' +
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
