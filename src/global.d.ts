type SaveRecordingPayload = {
  interviewId: string
  candidateName: string
  createdAt: string
  extension: string
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
}

type SaveConfigPayload = {
  groqApiKey: string
  transcriptionModel: string
  summaryModel: string
  userName: string
  userEmail: string
  userCompany: string
}

type SaveConfigResult = {
  ok: true
}

type TranscribeAudioPayload = {
  filePath: string
}

type TranscribeAudioResult = {
  text: string
}

type GenerateSummaryPayload = {
  transcript: string
  instructions: string
  summaryType: 'resumen' | 'listado'
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
  }
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
