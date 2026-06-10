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

type GetConfigResult = {
  groqApiKey: string | null
  transcriptionModel?: string
  summaryModel?: string
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
  language?: string
  candidateName?: string
}

type TranscribeAudioResult = {
  text: string
}

type GenerateSummaryPayload = {
  transcript: string
  criteria: string[]
  summaryType: 'resumen' | 'listado'
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
    getConfig: () => Promise<GetConfigResult>
    saveConfig: (payload: SaveConfigPayload) => Promise<SaveConfigResult>
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
