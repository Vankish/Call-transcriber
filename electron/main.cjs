const path = require('node:path')
const fs = require('node:fs/promises')
const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  shell,
} = require('electron')

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

ipcMain.handle('transcription:run', async (_event, { filePath }) => {
  const config = await readConfig()
  if (!config.groqApiKey) {
    throw new Error('API key de Groq no configurada. Abrela en Ajustes.')
  }

  const audioBuffer = await fs.readFile(filePath)
  const blob = new Blob([audioBuffer], { type: 'audio/webm' })

  const formData = new FormData()
  formData.append('file', blob, path.basename(filePath))
  formData.append('model', 'whisper-large-v3')
  formData.append('language', 'es')
  formData.append('response_format', 'text')

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.groqApiKey}` },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Error de Groq: ${errorText}`)
  }

  const text = await response.text()
  return { text }
})

ipcMain.handle('summary:generate', async (_event, { transcript, instructions }) => {
  const config = await readConfig()
  if (!config.groqApiKey) {
    throw new Error('API key de Groq no configurada. Abrela en Ajustes.')
  }

  const systemPrompt =
    'Eres un asistente experto en análisis de entrevistas de trabajo. ' +
    'Genera un resumen estructurado basándote en las instrucciones del entrevistador. ' +
    'Responde en español, de forma clara y concisa.'

  const userPrompt = instructions
    ? `Instrucciones del entrevistador:\n${instructions}\n\nTranscripción:\n${transcript}`
    : `Transcripción:\n${transcript}`

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
