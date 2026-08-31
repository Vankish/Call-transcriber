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
  /** Adaptador escrito pero nunca ejecutado contra la API real. Ver providers.cjs. */
  unverified?: boolean
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
  interviewerName?: string
}

type TranscribeAudioResult = {
  text: string
}

type GenerateSummaryPayload = {
  /** Solo para el progreso: identifica de qué entrevista son los avisos. */
  interviewId?: string
  transcript: string
  criteria: string[]
  /** Notas preparadas de antemano. Si vienen, solo queda redactar: una petición. */
  notasPreparadas?: string | null
  /** Formato del informe. */
  summaryType: 'resumen' | 'listado'
  /** Enfoque: de qué tipo de sesión se trata. Cambia el rol del modelo y los apartados. */
  summaryContext?: 'entrevista' | 'reunion'
  candidateName?: string
  interviewerName?: string
}

type GenerateSummaryResult = {
  text: string
  /** Notas que ha costado extraer, si hubo que trocear. Se guardan para que el
   *  siguiente informe sobre la misma conversación no vuelva a pagarlas. */
  notes?: string
  recortado?: boolean
}

/** Notas ya extraídas de la conversación, listas para redactar el informe encima.
 *  `needed: false` = la llamada cabía de una vez y no hay nada que preparar. */
type PrepareSummaryResult = {
  needed: boolean
  notes?: string
  /** Las notas no cabían ni condensadas y les falta el tramo final. */
  recortado?: boolean
}

/** Señal de vida durante un resumen largo. El trabajo se cuenta en PETICIONES al
 *  modelo, que es lo que de verdad tarda: cada una consume cuota del minuto y la
 *  siguiente tiene que esperar a que la ventana se libere. */
type SummaryProgress = {
  interviewId?: string
  fase: 'preparando' | 'analizando' | 'compactando' | 'redactando'
  etiqueta: string
  hechas: number
  total: number
  /** Segundos que se estima que quedan. Aproximado a propósito. */
  etaSec: number
  /** Si se está esperando cuota, momento (epoch ms) en que se reanuda. */
  esperaHasta: number | null
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
    prepareSummary: (payload: GenerateSummaryPayload) => Promise<PrepareSummaryResult>
    onSummaryProgress: (cb: (data: SummaryProgress) => void) => () => void
    deleteRecording: (payload: { filePath: string }) => Promise<{ ok: boolean }>
    ensureRecordingDuration: (payload: { filePath: string }) => Promise<{ ok: boolean; repaired: boolean }>
    recordingExists: (payload: { filePath: string }) => Promise<{ exists: boolean; size?: number }>
    readRecordingBytes: (payload: { filePath: string }) => Promise<{ ok: boolean; bytes?: Uint8Array<ArrayBuffer>; error?: string }>
    writeRecordingBytes: (payload: { fileName: string; bytes: Uint8Array<ArrayBuffer> }) => Promise<{ ok: boolean; filePath?: string; error?: string }>
    openOAuthWindow: (url: string) => Promise<string | null>
    exportPdf: (payload: { html: string; fileName: string }) => Promise<{ ok: boolean; cancelled?: boolean; filePath?: string }>
    getRecordingsDir: () => Promise<string>
    openRecordingsFolder: () => Promise<void>
    selectAudioFile: () => Promise<string | null>
    onMagicLinkTokens: (cb: (data: Record<string, string>) => void) => void
    checkForUpdates: () => Promise<{ ok: boolean; dev?: boolean; version?: string; error?: string }>
    openReleasesPage: () => Promise<{ ok: boolean }>
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
