type SaveRecordingPayload = {
  interviewId: string
  candidateName: string
  projectName?: string
  createdAt: string
  extension: string
  audioBytes: Uint8Array
}

type ConvertRecordingPayload = {
  filePath: string
  format: string
}

type SaveRecordingResult = {
  filePath: string
}

type SaveVideoRecordingPayload = {
  interviewId: string
  candidateName: string
  projectName?: string
  createdAt: string
  videoBytes: Uint8Array
}

/** Una pista que se va escribiendo a disco mientras se graba. */
type OpenRecordingStreamPayload = {
  interviewId: string
  candidateName: string
  projectName?: string
  createdAt: string
  kind: 'mix' | 'system' | 'video'
  extension: string
}

/** Conexión con el CRM de Orbit. Vive en un archivo local aparte, nunca en la nube. */
type CrmConfig = { apiUrl: string; apiKey: string; orbitDir: string; vaultDir: string }

/** Lo que trae un enlace calltranscriber://deal/<id> desde el botón del CRM. */
type CrmDealLink = { dealId: string; name: string; company: string; email: string; linkedin: string; stage: string }

/** Campos del trato que Claude rellena a partir de la llamada, más la nota. */
type CrmAnalysis = {
  spinSituation: string; spinProblem: string; spinImplication: string; spinNeedPayoff: string
  singleSalesObjective: string; nextStep: string; nota: string
}

type CrmAnalyzePayload = {
  interviewId: string
  candidateName: string
  deal: { company: string; contactEmail: string; linkedinUrl: string } & Partial<CrmAnalysis>
  transcript: string
  callAt: number
  callDate: string
  durationMin: number
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
  autoRecordCalls?: boolean
  openAtLogin?: boolean
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
  autoRecordCalls?: boolean
  openAtLogin?: boolean
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

/**
 * Los datos de trabajo cuando no hay nube: proyectos, candidatos y entrevistas.
 * Se tipan sueltos a propósito — el modelo real vive en App.tsx y aquí solo
 * viajan de ida y vuelta al archivo del disco.
 */
interface LocalDataPayload {
  projects?: unknown[]
  candidates?: unknown[]
  interviews?: unknown[]
}

// ── Subida de audio y vídeo a la nube (electron/cloud/upload-*) ─────────────

type CloudMediaKind = 'mix' | 'system' | 'video'

/** Lo que manda `cloud:upload-progress` y devuelve `cloudUploadStatus`. */
type CloudUploadStatus = {
  /** working = subiendo o preparando; paused = hay cola pero algo la frena; waiting = esperando para reintentar. */
  state: 'idle' | 'working' | 'paused' | 'waiting'
  pausedBy: 'user' | 'recording' | 'no-session' | null
  /** Lote actual (lo pendiente más lo acabado desde que la cola estuvo vacía): "subiendo {index}/{total}". */
  batch: { total: number; done: number; failed: number; index: number }
  bytes: { done: number; total: number }
  /** 0-100 del lote entero, ponderado por tamaño. */
  percent: number
  current: {
    id: string
    interviewLocalId: string
    kind: CloudMediaKind
    fileName: string
    phase: 'preparing' | 'compressing' | 'hashing' | 'uploading' | 'finishing'
    /** 0-100 de la fase en curso. */
    percent: number
  } | null
  /** Epoch ms del próximo reintento si no hay nada subiendo. */
  nextRetryAt: number | null
}

type CloudUploadItem = {
  /** `${interviewLocalId}:${kind}`: uno por entrevista y tipo. */
  id: string
  interviewLocalId: string
  kind: CloudMediaKind
  fileName: string
  localRelPath: string
  size: number
  status: 'pending' | 'working' | 'done' | 'error'
  attempts: number
  nextAttemptAt: number | null
  errorCode: 'missing-file' | 'failed' | null
  lastError: string | null
  compressed: boolean
  uploadedBytes: number | null
  mediaId: string | null
  completedAt: number | null
}

type CloudUploadEntry = { filePath: string; interviewLocalId: string; kind: CloudMediaKind; durationSec?: number }

type CloudMigrationFile = {
  filePath: string
  localRelPath: string
  bytes: number
  kind: CloudMediaKind
  interviewLocalId: string
  durationSec: number | null
  candidateName: string
  projectName: string
  createdAt: string | null
}

type CloudMigrationPlan = {
  root: string
  createdAt: number
  items: CloudMigrationFile[]
  /** No se suben: decide el usuario. */
  orphans: { filePath: string; localRelPath: string; bytes: number; reason: 'no-interview' | 'unrecognized-name' | 'duplicate'; interviewLocalId: string | null }[]
  /** Enlazados por una entrevista pero fuera de Documentos\CallTranscriber. Solo con includeExternal. */
  external: CloudMigrationFile[]
  /** Entrevistas que apuntan a un archivo que no está en este PC. */
  missing: { interviewLocalId: string; kind: CloudMediaKind; filePath: string }[]
  totals: {
    files: number
    bytes: number
    byKind: Record<CloudMediaKind, { files: number; bytes: number }>
    orphans: { files: number; bytes: number }
    external: { files: number; bytes: number }
    missing: number
  }
}

type CloudEnqueueResult = { added: number; updated: number; skipped: number }

interface Window {
  desktopApp?: {
    platform: string
    isDesktop: boolean
    saveRecording: (payload: SaveRecordingPayload) => Promise<SaveRecordingResult>
    convertRecording: (payload: ConvertRecordingPayload) => Promise<SaveRecordingResult>
    saveVideoRecording: (payload: SaveVideoRecordingPayload) => Promise<SaveRecordingResult>
    saveSystemRecording: (payload: SaveRecordingPayload) => Promise<SaveRecordingResult>
    openRecordingStream?: (payload: OpenRecordingStreamPayload) => Promise<{ streamId: number; filePath: string }>
    appendRecordingStream?: (payload: { streamId: number; bytes: Uint8Array }) => Promise<{ ok: boolean }>
    closeRecordingStream?: (payload: { streamId: number }) => Promise<{ filePath: string | null }>
    getCrmConfig?: () => Promise<CrmConfig>
    saveCrmConfig?: (cfg: CrmConfig) => Promise<CrmConfig>
    takePendingDeal?: () => Promise<CrmDealLink | null>
    onOpenDeal?: (cb: (deal: CrmDealLink) => void) => () => void
    analyzeAndSendToCrm?: (payload: CrmAnalyzePayload) => Promise<{ analysis: CrmAnalysis; sent: boolean; sendError: string | null }>
    onCaptureSources: (cb: (sources: CaptureSourceOption[]) => void) => void
    pickCaptureSource: (sourceId: string | null) => Promise<{ ok: boolean }>
    setCaptureMode: (wantsVideo: boolean) => Promise<{ ok: boolean }>
    getConfig: () => Promise<GetConfigResult>
    saveConfig: (payload: SaveConfigPayload) => Promise<SaveConfigResult>
    getLocalData: () => Promise<LocalDataPayload | null>
    saveLocalData: (payload: LocalDataPayload) => Promise<{ ok: boolean }>
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
    onCallEvent?: (cb: (ev: { type: 'start' | 'end'; app: string; title: string }) => void) => () => void
    showWindow?: () => Promise<void>
    notify?: (payload: { title: string; body: string }) => Promise<void>
    cloudUploadStatus?: () => Promise<CloudUploadStatus>
    cloudUploadList?: () => Promise<CloudUploadItem[]>
    cloudUploadEnqueue?: (entries: CloudUploadEntry[]) => Promise<CloudEnqueueResult>
    cloudUploadPause?: () => Promise<{ ok: boolean }>
    cloudUploadResume?: () => Promise<{ ok: boolean }>
    cloudUploadRetry?: (payload?: { id?: string }) => Promise<{ retried: number }>
    cloudUploadRemove?: (payload: { id: string }) => Promise<{ removed: boolean }>
    cloudUploadSetRecording?: (value: boolean) => Promise<{ ok: boolean }>
    onCloudUploadProgress?: (cb: (status: CloudUploadStatus) => void) => () => void
    cloudMigrationPlan?: () => Promise<CloudMigrationPlan>
    cloudMigrationRun?: (options?: { includeExternal?: boolean }) => Promise<CloudEnqueueResult>
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
