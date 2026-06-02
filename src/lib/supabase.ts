import { createClient } from '@supabase/supabase-js'

const url  = import.meta.env.VITE_SUPABASE_URL  as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const isConfigured = url && !url.startsWith('YOUR_') && anon && !anon.startsWith('YOUR_')

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
  country: string; groq_api_key: string; tx_model: string; sum_model: string
}

export interface DbProject {
  id: string; user_id: string; name: string; company: string
  status: string; created_at: string; evaluation_criteria?: string[]
}

export interface DbCandidate {
  id: string; user_id: string; project_id: string
  name: string; email: string; phone: string; role: string; notes: string
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
  created_at: string; updated_at: string
}
