type SaveRecordingPayload = {
  interviewId: string
  candidateName: string
  createdAt: string
  extension: string
  format?: string
  audioBytes: Uint8Array
}

type SaveRecordingResult = {
  filePath: string
}

type SaveVideoRecordingPayload = {
  interviewId: string
  candidateName: string
  createdAt: string
  videoBytes: Uint8Array
}

type CaptureSourceOption = {
  id: string
  name: string
  thumbnail: string | null
  type: 'screen' | 'window'
}

/** Configuración de un motor de IA. `provider` es el id de un preset del
 *  catálogo, o 'custom' para un servicio que el usuario escribe a mano. */
type ProviderConfig = {
  provider: string
  apiKey: string
  model: string
  /** Solo para 'custom': URL base y dialecto que habla el servicio. */
  baseUrl?: string
  dialect?: string
  label?: string
}

type ProviderPreset = {
  id: string
  label: string
  note?: string
  consoleUrl?: string
  keyHint?: string
  dialect: string
  baseUrl: string
  models: string[]
  noKey?: boolean
  diarize?: boolean
}

type ProviderCatalog = {
  stt: ProviderPreset[]
  llm: ProviderPreset[]
}

type GetConfigResult = {
  groqApiKey: string | null
  transcriptionModel?: string
  summaryModel?: string
  stt?: ProviderConfig
  llm?: ProviderConfig
  userName?: string
  userEmail?: string
  userCompany?: string
  userRole?: string
  audioFormat?: string
  recordingQuality?: string
  chunkDuration?: number
  language?: string
  dateFormat?: string
  autoSave?: boolean
  autoTranscribe?: boolean
}

type SaveConfigPayload = {
  groqApiKey: string
  transcriptionModel: string
  summaryModel: string
  stt?: ProviderConfig
  llm?: ProviderConfig
  userName: string
  userEmail: string
  userCompany: string
  userRole?: string
  audioFormat?: string
  recordingQuality?: string
  chunkDuration?: number
  language?: string
  dateFormat?: string
  autoSave?: boolean
  autoTranscribe?: boolean
}

type SaveConfigResult = {
  ok: true
}

type TranscribeAudioPayload = {
  filePath: string
  systemFilePath?: string
  language?: string
  candidateName?: string
}

type TranscribeAudioResult = {
  text: string
}

type GenerateSummaryPayload = {
  transcript: string
  criteria: string[]
  /** Formato del informe. */
  summaryType: 'resumen' | 'listado'
  /** Enfoque: de qué tipo de sesión se trata. Cambia el rol del modelo y los apartados. */
  summaryContext?: 'entrevista' | 'reunion'
  candidateName?: string
}

type GenerateSummaryResult = {
  text: string
}

interface Window {
  desktopApp?: {
    platform: string
    isDesktop: boolean
    saveRecording: (payload: SaveRecordingPayload) => Promise<SaveRecordingResult>
    saveVideoRecording: (payload: SaveVideoRecordingPayload) => Promise<SaveRecordingResult>
    saveSystemRecording: (payload: SaveRecordingPayload) => Promise<SaveRecordingResult>
    onCaptureSources: (cb: (sources: CaptureSourceOption[]) => void) => void
    pickCaptureSource: (sourceId: string | null) => Promise<{ ok: boolean }>
    setCaptureMode: (wantsVideo: boolean) => Promise<{ ok: boolean }>
    getConfig: () => Promise<GetConfigResult>
    saveConfig: (payload: SaveConfigPayload) => Promise<SaveConfigResult>
    getProviderCatalog: () => Promise<ProviderCatalog>
    testProvider: (payload: { kind: 'stt' | 'llm'; draft: ProviderConfig }) => Promise<{ ok: boolean; detail: string }>
    transcribeAudio: (payload: TranscribeAudioPayload) => Promise<TranscribeAudioResult>
    generateSummary: (payload: GenerateSummaryPayload) => Promise<GenerateSummaryResult>
    deleteRecording: (payload: { filePath: string }) => Promise<{ ok: boolean }>
    openOAuthWindow: (url: string) => Promise<string | null>
    exportPdf: (payload: { html: string; fileName: string }) => Promise<{ ok: boolean; cancelled?: boolean; filePath?: string }>
    getRecordingsDir: () => Promise<string>
    openRecordingsFolder: () => Promise<void>
    selectAudioFile: () => Promise<string | null>
    onMagicLinkTokens: (cb: (data: Record<string, string>) => void) => void
    checkForUpdates: () => Promise<{ ok: boolean; dev?: boolean; version?: string; error?: string }>
    installUpdate: () => Promise<void>
    onUpdaterEvent: (cb: (data: UpdaterEvent) => void) => void
    getAppVersion: () => Promise<string>
  }
}

type UpdaterEvent = {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

// ─── Tipos para el Agente 3 (uso en App.tsx) ────────────────────────────────
//
// Extensión del tipo Interview — campos nuevos a añadir:
//
//   transcriptionStatus: 'pending' | 'transcribing' | 'done' | 'error'
//   summaryInstructions: string
//   summaryText: string
//   summaryStatus: 'idle' | 'generating' | 'done' | 'error'
//
// Nuevo valor de ProfileTab:
//
//   type ProfileTab = 'entrevistas' | 'transcripcion' | 'resumen'
