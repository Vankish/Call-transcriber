import { createClient } from '@supabase/supabase-js'

const url  = import.meta.env.VITE_SUPABASE_URL  as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Un valor de relleno (el de .env.example, o el que mete `npm run build:publico`)
// cuenta como "no configurado": la app arranca en modo local y ensena el aviso de
// AuthScreen en vez de intentar hablar con un proyecto que no existe.
//
// Se busca 'YOUR_' en cualquier posicion, no solo al principio: la URL de ejemplo
// es https://YOUR_PROJECT.supabase.co, que empieza por 'https://' y se colaba.
const esRelleno = (v?: string) => !v || v.includes('YOUR_') || v.includes('placeholder')

const isConfigured = !esRelleno(url) && !esRelleno(anon)

export const supabase = createClient(
  isConfigured ? url! : 'https://placeholder.supabase.co',
  isConfigured ? anon! : 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
)

export const isSupabaseConfigured = !!isConfigured

// ── DB row types (snake_case) ─────────────────────────────────────────────────
export interface DbProfile {
  id: string; name: string; email: string; company: string; photo: string
  country: string; tx_model: string; sum_model: string
}

export interface DbProject {
  id: string; user_id: string; name: string; company: string
  status: string; created_at: string; evaluation_criteria?: string[]
  interviewers?: string[]
}

export interface DbCandidate {
  id: string; user_id: string; project_id: string
  name: string; email: string; phone: string; role: string; notes: string
  candidate_status: string
  consent_given?: boolean; consent_at?: string | null
  created_at: string
}

export interface DbInterview {
  id: string; user_id: string; candidate_id: string; project_id: string
  session_name: string; status: string; duration_sec: number
  mic_device_id: string; output_device_id: string
  transcript_original: string; transcript_edited: string
  transcript_updated_at: string | null
  recording_url: string | null; recording_file_path: string | null
  capture_source: string; transcription_status: string
  summary_instructions: string; summary_text: string
  summary_status: string; summary_type: string
  summary_context?: string; interviewer_name?: string
  system_audio_file_name?: string; audio_uploaded?: boolean
  created_at: string; updated_at: string
}

// El correo se guarda junto al id porque es lo único que se puede enseñar si el
// perfil del compañero no es legible (RLS) o si borra su cuenta.
export interface DbProjectShare {
  id: string; project_id: string; owner_id: string
  shared_with_id: string; shared_with_email: string; created_at: string
}
