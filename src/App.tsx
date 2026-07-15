import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { DbCandidate, DbInterview, DbProject } from './lib/supabase'
import { AuthScreen } from './AuthScreen'

// ── Types ──────────────────────────────────────────────────────────────────
type Project = { id: string; name: string; company: string; createdAt: string; status: 'active' | 'closed'; evaluationCriteria: string[] }

const EVALUATION_CRITERIA = [
  { id: 'experiencia',   label: 'Experiencia laboral' },
  { id: 'formacion',     label: 'Formación académica' },
  { id: 'situacion',     label: 'Situación personal' },
  { id: 'habilidades',   label: 'Habilidades técnicas' },
  { id: 'idiomas',       label: 'Idiomas' },
  { id: 'disponibilidad',label: 'Disponibilidad' },
  { id: 'salario',       label: 'Pretensiones salariales' },
  { id: 'motivacion',    label: 'Motivación y expectativas' },
  { id: 'blandas',       label: 'Competencias interpersonales' },
  { id: 'adecuacion',    label: 'Adecuación al puesto' },
  { id: 'otros',         label: 'Otros' },
]
type Candidate = { id: string; projectId: string; name: string; email: string; phone: string; role: string; notes: string; candidateStatus: 'pendiente' | 'apto' | 'descartado' | 'finalista'; consentGiven: boolean; consentAt: string | null }
type ProfileTab = 'entrevistas' | 'transcripcion' | 'resumen'
type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped'
type Interview = {
  id: string; candidateId: string; createdAt: string; sessionName: string
  status: RecordingStatus; durationSec: number; micDeviceId: string; outputDeviceId: string
  transcriptOriginal: string; transcriptEdited: string; transcriptUpdatedAt: string | null
  recordingUrl: string | null; recordingFilePath: string | null
  videoFilePath: string | null
  systemAudioFilePath: string | null
  captureSource: 'none' | 'mic' | 'mic+system'
  transcriptionStatus: 'pending' | 'transcribing' | 'done' | 'error'
  summaryInstructions: string; summaryText: string
  summaryStatus: 'idle' | 'generating' | 'done' | 'error'
  summaryType: 'resumen' | 'listado'
}
type AudioDeviceOption = { id: string; name: string }
type Toast = { id: string; message: string; sub?: string; type: 'success' | 'error' | 'info' | 'warning' }
type Screen = 'dashboard' | 'projects' | 'project-detail' | 'candidate-detail' | 'candidates' | 'settings' | 'profile' | 'search'
type ProfileScreenTab = 'perfil' | 'plan' | 'seguridad' | 'notif'
type SettingsTab = 'api-keys' | 'grabacion' | 'general'

// ── Storage ────────────────────────────────────────────────────────────────
const V2_KEY = 'call-transcriber-v2'
const ONBOARDING_KEY = 'ct-onboarding-done'
const CRITERIA_KEY = 'ct-criteria-cache'

const getCriteriaCache = (): Record<string, string[]> => {
  try { return JSON.parse(localStorage.getItem(CRITERIA_KEY) ?? '{}') } catch { return {} }
}
const saveCriteriaCache = (projectId: string, criteria: string[]) => {
  const cache = getCriteriaCache()
  cache[projectId] = criteria
  localStorage.setItem(CRITERIA_KEY, JSON.stringify(cache))
}

// El vídeo de una entrevista solo se guarda en local (nunca sube a Supabase, pesa
// demasiado), así que su ruta también hay que cachearla en local: si no, se pierde
// cada vez que la app recarga las entrevistas desde la nube (que no sabe de vídeos).
const VIDEO_PATH_KEY = 'ct-video-paths'
const getVideoPathCache = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(VIDEO_PATH_KEY) ?? '{}') } catch { return {} }
}
const saveVideoPathCache = (interviewId: string, videoFilePath: string | null) => {
  const cache = getVideoPathCache()
  if (videoFilePath) cache[interviewId] = videoFilePath
  else delete cache[interviewId]
  localStorage.setItem(VIDEO_PATH_KEY, JSON.stringify(cache))
}

// Igual que el vídeo: el audio del sistema (pista del interlocutor) tampoco sube
// a Supabase, así que su ruta se pierde al reabrir la app si no se cachea aquí.
const SYSTEM_AUDIO_PATH_KEY = 'ct-system-audio-paths'
const getSystemAudioPathCache = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(SYSTEM_AUDIO_PATH_KEY) ?? '{}') } catch { return {} }
}
const saveSystemAudioPathCache = (interviewId: string, systemAudioFilePath: string | null) => {
  const cache = getSystemAudioPathCache()
  if (systemAudioFilePath) cache[interviewId] = systemAudioFilePath
  else delete cache[interviewId]
  localStorage.setItem(SYSTEM_AUDIO_PATH_KEY, JSON.stringify(cache))
}

// ── Helpers ────────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID()
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
const fmtDate = (iso: string, locale = 'es-ES') => new Date(iso).toLocaleString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const fmtShort = (iso: string, locale = 'es-ES') => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
const getExt = (mime: string) => mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'bin'
const initials = (name: string) => name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
const AVATAR_COLORS = ['#2563eb', '#10b981', '#f59e33', '#eb4566', '#8b5cf6', '#ec4899']
const avatarColor = (id: string) => AVATAR_COLORS[id.charCodeAt(id.length - 1) % AVATAR_COLORS.length]

// ── Icons ──────────────────────────────────────────────────────────────────
const TrashIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
const CheckIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
const PencilIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
const PlayIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
const PauseIconSm = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
const HomeIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
const FolderIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>

const SettingsIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
const UserIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
const ChevronRight = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
const ChevronLeft = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
const SearchIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
const DownloadIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
const UploadIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
const UsersIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
const KeyIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="15" r="5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>
const MicIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
const LockIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
const BellIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
const StarIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
const DocIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
const ClipboardIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
const CameraIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
const ListViewIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
const GridViewIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>

const EMPTY_PROJECT = { name: '', company: '', status: 'active' as const, evaluationCriteria: [] as string[] }
const EMPTY_CANDIDATE = { name: '', email: '', phone: '', role: '' }

function normalizeInterviews(arr: Interview[]): Interview[] {
  return arr.map(i => ({
    ...i,
    sessionName: i.sessionName ?? '',
    recordingUrl: null,
    recordingFilePath: i.recordingFilePath ?? null,
    videoFilePath: i.videoFilePath ?? null,
    systemAudioFilePath: i.systemAudioFilePath ?? null,
    captureSource: i.captureSource ?? 'none',
    // Una entrevista con status 'recording'/'paused' solo puede venir de una sesión
    // anterior que se cerró (crash, cierre forzado) antes de llegar a parar la
    // grabación — al arrancar la app no existe ningún MediaRecorder real detrás.
    // Sin esto, la pantalla de "grabando" se queda bloqueada para siempre (solo se
    // puede pausar, nunca parar, porque no hay grabador al que llamar .stop()).
    status: (i.status === 'recording' || i.status === 'paused') ? 'stopped' : i.status,
    transcriptionStatus: i.transcriptionStatus === 'transcribing' ? 'error'
      : i.transcriptionStatus ?? (i.transcriptOriginal && !i.transcriptOriginal.startsWith('Transcripcion pendiente') ? 'done' : 'pending'),
    summaryInstructions: i.summaryInstructions ?? '',
    summaryText: i.summaryText ?? '',
    summaryStatus: i.summaryStatus ?? 'idle',
    summaryType: i.summaryType ?? 'resumen',
  }))
}

// ── DB ↔ App converters ────────────────────────────────────────────────────────
const projFromDb  = (r: DbProject):   Project   => ({ id: r.id, name: r.name, company: r.company, createdAt: r.created_at, status: r.status as Project['status'], evaluationCriteria: (r.evaluation_criteria as string[] | undefined) ?? [] })
const candFromDb  = (r: DbCandidate): Candidate => ({ id: r.id, projectId: r.project_id, name: r.name, email: r.email, phone: r.phone, role: r.role, notes: r.notes ?? '', candidateStatus: (r.candidate_status as Candidate['candidateStatus']) ?? 'pendiente', consentGiven: r.consent_given ?? false, consentAt: r.consent_at ?? null })
const ivFromDb    = (r: DbInterview): Interview => ({
  id: r.id, candidateId: r.candidate_id, createdAt: r.created_at,
  sessionName: r.session_name, status: r.status as RecordingStatus,
  durationSec: r.duration_sec, micDeviceId: r.mic_device_id, outputDeviceId: r.output_device_id,
  transcriptOriginal: r.transcript_original, transcriptEdited: r.transcript_edited,
  transcriptUpdatedAt: r.transcript_updated_at, recordingUrl: null, recordingFilePath: r.recording_file_path, videoFilePath: null, systemAudioFilePath: null,
  captureSource: r.capture_source as Interview['captureSource'],
  transcriptionStatus: r.transcription_status as Interview['transcriptionStatus'],
  summaryInstructions: r.summary_instructions, summaryText: r.summary_text,
  summaryStatus: r.summary_status as Interview['summaryStatus'],
  summaryType: r.summary_type as Interview['summaryType'],
})
const ivPatchToDb = (patch: Partial<Interview>): Record<string, unknown> => {
  const db: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.sessionName           !== undefined) db.session_name          = patch.sessionName
  if (patch.status                !== undefined) db.status                = patch.status
  if (patch.durationSec           !== undefined) db.duration_sec          = patch.durationSec
  if (patch.transcriptOriginal    !== undefined) db.transcript_original   = patch.transcriptOriginal
  if (patch.transcriptEdited      !== undefined) db.transcript_edited     = patch.transcriptEdited
  if (patch.transcriptUpdatedAt   !== undefined) db.transcript_updated_at = patch.transcriptUpdatedAt
  if (patch.recordingFilePath     !== undefined) db.recording_file_path   = patch.recordingFilePath
  if (patch.captureSource         !== undefined) db.capture_source        = patch.captureSource
  if (patch.transcriptionStatus   !== undefined) db.transcription_status  = patch.transcriptionStatus
  if (patch.summaryInstructions   !== undefined) db.summary_instructions  = patch.summaryInstructions
  if (patch.summaryText           !== undefined) db.summary_text          = patch.summaryText
  if (patch.summaryStatus         !== undefined) db.summary_status        = patch.summaryStatus
  if (patch.summaryType           !== undefined) db.summary_type          = patch.summaryType
  return db
}

const DotFilled = ({ size = 8 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 8 8" style={{ display: 'inline', verticalAlign: 'middle', flexShrink: 0 }}><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
const DotRing = ({ size = 8 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 8 8" style={{ display: 'inline', verticalAlign: 'middle', flexShrink: 0 }}><circle cx="4" cy="4" r="3" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
const SquareFilled = ({ size = 8 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 8 8" style={{ display: 'inline', verticalAlign: 'middle', flexShrink: 0 }}><rect width="8" height="8" rx="1" fill="currentColor"/></svg>
const WarnTriangle = ({ size = 12 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ display: 'inline', verticalAlign: 'middle', flexShrink: 0 }}><path d="M8 1L15 14H1L8 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><line x1="8" y1="6" x2="8" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="8" cy="12.5" r="0.75" fill="currentColor"/></svg>

const EmptyState = ({ icon, title, sub, btnLabel, onBtn }: { icon?: React.ReactNode; title: string; sub: string; btnLabel?: string; onBtn?: () => void }) => (
  <div className="empty-state">
    <div className="es-circle"><span className="es-icon">{icon ?? '◎'}</span></div>
    <h3 className="es-title">{title}</h3>
    <p className="es-sub">{sub}</p>
    {btnLabel && onBtn && <button type="button" className="primary-btn pill-btn es-btn" onClick={onBtn}>{btnLabel}</button>}
  </div>
)

const ViewToggle = ({ mode, onChange }: { mode: 'list' | 'grid'; onChange: (m: 'list' | 'grid') => void }) => (
  <div className="view-toggle">
    <button type="button" className={`view-toggle-btn${mode === 'list' ? ' view-toggle-btn--active' : ''}`} title="Lista de detalles" onClick={() => onChange('list')}>
      <ListViewIcon /> Lista de detalles
    </button>
    <button type="button" className={`view-toggle-btn${mode === 'grid' ? ' view-toggle-btn--active' : ''}`} title="Cuadrícula" onClick={() => onChange('grid')}>
      <GridViewIcon /> Cuadrícula
    </button>
  </div>
)

function App() {
  // ── Core data ──────────────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [interviews, setInterviews] = useState<Interview[]>([])

  // ── Navigation ─────────────────────────────────────────────────────────
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ProfileTab>('entrevistas')
  const [profileScreenTab, setProfileScreenTab] = useState<ProfileScreenTab>('perfil')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [searchQuery, setSearchQuery] = useState('')
  const [projectSearchQuery, setProjectSearchQuery] = useState('')
  const [projectStatusFilter, setProjectStatusFilter] = useState<'all' | 'active' | 'closed'>('all')
  const [projectsViewMode, setProjectsViewMode] = useState<'list' | 'grid'>('list')
  const [profilesViewMode, setProfilesViewMode] = useState<'list' | 'grid'>('list')

  // ── Interview selection ────────────────────────────────────────────────
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null)
  const [transcriptDraft, setTranscriptDraft] = useState('')

  // ── Audio devices ──────────────────────────────────────────────────────
  const [micDevices, setMicDevices] = useState<AudioDeviceOption[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([])
  const [_recordingMessage, setRecordingMessage] = useState('')
  const [defaultMicDeviceId, setDefaultMicDeviceId] = useState('')
  const [defaultOutputDeviceId, setDefaultOutputDeviceId] = useState('')
  const [defaultCaptureSystem, setDefaultCaptureSystem] = useState(false)
  const [defaultRecordVideo, setDefaultRecordVideo] = useState(false)
  const [defaultVideoQuality, setDefaultVideoQuality] = useState<'720p' | '1080p'>('1080p')
  const [settingsDefaultMicDraft, setSettingsDefaultMicDraft] = useState('')
  const [settingsDefaultOutputDraft, setSettingsDefaultOutputDraft] = useState('')
  const [settingsDefaultSystemDraft, setSettingsDefaultSystemDraft] = useState(false)
  const [settingsRecordVideoDraft, setSettingsRecordVideoDraft] = useState(false)
  const [settingsVideoQualityDraft, setSettingsVideoQualityDraft] = useState<'720p' | '1080p'>('1080p')
  const [showAudioSetupModal, setShowAudioSetupModal] = useState(false)
  const [pendingMicId, setPendingMicId] = useState('')
  const [pendingOutputId, setPendingOutputId] = useState('')
  const [pendingRecordVideo, setPendingRecordVideo] = useState(false)

  // ── Config ─────────────────────────────────────────────────────────────
  const [configLoaded, setConfigLoaded] = useState(false)
  const [groqApiKey, setGroqApiKey] = useState('')
  const [transcriptionModel, setTranscriptionModel] = useState('whisper-large-v3')
  const [summaryModel, setSummaryModel] = useState('llama-3.3-70b-versatile')
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [userCompany, setUserCompany] = useState('')
  const [autoTranscribe, setAutoTranscribe] = useState(false)
  const [notifTranscription, setNotifTranscription] = useState(true)
  const [notifSummary, setNotifSummary] = useState(true)
  const [notifErrors, setNotifErrors] = useState(true)

  // ── Settings drafts ────────────────────────────────────────────────────
  const [settingsKeyDraft, setSettingsKeyDraft] = useState('')
  const [settingsTxModelDraft, setSettingsTxModelDraft] = useState('whisper-large-v3')
  const [settingsSumModelDraft, setSettingsSumModelDraft] = useState('llama-3.3-70b-versatile')
  const [settingsNameDraft, setSettingsNameDraft] = useState('')
  const [settingsEmailDraft, setSettingsEmailDraft] = useState('')
  const [settingsCompanyDraft, setSettingsCompanyDraft] = useState('')
  const [settingsPasswordDraft, setSettingsPasswordDraft] = useState('')
  const [settingsPasswordNewDraft, setSettingsPasswordNewDraft] = useState('')
  const [settingsPasswordConfirmDraft, setSettingsPasswordConfirmDraft] = useState('')
  const [settingsAudioFormatDraft, setSettingsAudioFormatDraft] = useState<'mp3' | 'wav'>('mp3')
  const [settingsChunkDurationDraft, setSettingsChunkDurationDraft] = useState(600)
  const [settingsRecordingQualityDraft, setSettingsRecordingQualityDraft] = useState('high')
  const [settingsLanguageDraft, setSettingsLanguageDraft] = useState('es')
  const [settingsAutoSaveDraft, setSettingsAutoSaveDraft] = useState(true)
  const [settingsDateFormatDraft, setSettingsDateFormatDraft] = useState('DD/MM/YYYY')
  const [autoSave, setAutoSave] = useState(true)
  const [userRole, setUserRole] = useState('')
  const [settingsRoleDraft, setSettingsRoleDraft] = useState('')
  const [notifProductUpdates, setNotifProductUpdates] = useState(false)
  const [txSearchQuery, setTxSearchQuery] = useState('')
  const [ivSearchQuery, setIvSearchQuery] = useState('')
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [projDetailTab, setProjDetailTab] = useState<'perfiles' | 'analisis'>('perfiles')
  const [showCriteriaEdit, setShowCriteriaEdit] = useState(false)
  const [recordingsDir, setRecordingsDir] = useState('')
  const [exportFormat, setExportFormat] = useState<'pdf' | 'txt' | 'clipboard'>('clipboard')
  const [txLang, setTxLang] = useState('auto')
  const [userPhoto, setUserPhoto] = useState('')
  const [candidateNotesDraft, setCandidateNotesDraft] = useState('')
  const [candidateStatusDraft, setCandidateStatusDraft] = useState<Candidate['candidateStatus']>('pendiente')
  const [candidateConsentDraft, setCandidateConsentDraft] = useState(false)
  const [retranscribeConfirmId, setRetranscribeConfirmId] = useState<string | null>(null)

  // ── Modals & overlays ──────────────────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingKeyDraft, setOnboardingKeyDraft] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [showEditProject, setShowEditProject] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [showNewCandidate, setShowNewCandidate] = useState(false)
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null)
  const [projectDraft, setProjectDraft] = useState<{ name: string; company: string; status: 'active' | 'closed'; evaluationCriteria: string[] }>(EMPTY_PROJECT)
  const [candidateDraft, setCandidateDraft] = useState(EMPTY_CANDIDATE)
  const [showSessionNameModal, setShowSessionNameModal] = useState(false)
  const [sessionNameDraft, setSessionNameDraft] = useState('')
  const [discardConfirming, setDiscardConfirming] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [editingInterviewId, setEditingInterviewId] = useState<string | null>(null)
  const [editingNameDraft, setEditingNameDraft] = useState('')
  const [showProfilePopup, setShowProfilePopup] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [exportCandidateId, setExportCandidateId] = useState<string | null>(null)
  const [dashFilter, setDashFilter] = useState<'active' | 'closed'>('active')
  const [dashSearch, setDashSearch] = useState('')

  // ── Playback ───────────────────────────────────────────────────────────
  const [playingInterviewId, setPlayingInterviewId] = useState<string | null>(null)
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null)
  const [_playbackProgress, setPlaybackProgress] = useState(0)
  const [playbackCurrentTime, setPlaybackCurrentTime] = useState(0)
  const [playbackDuration, setPlaybackDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)

  // ── Auth ───────────────────────────────────────────────────────────────
  const [session, setSession]       = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')

  // ── Toasts ─────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([])

  // ── Auto-actualización ─────────────────────────────────────────────────
  const [updateStatus, setUpdateStatus] = useState<UpdaterEvent | null>(null)
  const [appVersion, setAppVersion] = useState('')
  useEffect(() => {
    window.desktopApp?.onUpdaterEvent?.((data) => setUpdateStatus(data))
    window.desktopApp?.getAppVersion?.().then(setAppVersion).catch(() => {})
  }, [])

  // ── Refs ───────────────────────────────────────────────────────────────
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const systemStreamRef = useRef<MediaStream | null>(null)
  const mixedStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const chunkRef = useRef<Blob[]>([])
  const activeInterviewIdRef = useRef<string | null>(null)
  const pendingBlobRef = useRef<Blob | null>(null)
  const pendingMimeTypeRef = useRef<string>('')
  const videoMediaRecorderRef = useRef<MediaRecorder | null>(null)
  const videoChunkRef = useRef<Blob[]>([])
  const pendingVideoBlobRef = useRef<Blob | null>(null)
  // Grabador SOLO-sistema (voz limpia del interlocutor), en paralelo a la mezcla.
  // Se usa únicamente para transcribir: permite separar hablantes de forma
  // determinista (sistema = [Candidato]) sin que una IA tenga que adivinar.
  const systemRecorderRef = useRef<MediaRecorder | null>(null)
  const systemChunkRef = useRef<Blob[]>([])
  const pendingSystemBlobRef = useRef<Blob | null>(null)
  const pendingSystemMimeRef = useRef<string>('')
  const discardedInterviewIdsRef = useRef<Set<string>>(new Set())
  const [livePreviewStream, setLivePreviewStream] = useState<MediaStream | null>(null)
  const [captureWindowLabel, setCaptureWindowLabel] = useState('')
  const pipVideoRef = useRef<HTMLVideoElement | null>(null)
  const [captureSources, setCaptureSources] = useState<CaptureSourceOption[] | null>(null)
  const [videoPlaybackRate, setVideoPlaybackRate] = useState(1)
  const [videoVolume, setVideoVolume] = useState(1)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const localDataLoaded = useRef(false)

  // ── Derived ────────────────────────────────────────────────────────────
  const activeProject = projects.find(p => p.id === activeProjectId) ?? null
  const activeCandidate = candidates.find(c => c.id === activeCandidateId) ?? null
  const projectCandidates = useMemo(() => candidates.filter(c => c.projectId === activeProjectId), [candidates, activeProjectId])
  const filteredCandidates = useMemo(() => {
    if (!searchQuery.trim()) return projectCandidates
    const q = searchQuery.toLowerCase()
    return projectCandidates.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.role.toLowerCase().includes(q))
  }, [projectCandidates, searchQuery])
  const filteredProjects = useMemo(() => {
    let list = projects
    if (projectStatusFilter !== 'all') list = list.filter(p => p.status === projectStatusFilter)
    if (projectSearchQuery.trim()) {
      const q = projectSearchQuery.toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.company.toLowerCase().includes(q))
    }
    return list
  }, [projects, projectSearchQuery, projectStatusFilter])
  const candidateInterviews = useMemo(() =>
    interviews.filter(i => i.candidateId === activeCandidateId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [interviews, activeCandidateId])
  const selectedInterview = candidateInterviews.find(i => i.id === selectedInterviewId)
  const activeRecordingInterview = interviews.find(i => i.status === 'recording' || i.status === 'paused')
  const activeRecordingCandidate = activeRecordingInterview ? candidates.find(c => c.id === activeRecordingInterview.candidateId) : null
  const activeRecordingProject = activeRecordingCandidate ? projects.find(p => p.id === activeRecordingCandidate.projectId) : null
  const transcribingInterview = interviews.find(i => i.transcriptionStatus === 'transcribing')

  const stats = useMemo(() => ({
    projects: projects.length,
    interviews: interviews.length,
    transcribed: interviews.filter(i => i.transcriptionStatus === 'done').length,
    summaries: interviews.filter(i => i.summaryStatus === 'done').length,
  }), [projects, interviews])

  // ── Toast helper ───────────────────────────────────────────────────────
  const toast = useCallback((message: string, type: Toast['type'] = 'success', sub?: string) => {
    const id = uid()
    setToasts(t => [...t, { id, message, sub, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])

  // ── Auth: session management ───────────────────────────────────────────
  useEffect(() => {
    void supabase.auth.getSession()
      .then(({ data }) => { setSession(data.session) })
      .catch(() => {})
      .finally(() => setAuthLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'SIGNED_OUT') { setProjects([]); setCandidates([]); setInterviews([]) }
    })

    window.desktopApp?.onMagicLinkTokens?.((data: Record<string, string>) => {
      if (data.access_token && data.refresh_token) {
        void supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token })
          .then(() => { if (data.type === 'recovery') setRecoveryMode(true) })
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // ── Load data from Supabase when session is ready ──────────────────────
  useEffect(() => {
    if (!session) return
    const userId = session.user.id
    const load = async () => {
      try {
        // ── Merge: no descartar los datos locales de este dispositivo ──────────
        // Si aquí se crearon datos sin sesión (guardados en localStorage), los
        // subimos a la nube con upsert (por id, sin duplicar) ANTES de cargar.
        // Antes, si la nube ya tenía datos, los locales se descartaban en silencio
        // → "datos que se pierden de dispositivo a dispositivo".
        try {
          const rawLocal = localStorage.getItem(V2_KEY)
          if (rawLocal) {
            const d = JSON.parse(rawLocal) as { projects?: Project[]; candidates?: Candidate[]; interviews?: Interview[] }
            const projs = d.projects ?? []; const cands = d.candidates ?? []; const ivs = normalizeInterviews(d.interviews ?? [])
            if (projs.length) await supabase.from('projects').upsert(projs.map(p => ({ id: p.id, user_id: userId, name: p.name, company: p.company, status: p.status, evaluation_criteria: p.evaluationCriteria ?? [], created_at: p.createdAt })), { onConflict: 'id' })
            if (cands.length) await supabase.from('candidates').upsert(cands.map(c => ({ id: c.id, user_id: userId, project_id: c.projectId, name: c.name, email: c.email, phone: c.phone, role: c.role, notes: c.notes ?? '', candidate_status: c.candidateStatus ?? 'pendiente', consent_given: c.consentGiven ?? false, consent_at: c.consentAt ?? null })), { onConflict: 'id' })
            for (const iv of ivs) {
              const cand = cands.find(c => c.id === iv.candidateId)
              if (!cand) continue
              await supabase.from('interviews').upsert({ id: iv.id, user_id: userId, candidate_id: iv.candidateId, project_id: cand.projectId, session_name: iv.sessionName, status: iv.status, duration_sec: iv.durationSec, mic_device_id: iv.micDeviceId, output_device_id: iv.outputDeviceId, transcript_original: iv.transcriptOriginal, transcript_edited: iv.transcriptEdited, transcript_updated_at: iv.transcriptUpdatedAt, recording_file_path: iv.recordingFilePath, capture_source: iv.captureSource, transcription_status: iv.transcriptionStatus, summary_instructions: iv.summaryInstructions, summary_text: iv.summaryText, summary_status: iv.summaryStatus, summary_type: iv.summaryType, created_at: iv.createdAt, updated_at: iv.createdAt }, { onConflict: 'id' })
            }
            if (projs.length || cands.length || ivs.length) { localStorage.removeItem(V2_KEY); toast('Datos de este equipo sincronizados a la nube ✓') }
          }
        } catch { /* si el merge falla, seguimos y cargamos lo que haya en la nube */ }

        const [pRes, cRes, iRes, prRes] = await Promise.all([
          supabase.from('projects').select('*').eq('user_id', userId).order('created_at'),
          supabase.from('candidates').select('*').eq('user_id', userId).order('created_at'),
          supabase.from('interviews').select('*').eq('user_id', userId).order('created_at'),
          supabase.from('profiles').select('*').eq('id', userId).single(),
        ])
        if (pRes.error) { toast(`Error cargando proyectos: ${pRes.error.message}`, 'error'); return }
        if (cRes.error) { toast(`Error cargando perfiles: ${cRes.error.message}`, 'error'); return }
        const hasRemote = (pRes.data?.length ?? 0) > 0 || (cRes.data?.length ?? 0) > 0
        if (hasRemote) {
          const criteriaCache = getCriteriaCache()
          const updatedCache: Record<string, string[]> = {}
          const loadedProjects = (pRes.data ?? []).map(r => {
            const p = projFromDb(r)
            if (p.evaluationCriteria.length > 0) {
              // Supabase tiene datos: es la fuente de verdad, actualizamos cache
              updatedCache[p.id] = p.evaluationCriteria
              return p
            }
            // Supabase devuelve vacío (columna sin datos o no existe): usamos cache local
            const cached = criteriaCache[p.id]
            return cached ? { ...p, evaluationCriteria: cached } : p
          })
          // Persistir el cache actualizado desde Supabase
          if (Object.keys(updatedCache).length > 0) {
            localStorage.setItem(CRITERIA_KEY, JSON.stringify({ ...criteriaCache, ...updatedCache }))
          }
          setProjects(loadedProjects)
          setCandidates((cRes.data ?? []).map(candFromDb))
          if (iRes.error) {
            toast(`Error cargando entrevistas: ${iRes.error.message}`, 'error')
          } else {
            const videoPathCache = getVideoPathCache()
            const systemAudioPathCache = getSystemAudioPathCache()
            setInterviews(normalizeInterviews((iRes.data ?? []).map(r => {
              const iv = ivFromDb(r)
              return {
                ...iv,
                videoFilePath: videoPathCache[iv.id] ?? iv.videoFilePath,
                systemAudioFilePath: systemAudioPathCache[iv.id] ?? iv.systemAudioFilePath,
              }
            })))
          }
        } else {
          // First login: migrate localStorage data to Supabase
          const raw = localStorage.getItem(V2_KEY)
          if (raw) {
            try {
              const d = JSON.parse(raw) as { projects?: Project[]; candidates?: Candidate[]; interviews?: Interview[] }
              const projs = d.projects ?? []; const cands = d.candidates ?? []; const ivs = normalizeInterviews(d.interviews ?? [])
              if (projs.length || cands.length) {
                if (projs.length) await supabase.from('projects').insert(projs.map(p => ({ id: p.id, user_id: userId, name: p.name, company: p.company, status: p.status, evaluation_criteria: p.evaluationCriteria ?? [], created_at: p.createdAt })))
                if (cands.length) await supabase.from('candidates').insert(cands.map(c => ({ id: c.id, user_id: userId, project_id: c.projectId, name: c.name, email: c.email, phone: c.phone, role: c.role, notes: '' })))
                for (const iv of ivs) {
                  const cand = cands.find(c => c.id === iv.candidateId)
                  if (!cand) continue
                  await supabase.from('interviews').insert({ id: iv.id, user_id: userId, candidate_id: iv.candidateId, project_id: cand.projectId, session_name: iv.sessionName, status: iv.status, duration_sec: iv.durationSec, mic_device_id: iv.micDeviceId, output_device_id: iv.outputDeviceId, transcript_original: iv.transcriptOriginal, transcript_edited: iv.transcriptEdited, transcript_updated_at: iv.transcriptUpdatedAt, recording_file_path: iv.recordingFilePath, capture_source: iv.captureSource, transcription_status: iv.transcriptionStatus, summary_instructions: iv.summaryInstructions, summary_text: iv.summaryText, summary_status: iv.summaryStatus, summary_type: iv.summaryType, created_at: iv.createdAt, updated_at: iv.createdAt })
                }
                setProjects(projs); setCandidates(cands); setInterviews(ivs)
                localStorage.removeItem(V2_KEY)
                toast('Datos migrados a la nube ✓')
              }
            } catch { /* ignore migration errors */ }
          }
        }
        if (prRes.data) {
          const p = prRes.data
          if (p.name)          setUserName(p.name)
          if (p.company)       setUserCompany(p.company)
          if (p.photo)         setUserPhoto(p.photo)
          // La Groq API key ya NO se lee de la nube: vive solo en el config.json local (ver setGroqApiKey desde cfg más abajo).
          if (p.tx_model)      setTranscriptionModel(p.tx_model)
          if (p.sum_model)     setSummaryModel(p.sum_model)
        }
      } catch { /* ignore */ }
    }
    void load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id])

  // ── LocalStorage fallback when no Supabase session ────────────────────
  useEffect(() => {
    if (authLoading || session || localDataLoaded.current) return
    localDataLoaded.current = true
    try {
      const raw = localStorage.getItem(V2_KEY)
      if (raw) {
        const d = JSON.parse(raw) as { projects?: Project[]; candidates?: Candidate[]; interviews?: Interview[] }
        setProjects(d.projects ?? [])
        setCandidates(d.candidates ?? [])
        setInterviews(normalizeInterviews(d.interviews ?? []))
      }
    } catch { /* ignore */ }
  }, [authLoading, session])

  useEffect(() => {
    if (!localDataLoaded.current || session) return
    localStorage.setItem(V2_KEY, JSON.stringify({ projects, candidates, interviews }))
  }, [projects, candidates, interviews, session])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setScreen('dashboard')
  }

  const handleChangePassword = async () => {
    if (!settingsPasswordNewDraft.trim()) { toast('Ingresa la nueva contraseña', 'error'); return }
    if (settingsPasswordNewDraft !== settingsPasswordConfirmDraft) { toast('Las contraseñas no coinciden', 'error'); return }
    if (settingsPasswordNewDraft.length < 6) { toast('La contraseña debe tener al menos 6 caracteres', 'error'); return }
    const { error } = await supabase.auth.updateUser({ password: settingsPasswordNewDraft })
    if (error) { toast(error.message, 'error'); return }
    toast('Contraseña actualizada correctamente')
    setSettingsPasswordDraft(''); setSettingsPasswordNewDraft(''); setSettingsPasswordConfirmDraft('')
  }

  // ── Init: load config ──────────────────────────────────────────────────
  useEffect(() => {
    if (window.desktopApp?.getRecordingsDir) {
      void window.desktopApp.getRecordingsDir().then(dir => setRecordingsDir(dir)).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!window.desktopApp?.getConfig) { setConfigLoaded(true); return }
    void window.desktopApp.getConfig().then(cfg => {
      setGroqApiKey(cfg.groqApiKey ?? '')
      setTranscriptionModel(cfg.transcriptionModel ?? 'whisper-large-v3')
      setSummaryModel(cfg.summaryModel ?? 'llama-3.3-70b-versatile')
      setUserName(cfg.userName ?? '')
      setUserEmail(cfg.userEmail ?? '')
      setUserCompany(cfg.userCompany ?? '')
      if (cfg.userRole)           { setUserRole(cfg.userRole); setSettingsRoleDraft(cfg.userRole) }
      if (cfg.audioFormat)        setSettingsAudioFormatDraft(cfg.audioFormat as 'mp3' | 'wav')
      if (cfg.recordingQuality)   setSettingsRecordingQualityDraft(cfg.recordingQuality)
      if (cfg.chunkDuration)      setSettingsChunkDurationDraft(cfg.chunkDuration)
      if (cfg.language)           setSettingsLanguageDraft(cfg.language)
      if (cfg.dateFormat)         setSettingsDateFormatDraft(cfg.dateFormat)
      if (cfg.autoSave !== undefined) { setSettingsAutoSaveDraft(cfg.autoSave); setAutoSave(cfg.autoSave) }
      if (cfg.autoTranscribe !== undefined) setAutoTranscribe(cfg.autoTranscribe)
      setConfigLoaded(true)
    })
  }, [])

  // ── Show onboarding if no API key ──────────────────────────────────────
  useEffect(() => {
    if (!configLoaded) return
    const done = localStorage.getItem(ONBOARDING_KEY)
    if (!done && !groqApiKey) setShowOnboarding(true)
  }, [configLoaded, groqApiKey])

  // (data loaded from Supabase via the auth effect above)

  // ── Load user photo ────────────────────────────────────────────────────
  useEffect(() => { const p = localStorage.getItem('ct-user-photo'); if (p) setUserPhoto(p) }, [])

  // ── Auto-clear pending delete ──────────────────────────────────────────
  useEffect(() => {
    if (!pendingDeleteId) return
    const t = setTimeout(() => setPendingDeleteId(null), 3000)
    return () => clearTimeout(t)
  }, [pendingDeleteId])

  // ── Auto-select interview ──────────────────────────────────────────────
  useEffect(() => {
    if (!activeCandidateId) { setSelectedInterviewId(null); return }
    if (selectedInterviewId && candidateInterviews.some(i => i.id === selectedInterviewId)) return
    const first = candidateInterviews[0]?.id ?? null
    setSelectedInterviewId(first)
  }, [candidateInterviews, activeCandidateId, selectedInterviewId])

  // ── Sync transcript draft ──────────────────────────────────────────────
  useEffect(() => { setTranscriptDraft(selectedInterview?.transcriptEdited ?? '') }, [selectedInterviewId, selectedInterview])

  // ── Auto-save transcript ───────────────────────────────────────────────
  useEffect(() => {
    if (!autoSave || !selectedInterviewId) return
    const t = setTimeout(() => {
      updateInterview(selectedInterviewId, { transcriptEdited: transcriptDraft, transcriptUpdatedAt: new Date().toISOString() })
    }, 2000)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptDraft, autoSave])

  // ── Sync playback rate to active audio element ─────────────────────────
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = playbackRate }, [playbackRate])

  // ── Ctrl+K → open global search ──────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setScreen('search')
        setTimeout(() => document.getElementById('global-search-input')?.focus(), 50)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Recording keyboard shortcuts ─────────────────────────────────────────
  // Space → pause / resume   |   Escape → stop
  useEffect(() => {
    if (!activeRecordingInterview) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (activeRecordingInterview.status === 'recording') {
          mediaRecorderRef.current?.pause()
          systemRecorderRef.current?.pause() // en lockstep: mantiene alineadas las marcas de tiempo de ambas pistas
          updateInterview(activeRecordingInterview.id, { status: 'paused' })
        } else if (activeRecordingInterview.status === 'paused') {
          mediaRecorderRef.current?.resume()
          systemRecorderRef.current?.resume()
          updateInterview(activeRecordingInterview.id, { status: 'recording' })
        }
      } else if (e.code === 'Escape') {
        e.preventDefault()
        handleStopRecording()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRecordingInterview?.id, activeRecordingInterview?.status])

  // ── Recording timer ────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeRecordingInterview || activeRecordingInterview.status !== 'recording') return
    const id = window.setInterval(() => setInterviews(c => c.map(i => i.id === activeRecordingInterview.id ? { ...i, durationSec: i.durationSec + 1 } : i)), 1000)
    return () => window.clearInterval(id)
  }, [activeRecordingInterview?.id, activeRecordingInterview?.status])

  // ── Live video preview (PiP) ───────────────────────────────────────────
  useEffect(() => {
    if (pipVideoRef.current) pipVideoRef.current.srcObject = livePreviewStream
  }, [livePreviewStream])

  // ── Screen/window picker (Electron getDisplayMedia) ────────────────────
  useEffect(() => {
    window.desktopApp?.onCaptureSources?.(sources => setCaptureSources(sources))
  }, [])

  const pickCaptureSource = (sourceId: string | null) => {
    setCaptureSources(null)
    void window.desktopApp?.pickCaptureSource(sourceId)
  }

  // ── Audio devices ──────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        probe.getTracks().forEach(t => t.stop())
        const devs = await navigator.mediaDevices.enumerateDevices()
        const mics = devs.filter(d => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, name: d.label || `Micrófono ${i + 1}` }))
        const outs = devs.filter(d => d.kind === 'audiooutput').map((d, i) => ({ id: d.deviceId, name: d.label || `Salida ${i + 1}` }))
        setMicDevices(mics)
        setOutputDevices(outs)
        const savedMic = localStorage.getItem('ct-default-mic') ?? ''
        const savedOut = localStorage.getItem('ct-default-output') ?? ''
        const savedSystem = localStorage.getItem('ct-default-system') === 'true'
        const savedRecordVideo = localStorage.getItem('ct-default-record-video') === 'true'
        const savedVideoQuality = (localStorage.getItem('ct-default-video-quality') as '720p' | '1080p') || '1080p'
        const resolvedMic = savedMic && mics.some(m => m.id === savedMic) ? savedMic : mics[0]?.id ?? ''
        const resolvedOut = savedOut && outs.some(o => o.id === savedOut) ? savedOut : outs[0]?.id ?? ''
        setDefaultMicDeviceId(resolvedMic)
        setDefaultOutputDeviceId(resolvedOut)
        setDefaultCaptureSystem(savedSystem)
        setDefaultRecordVideo(savedRecordVideo)
        setDefaultVideoQuality(savedVideoQuality)
        setSettingsDefaultMicDraft(resolvedMic)
        setSettingsDefaultOutputDraft(resolvedOut)
        setSettingsDefaultSystemDraft(savedSystem)
        setSettingsRecordVideoDraft(savedRecordVideo)
        setSettingsVideoQualityDraft(savedVideoQuality)
      } catch { setRecordingMessage('No se pudieron cargar dispositivos de audio.') }
    }
    void load()
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────
  const updateInterview = useCallback((id: string, patch: Partial<Interview>) => {
    setInterviews(c => c.map(i => i.id === id ? { ...i, ...patch } : i))
    if (session) {
      supabase.from('interviews').update(ivPatchToDb(patch)).eq('id', id)
        .then(({ error }) => {
          if (error) console.error('Supabase update error:', error.message, error.details)
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id])

  const cleanupRecording = () => {
    mediaRecorderRef.current = null
    videoMediaRecorderRef.current = null
    systemRecorderRef.current = null
    micStreamRef.current?.getTracks().forEach(t => t.stop())
    systemStreamRef.current?.getTracks().forEach(t => t.stop())
    mixedStreamRef.current?.getTracks().forEach(t => t.stop())
    micStreamRef.current = systemStreamRef.current = mixedStreamRef.current = null
    if (audioContextRef.current) { void audioContextRef.current.close(); audioContextRef.current = null }
    setLivePreviewStream(null); setCaptureWindowLabel('')
  }

  // ── Recording ──────────────────────────────────────────────────────────
  const handleStartRecording = async (interviewOverride?: Interview, captureSystem = false, recordVideo = false) => {
    const iv = interviewOverride ?? selectedInterview
    if (!iv?.micDeviceId) { setRecordingMessage('Selecciona un micrófono antes de grabar.'); return }
    const ivCandidate = candidates.find(c => c.id === iv.candidateId)
    if (ivCandidate && !ivCandidate.consentGiven) {
      const proceed = window.confirm(`${ivCandidate.name || 'Este candidato'} no tiene registrado el consentimiento para grabar la entrevista.\n\nGrabar sin el consentimiento informado del candidato puede incumplir el RGPD. Asegúrate de haberlo obtenido (puedes marcarlo en el perfil).\n\n¿Continuar de todas formas?`)
      if (!proceed) return
    }
    try {
      setRecordingMessage('Solicitando permisos...')
      chunkRef.current = []
      videoChunkRef.current = []
      systemChunkRef.current = []
      // echoCancellation es clave cuando se graba sin auriculares: sin ella, la voz
      // del interlocutor que sale por los altavoces se "filtra" de vuelta al micro,
      // y esa fuga acaba etiquetada como [Entrevistador] al mezclarse con tu voz.
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: iv.micDeviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      micStreamRef.current = micStream
      let sysStream: MediaStream | null = null
      if (captureSystem) {
        await window.desktopApp?.setCaptureMode?.(recordVideo)
        try {
          sysStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
          systemStreamRef.current = sysStream
        } catch (err) {
          console.error('No se pudo capturar audio/vídeo de sistema:', err)
        }
      }
      const hasSystemAudio = !!sysStream?.getAudioTracks().length
      const videoTrack = sysStream?.getVideoTracks()[0] ?? null

      if (captureSystem && !hasSystemAudio && !recordVideo) {
        // Aviso inmediato (no esperar a ver el resultado en la transcripción):
        // se sigue grabando solo con el micrófono, pero David tiene que saberlo YA.
        toast('No se capturó el audio del interlocutor: solo se grabará tu micrófono', 'error')
      }

      if (recordVideo && !videoTrack) {
        // El usuario canceló el selector de pantalla (o no eligió nada) en modo
        // "Llamada entera". Sin pantalla no hay vídeo que grabar, así que abortamos
        // del todo en vez de caer en una grabación de solo audio no pedida.
        micStream.getTracks().forEach(t => t.stop())
        sysStream?.getTracks().forEach(t => t.stop())
        setRecordingMessage('Grabación cancelada.')
        setInterviews(c => c.filter(i => i.id !== iv.id))
        if (session) await supabase.from('interviews').delete().eq('id', iv.id)
        return
      }

      const qualityBitsPerSecond = ({ high: 128000, medium: 64000, low: 32000 } as Record<string, number>)[settingsRecordingQualityDraft] ?? 128000

      // Mic y sistema se MEZCLAN en una sola pista (sistema de antes del 10 de julio):
      // se graba y transcribe una única pista, y una IA adivina después quién dijo qué.
      // El intento de separar mic/sistema en pistas propias se descartó por duplicar
      // contenido entre pistas en llamadas reales — este es el sistema que sí funcionaba.
      const ctx = new AudioContext(); audioContextRef.current = ctx
      const dest = ctx.createMediaStreamDestination()
      ctx.createMediaStreamSource(micStream).connect(dest)
      if (hasSystemAudio) ctx.createMediaStreamSource(sysStream!).connect(dest)
      mixedStreamRef.current = dest.stream

      const recorder = new MediaRecorder(dest.stream, { audioBitsPerSecond: qualityBitsPerSecond })
      mediaRecorderRef.current = recorder
      activeInterviewIdRef.current = iv.id

      let videoRecorder: MediaRecorder | null = null
      if (recordVideo && videoTrack) {
        // El vídeo lleva la MISMA pista ya mezclada (mic + sistema), para que se oiga todo al reproducirlo.
        const videoWithAudioStream = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()])
        const videoBitsPerSecond = settingsVideoQualityDraft === '1080p' ? 4_000_000 : 2_000_000
        try {
          videoRecorder = new MediaRecorder(videoWithAudioStream, { mimeType: 'video/webm', videoBitsPerSecond, audioBitsPerSecond: qualityBitsPerSecond })
          videoRecorder.ondataavailable = e => { if (e.data.size > 0) videoChunkRef.current.push(e.data) }
          videoMediaRecorderRef.current = videoRecorder
          videoRecorder.start(1000)
          setLivePreviewStream(videoWithAudioStream)
          setCaptureWindowLabel(videoTrack.label || 'pantalla compartida')
        } catch { videoRecorder = null }
      }

      // Segunda pista, SOLO el audio del sistema (voz del interlocutor sin tu micro).
      // No se reproduce nunca: sirve para transcribir por separado y etiquetar como
      // [Candidato] de forma determinista. La mezcla (arriba) sigue intacta para
      // reproducción y vídeo — esto es puramente aditivo.
      let systemRecorder: MediaRecorder | null = null
      if (hasSystemAudio) {
        try {
          const sysAudioStream = new MediaStream(sysStream!.getAudioTracks())
          systemRecorder = new MediaRecorder(sysAudioStream, { audioBitsPerSecond: qualityBitsPerSecond })
          systemRecorder.ondataavailable = e => { if (e.data.size > 0) systemChunkRef.current.push(e.data) }
          systemRecorderRef.current = systemRecorder
          systemRecorder.start(1000)
        } catch { systemRecorder = null; systemRecorderRef.current = null }
      }

      // Guarda a disco en cuanto la grabación para, SIN esperar a que el usuario
      // confirme el modal de nombre de sesión — así el audio sobrevive aunque la
      // app se cierre, casque, o el usuario descarte antes de confirmar (Bug #1).
      const persistRecordingToDisk = async () => {
        // OJO: los 2 blobs se leen y se "reservan" (refs a null) AQUÍ, síncronamente,
        // antes de cualquier await. Si se leyeran uno a uno justo antes de usarlos,
        // confirmar el modal rápido (handleConfirmSessionName) podría vaciar los refs
        // ANTES de llegar a leer el de vídeo — perdiéndolo por una carrera.
        const blob = pendingBlobRef.current
        const videoBlob = pendingVideoBlobRef.current
        const systemBlob = pendingSystemBlobRef.current
        pendingBlobRef.current = null; pendingVideoBlobRef.current = null; pendingSystemBlobRef.current = null

        // Si el usuario descarta la grabación MIENTRAS este guardado está en curso
        // (handleDiscardRecording marca iv.id en discardedInterviewIdsRef), no hay
        // ya ninguna entrevista en la lista donde enganchar la ruta del archivo —
        // en vez de dejarlo suelto en disco sin que nada lo referencie, se borra.
        if (blob && window.desktopApp?.saveRecording) {
          try {
            const bytes = new Uint8Array(await blob.arrayBuffer())
            const r = await window.desktopApp.saveRecording({ interviewId: iv.id, candidateName: ivCandidate?.name ?? 'candidata', createdAt: iv.createdAt, extension: getExt(pendingMimeTypeRef.current), format: settingsAudioFormatDraft, audioBytes: bytes })
            if (discardedInterviewIdsRef.current.has(iv.id)) {
              void window.desktopApp.deleteRecording?.({ filePath: r.filePath })
            } else {
              const fileName = r.filePath.split(/[\\/]/).pop() ?? r.filePath
              updateInterview(iv.id, { recordingFilePath: fileName })
            }
          } catch { /* ignore */ }
        }

        if (videoBlob && window.desktopApp?.saveVideoRecording) {
          try {
            const videoBytes = new Uint8Array(await videoBlob.arrayBuffer())
            const vr = await window.desktopApp.saveVideoRecording({ interviewId: iv.id, candidateName: ivCandidate?.name ?? 'candidata', createdAt: iv.createdAt, videoBytes })
            if (discardedInterviewIdsRef.current.has(iv.id)) {
              void window.desktopApp.deleteRecording?.({ filePath: vr.filePath })
            } else {
              const videoFileName = vr.filePath.split(/[\\/]/).pop() ?? vr.filePath
              updateInterview(iv.id, { videoFilePath: videoFileName })
              saveVideoPathCache(iv.id, videoFileName)
            }
          } catch { /* ignore */ }
        }

        if (systemBlob && window.desktopApp?.saveSystemRecording) {
          try {
            const systemBytes = new Uint8Array(await systemBlob.arrayBuffer())
            const sr = await window.desktopApp.saveSystemRecording({ interviewId: iv.id, candidateName: ivCandidate?.name ?? 'candidata', createdAt: iv.createdAt, extension: getExt(pendingSystemMimeRef.current), audioBytes: systemBytes })
            if (discardedInterviewIdsRef.current.has(iv.id)) {
              void window.desktopApp.deleteRecording?.({ filePath: sr.filePath })
            } else {
              const systemFileName = sr.filePath.split(/[\\/]/).pop() ?? sr.filePath
              updateInterview(iv.id, { systemAudioFilePath: systemFileName })
              saveSystemAudioPathCache(iv.id, systemFileName)
            }
          } catch { /* ignore */ }
        }

        const wasDiscarded = discardedInterviewIdsRef.current.has(iv.id)
        discardedInterviewIdsRef.current.delete(iv.id)
        if (!wasDiscarded && autoTranscribe) void handleTranscribe(iv.id)
      }

      recorder.ondataavailable = e => { if (e.data.size > 0) chunkRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunkRef.current, { type: recorder.mimeType })
        const src = hasSystemAudio ? 'mic+system' : 'mic'
        pendingBlobRef.current = blob; pendingMimeTypeRef.current = recorder.mimeType
        if (activeInterviewIdRef.current) updateInterview(activeInterviewIdRef.current, { status: 'stopped', captureSource: src })

        // El vídeo y la pista de sistema son grabadores aparte y opcionales; hay que
        // esperar a que AMBOS terminen de volcar su blob antes de persistir a disco.
        const vr = videoMediaRecorderRef.current
        const sr = systemRecorderRef.current
        let pending = 0
        const done = () => { if (--pending <= 0) { cleanupRecording(); void persistRecordingToDisk() } }
        if (vr && vr.state !== 'inactive') { pending++; vr.onstop = () => { pendingVideoBlobRef.current = new Blob(videoChunkRef.current, { type: vr.mimeType }); done() } }
        if (sr && sr.state !== 'inactive') { pending++; sr.onstop = () => { pendingSystemBlobRef.current = new Blob(systemChunkRef.current, { type: sr.mimeType }); pendingSystemMimeRef.current = sr.mimeType; done() } }
        if (pending === 0) { cleanupRecording(); void persistRecordingToDisk() }
        else {
          if (vr && vr.state !== 'inactive') vr.stop()
          if (sr && sr.state !== 'inactive') sr.stop()
        }
        setSessionNameDraft(''); setShowSessionNameModal(true)
      }
      recorder.start(1000)
      updateInterview(iv.id, { status: 'recording', captureSource: hasSystemAudio ? 'mic+system' : 'mic' })
      setRecordingMessage(hasSystemAudio ? 'Grabando micrófono + sistema.' : 'Grabando solo micrófono.')
    } catch { setRecordingMessage('No se pudo iniciar la grabación.'); cleanupRecording() }
  }

  const handleNewRecording = () => {
    if (!activeCandidateId || !activeCandidate) return
    setPendingMicId(defaultMicDeviceId || micDevices[0]?.id || '')
    setPendingOutputId(defaultOutputDeviceId || outputDevices[0]?.id || '')
    setPendingRecordVideo(defaultRecordVideo)
    setShowAudioSetupModal(true)
  }

  const handleImportAudio = async () => {
    if (!activeCandidateId || !activeCandidate || !window.desktopApp?.selectAudioFile) return
    const filePath = await window.desktopApp.selectAudioFile()
    if (!filePath) return
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath
    const defaultName = `Importada ${new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    const n: Interview = {
      id: uid(), candidateId: activeCandidateId, createdAt: new Date().toISOString(),
      sessionName: defaultName, status: 'stopped', durationSec: 0,
      micDeviceId: '', outputDeviceId: '',
      transcriptOriginal: '', transcriptEdited: '', transcriptUpdatedAt: null,
      recordingUrl: null, recordingFilePath: filePath, videoFilePath: null, systemAudioFilePath: null,
      captureSource: 'none', transcriptionStatus: 'pending',
      summaryInstructions: '', summaryText: '', summaryStatus: 'idle', summaryType: 'resumen',
    }
    setInterviews(c => [n, ...c])
    setSelectedInterviewId(n.id)
    if (session) {
      supabase.from('interviews').insert({ id: n.id, user_id: session.user.id, candidate_id: n.candidateId, project_id: activeCandidate.projectId, session_name: n.sessionName, status: n.status, duration_sec: 0, mic_device_id: '', output_device_id: '', transcript_original: '', transcript_edited: '', transcript_updated_at: null, recording_url: null, recording_file_path: fileName, capture_source: 'none', transcription_status: 'pending', summary_instructions: '', summary_text: '', summary_status: 'idle', summary_type: 'resumen', created_at: n.createdAt, updated_at: n.createdAt })
        .then(({ error }) => { if (error) toast(`Error al guardar importación en la nube: ${error.message}`, 'error') })
    }
    toast(`Audio importado: ${fileName}`)
    if (autoTranscribe) void handleTranscribe(n.id)
  }

  const handleConfirmRecordingSetup = () => {
    if (!activeCandidateId || !activeCandidate || !pendingMicId) return
    setShowAudioSetupModal(false)
    const n: Interview = { id: uid(), candidateId: activeCandidateId, createdAt: new Date().toISOString(), sessionName: '', status: 'idle', durationSec: 0, micDeviceId: pendingMicId, outputDeviceId: pendingOutputId, transcriptOriginal: '', transcriptEdited: '', transcriptUpdatedAt: null, recordingUrl: null, recordingFilePath: null, videoFilePath: null, systemAudioFilePath: null, captureSource: 'none', transcriptionStatus: 'pending', summaryInstructions: '', summaryText: '', summaryStatus: 'idle', summaryType: 'resumen' }
    setInterviews(c => [n, ...c])
    if (session) {
      supabase.from('interviews').insert({ id: n.id, user_id: session.user.id, candidate_id: n.candidateId, project_id: activeCandidate.projectId, session_name: '', status: n.status, duration_sec: 0, mic_device_id: n.micDeviceId, output_device_id: n.outputDeviceId, transcript_original: '', transcript_edited: '', transcript_updated_at: null, recording_url: null, recording_file_path: null, capture_source: n.captureSource, transcription_status: n.transcriptionStatus, summary_instructions: '', summary_text: '', summary_status: n.summaryStatus, summary_type: n.summaryType, created_at: n.createdAt, updated_at: n.createdAt })
        .then(({ error }) => { if (error) toast(`Error al crear entrevista en la nube: ${error.message}`, 'error') })
    }
    setSelectedInterviewId(n.id)
    void handleStartRecording(n, true, pendingRecordVideo)
  }

  const handleDiscardRecording = async () => {
    const iId = activeInterviewIdRef.current
    pendingBlobRef.current = null; pendingVideoBlobRef.current = null; pendingSystemBlobRef.current = null
    activeInterviewIdRef.current = null
    setShowSessionNameModal(false)
    setDiscardConfirming(false)
    if (iId) {
      // Marca la entrevista como descartada: si persistRecordingToDisk todavía está
      // a mitad de guardar el vídeo/audio de sistema en este momento, al terminar
      // verá esta marca y borrará el archivo en vez de dejarlo huérfano en disco
      // (la entrevista ya no existe para poder engancharle la ruta).
      discardedInterviewIdsRef.current.add(iId)
      // El audio (y vídeo/sistema, si los hay) ya se guardaron a disco al parar
      // la grabación (persistRecordingToDisk), así que hay que borrarlos explícitamente.
      const interview = interviews.find(i => i.id === iId)
      if (interview?.recordingFilePath && window.desktopApp?.deleteRecording) { const fp = resolveAudioPath(interview.recordingFilePath); if (fp) void window.desktopApp.deleteRecording({ filePath: fp }) }
      if (interview?.videoFilePath && window.desktopApp?.deleteRecording) { const fp = resolveAudioPath(interview.videoFilePath); if (fp) void window.desktopApp.deleteRecording({ filePath: fp }) }
      if (interview?.systemAudioFilePath && window.desktopApp?.deleteRecording) { const fp = resolveAudioPath(interview.systemAudioFilePath); if (fp) void window.desktopApp.deleteRecording({ filePath: fp }) }
      saveVideoPathCache(iId, null)
      saveSystemAudioPathCache(iId, null)
      setInterviews(c => c.filter(i => i.id !== iId))
      if (session) await supabase.from('interviews').delete().eq('id', iId)
    }
    toast('Grabación descartada', 'info')
  }

  const handlePauseRecording = () => {
    if (!activeRecordingInterview) return
    mediaRecorderRef.current?.pause()
    systemRecorderRef.current?.pause() // en lockstep con la mezcla (ver nota en el atajo de Espacio)
    updateInterview(activeRecordingInterview.id, { status: 'paused' })
  }

  const handleResumeRecording = () => {
    if (!activeRecordingInterview) return
    mediaRecorderRef.current?.resume()
    systemRecorderRef.current?.resume()
    updateInterview(activeRecordingInterview.id, { status: 'recording' })
  }

  const handleStopRecording = () => {
    if (!activeRecordingInterview) return
    const r = mediaRecorderRef.current; if (!r) return
    const sr = systemRecorderRef.current
    if (r.state === 'paused') r.resume()
    if (sr && sr.state === 'paused') sr.resume()
    r.stop()
    // No paramos aquí la pista de sistema: recorder.onstop la detiene y espera su blob.
  }

  // El audio/vídeo se guarda a disco en segundo plano en cuanto paró la grabación
  // (ver persistRecordingToDisk en handleStartRecording), en paralelo a que se
  // muestre este modal — puede que aún no haya terminado cuando el usuario confirma.
  // Por eso aquí NO se tocan pendingBlobRef/pendingVideoBlobRef: hacerlo antes de
  // que persistRecordingToDisk los lea provocaba perder el vídeo si se confirmaba
  // el nombre demasiado rápido.
  const handleConfirmSessionName = () => {
    const iId = activeInterviewIdRef.current
    if (!iId) return
    const blob = pendingBlobRef.current
    const defaultName = `Entrevista ${new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    const finalName = sessionNameDraft.trim() || defaultName
    setShowSessionNameModal(false); setDiscardConfirming(false)
    updateInterview(iId, { sessionName: finalName, ...(blob ? { recordingUrl: URL.createObjectURL(blob) } : {}) })
    activeInterviewIdRef.current = null
    toast('Grabación guardada')
  }

  // ── Transcription / Summary ────────────────────────────────────────────
  const handleTranscribe = async (interviewId: string, language?: string) => {
    const interview = interviews.find(i => i.id === interviewId)
    if (!interview?.recordingFilePath || !window.desktopApp?.transcribeAudio) return
    const fullPath = resolveAudioPath(interview.recordingFilePath)
    if (!fullPath) return
    // Pista solo-sistema (voz limpia del interlocutor), si esta grabación la tiene.
    // Su presencia activa la separación determinista de hablantes en el backend.
    const systemPath = interview.systemAudioFilePath ? resolveAudioPath(interview.systemAudioFilePath) : null
    const candidateName = candidates.find(c => c.id === interview.candidateId)?.name ?? ''
    updateInterview(interviewId, { transcriptionStatus: 'transcribing' })
    try {
      const result = await window.desktopApp.transcribeAudio({ filePath: fullPath, systemFilePath: systemPath ?? undefined, language: language ?? txLang, candidateName })
      updateInterview(interviewId, { transcriptOriginal: result.text, transcriptEdited: result.text, transcriptionStatus: 'done' })
      if (selectedInterviewId === interviewId) setTranscriptDraft(result.text)
      if (notifTranscription) toast('Transcripción completada')
    } catch (err) {
      updateInterview(interviewId, { transcriptionStatus: 'error' })
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      if (notifErrors) toast('Error al transcribir', 'error', msg)
    }
  }

  const handleGenerateSummary = async (interviewId: string) => {
    const interview = interviews.find(i => i.id === interviewId)
    if (!interview || !window.desktopApp?.generateSummary) return
    const candidate = candidates.find(c => c.id === interview.candidateId)
    const project = candidate ? projects.find(p => p.id === candidate.projectId) : null
    const criteria = project?.evaluationCriteria ?? []
    updateInterview(interviewId, { summaryStatus: 'generating' })
    try {
      const result = await window.desktopApp.generateSummary({ transcript: interview.transcriptEdited, criteria, summaryType: interview.summaryType, candidateName: candidate?.name ?? '' })
      updateInterview(interviewId, { summaryText: result.text, summaryStatus: 'done' })
      if (notifSummary) toast('Resumen generado')
    } catch (err) {
      updateInterview(interviewId, { summaryStatus: 'error' })
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      if (notifErrors) toast('Error al generar resumen', 'error', msg)
    }
  }

  // ── Playback ───────────────────────────────────────────────────────────
  const stopAudio = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; audioRef.current = null }
    setPlayingInterviewId(null); setPlaybackProgress(0); setPlaybackCurrentTime(0); setPlaybackDuration(0)
  }

  const handleTogglePlayback = (interview: Interview) => {
    const resolved = resolveAudioPath(interview.recordingFilePath)
    const src = interview.recordingUrl ?? (resolved ? 'file:///' + resolved.replace(/\\/g, '/') : null)
    if (!src) return
    if (playingInterviewId === interview.id) { stopAudio(); return }
    stopAudio()
    const audio = new Audio(src); audio.playbackRate = playbackRate; audioRef.current = audio
    setPlaybackDuration(interview.durationSec > 0 ? interview.durationSec : 0)

    // Los archivos de MediaRecorder (webm/opus) reportan duration = Infinity hasta que se
    // "busca" hasta el final. Mientras sondeamos, no queremos actualizar el tiempo mostrado.
    let probing = false
    const applyDuration = () => { if (isFinite(audio.duration) && audio.duration > 0) setPlaybackDuration(audio.duration) }

    audio.ontimeupdate = () => {
      if (probing) return
      setPlaybackCurrentTime(audio.currentTime)
      const d = audio.duration
      if (isFinite(d) && d > 0) setPlaybackProgress(Math.min(audio.currentTime / d, 1))
    }
    audio.ondurationchange = applyDuration
    audio.onloadedmetadata = () => {
      if (isFinite(audio.duration) && audio.duration > 0) { applyDuration(); return }
      // Forzar el cálculo de la duración real con un seek al final, una sola vez.
      probing = true
      const onProbe = () => {
        audio.removeEventListener('timeupdate', onProbe)
        probing = false
        audio.currentTime = 0
        applyDuration()
      }
      audio.addEventListener('timeupdate', onProbe)
      audio.currentTime = 1e101
    }
    audio.onended = audio.onerror = () => { setPlayingInterviewId(null); setPlaybackProgress(0); setPlaybackCurrentTime(0); setPlaybackDuration(0) }
    void audio.play(); setPlayingInterviewId(interview.id)
  }

  // Busca (adelanta/atrasa) el audio en reproducción a un segundo concreto
  const handleSeek = (sec: number) => {
    const audio = audioRef.current
    if (!audio) return
    const total = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : playbackDuration
    const clamped = Math.max(0, total > 0 ? Math.min(sec, total) : sec)
    audio.currentTime = clamped
    setPlaybackCurrentTime(clamped)
    if (total > 0) setPlaybackProgress(Math.min(clamped / total, 1))
  }

  // Barra de tiempo/scrubber que aparece junto al play de la entrevista en reproducción.
  // full = ocupa todo el ancho de la tarjeta (para los paneles estrechos de transcripción/resumen)
  const renderSeekBar = (iv: Interview, full = false) => {
    if (playingInterviewId !== iv.id) return null
    const total = playbackDuration > 0 ? playbackDuration : iv.durationSec
    return (
      <div className={`seek-bar${full ? ' seek-bar--full' : ''}`} onClick={e => e.stopPropagation()}>
        <span className="seek-time">{fmt(Math.floor(playbackCurrentTime))}</span>
        <input
          type="range"
          className="seek-range"
          min={0}
          max={total > 0 ? total : 0}
          step={0.1}
          value={total > 0 ? Math.min(playbackCurrentTime, total) : 0}
          onChange={e => handleSeek(parseFloat(e.target.value))}
          title="Adelantar o atrasar el audio"
        />
        <span className="seek-time">{total > 0 ? fmt(Math.floor(total)) : '--:--'}</span>
      </div>
    )
  }

  // ── CRUD ───────────────────────────────────────────────────────────────
  const handleDeleteInterview = async (interviewId: string) => {
    if (pendingDeleteId !== interviewId) { setPendingDeleteId(interviewId); return }
    setPendingDeleteId(null); if (playingInterviewId === interviewId) stopAudio()
    const interview = interviews.find(i => i.id === interviewId)
    if (interview?.recordingFilePath && window.desktopApp?.deleteRecording) { const fp = resolveAudioPath(interview.recordingFilePath); if (fp) void window.desktopApp.deleteRecording({ filePath: fp }) }
    if (interview?.videoFilePath && window.desktopApp?.deleteRecording) { const fp = resolveAudioPath(interview.videoFilePath); if (fp) void window.desktopApp.deleteRecording({ filePath: fp }) }
    if (interview?.systemAudioFilePath && window.desktopApp?.deleteRecording) { const fp = resolveAudioPath(interview.systemAudioFilePath); if (fp) void window.desktopApp.deleteRecording({ filePath: fp }) }
    saveVideoPathCache(interviewId, null)
    saveSystemAudioPathCache(interviewId, null)
    setInterviews(c => c.filter(i => i.id !== interviewId))
    if (session) {
      const { error } = await supabase.from('interviews').delete().eq('id', interviewId)
      if (error) { toast(`Error eliminando entrevista: ${error.message}`, 'error'); return }
    }
    toast('Entrevista eliminada')
  }

  const handleDeleteCandidate = async (candidateId: string) => {
    if (pendingDeleteId !== candidateId) { setPendingDeleteId(candidateId); return }
    setPendingDeleteId(null)
    const candidateInterviewIds = interviews.filter(i => i.candidateId === candidateId)
    candidateInterviewIds.forEach(i => { if (i.recordingFilePath && window.desktopApp?.deleteRecording) { const fp = resolveAudioPath(i.recordingFilePath); if (fp) void window.desktopApp.deleteRecording({ filePath: fp }) }; if (i.videoFilePath && window.desktopApp?.deleteRecording) { const fp = resolveAudioPath(i.videoFilePath); if (fp) void window.desktopApp.deleteRecording({ filePath: fp }) }; if (i.systemAudioFilePath && window.desktopApp?.deleteRecording) { const fp = resolveAudioPath(i.systemAudioFilePath); if (fp) void window.desktopApp.deleteRecording({ filePath: fp }) }; saveVideoPathCache(i.id, null); saveSystemAudioPathCache(i.id, null) })
    setInterviews(c => c.filter(i => i.candidateId !== candidateId))
    setCandidates(c => c.filter(x => x.id !== candidateId))
    if (session) {
      if (candidateInterviewIds.length > 0) {
        await supabase.from('interviews').delete().eq('candidate_id', candidateId)
      }
      const { error } = await supabase.from('candidates').delete().eq('id', candidateId)
      if (error) { toast(`Error eliminando perfil: ${error.message}`, 'error'); return }
    }
    if (activeCandidateId === candidateId) { setActiveCandidateId(null); setScreen('project-detail') }
    toast('Perfil eliminado')
  }

  const handleDeleteProject = async (projectId: string) => {
    if (pendingDeleteId !== projectId) { setPendingDeleteId(projectId); return }
    setPendingDeleteId(null)
    const projCandidates = candidates.filter(c => c.projectId === projectId)
    const projInterviewIds = interviews.filter(i => projCandidates.some(c => c.id === i.candidateId))
    projInterviewIds.forEach(i => { if (i.recordingFilePath && window.desktopApp?.deleteRecording) void window.desktopApp.deleteRecording({ filePath: i.recordingFilePath }); if (i.videoFilePath && window.desktopApp?.deleteRecording) void window.desktopApp.deleteRecording({ filePath: i.videoFilePath }); if (i.systemAudioFilePath && window.desktopApp?.deleteRecording) void window.desktopApp.deleteRecording({ filePath: i.systemAudioFilePath }); saveVideoPathCache(i.id, null); saveSystemAudioPathCache(i.id, null) })
    setInterviews(c => c.filter(i => !projCandidates.some(pc => pc.id === i.candidateId)))
    setCandidates(c => c.filter(x => x.projectId !== projectId))
    setProjects(c => c.filter(p => p.id !== projectId))
    if (activeProjectId === projectId) { setActiveProjectId(null); setScreen('projects') }
    if (session) {
      await supabase.from('projects').delete().eq('id', projectId)
    }
    toast('Proyecto eliminado')
  }

  const handleCreateCandidate = async () => {
    if (!candidateDraft.name.trim() || !activeProjectId) return
    const consentAt = candidateConsentDraft ? new Date().toISOString() : null
    const c: Candidate = { id: uid(), projectId: activeProjectId, name: candidateDraft.name.trim(), email: candidateDraft.email.trim(), phone: candidateDraft.phone.trim(), role: candidateDraft.role.trim(), notes: candidateNotesDraft, candidateStatus: candidateStatusDraft, consentGiven: candidateConsentDraft, consentAt }
    setCandidates(curr => [...curr, c])
    setShowNewCandidate(false); setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft(''); setCandidateStatusDraft('pendiente'); setCandidateConsentDraft(false)
    if (session) {
      const { error } = await supabase.from('candidates').insert({ id: c.id, user_id: session.user.id, project_id: c.projectId, name: c.name, email: c.email, phone: c.phone, role: c.role, notes: candidateNotesDraft, candidate_status: candidateStatusDraft, consent_given: c.consentGiven, consent_at: c.consentAt, created_at: new Date().toISOString() })
      if (error) { toast(`Error guardando perfil: ${error.message}`, 'error'); setCandidates(curr => curr.filter(x => x.id !== c.id)); return }
    }
    toast(`Perfil ${c.name} creado`)
  }

  const handleUpdateCandidate = () => {
    if (!editingCandidateId || !candidateDraft.name.trim()) return
    const prev = candidates.find(x => x.id === editingCandidateId)
    const consentAt = candidateConsentDraft ? (prev?.consentAt ?? new Date().toISOString()) : null
    setCandidates(c => c.map(x => x.id === editingCandidateId ? { ...x, name: candidateDraft.name.trim(), email: candidateDraft.email.trim(), phone: candidateDraft.phone.trim(), role: candidateDraft.role.trim(), notes: candidateNotesDraft, candidateStatus: candidateStatusDraft, consentGiven: candidateConsentDraft, consentAt } : x))
    if (session) supabase.from('candidates').update({ name: candidateDraft.name.trim(), email: candidateDraft.email.trim(), phone: candidateDraft.phone.trim(), role: candidateDraft.role.trim(), notes: candidateNotesDraft, candidate_status: candidateStatusDraft, consent_given: candidateConsentDraft, consent_at: consentAt }).eq('id', editingCandidateId)
      .then(({ error }) => { if (error) toast(`Error sincronizando perfil: ${error.message}`, 'error') }, () => {})
    setEditingCandidateId(null); setShowNewCandidate(false); setCandidateDraft(EMPTY_CANDIDATE); setCandidateConsentDraft(false); toast('Perfil actualizado')
  }

  const updateProject = (id: string, changes: Partial<Project>) => {
    setProjects(c => c.map(p => p.id === id ? { ...p, ...changes } : p))
    if (changes.evaluationCriteria !== undefined) saveCriteriaCache(id, changes.evaluationCriteria)
    if (session) {
      const db: Record<string, unknown> = {}
      if (changes.name               !== undefined) db.name                = changes.name
      if (changes.company            !== undefined) db.company             = changes.company
      if (changes.status             !== undefined) db.status              = changes.status
      if (changes.evaluationCriteria !== undefined) db.evaluation_criteria = changes.evaluationCriteria
      supabase.from('projects').update(db).eq('id', id)
        .then(({ error }) => { if (error) toast(`Error sincronizando proyecto: ${error.message}`, 'error') }, () => {})
    }
  }

  const handleCreateProject = async () => {
    if (!projectDraft.name.trim()) return
    const p: Project = { id: uid(), name: projectDraft.name.trim(), company: projectDraft.company.trim(), createdAt: new Date().toISOString(), status: projectDraft.status, evaluationCriteria: projectDraft.evaluationCriteria }
    setProjects(c => [...c, p])
    setShowNewProject(false); setProjectDraft(EMPTY_PROJECT)
    if (session) {
      const { error } = await supabase.from('projects').insert({ id: p.id, user_id: session.user.id, name: p.name, company: p.company, status: p.status, evaluation_criteria: p.evaluationCriteria, created_at: p.createdAt })
      if (error) { toast(`Error guardando proyecto: ${error.message}`, 'error'); setProjects(c => c.filter(x => x.id !== p.id)); return }
    }
    toast(`Proyecto ${p.name} creado`)
  }

  const handleSaveEditProject = () => {
    if (!editingProjectId || !projectDraft.name.trim()) return
    updateProject(editingProjectId, { name: projectDraft.name.trim(), company: projectDraft.company.trim(), status: projectDraft.status, evaluationCriteria: projectDraft.evaluationCriteria })
    setShowEditProject(false); setEditingProjectId(null); setProjectDraft(EMPTY_PROJECT)
    toast('Proyecto actualizado')
  }

  const handleSaveSettings = async () => {
    if (window.desktopApp?.saveConfig) await window.desktopApp.saveConfig({
      groqApiKey: settingsKeyDraft, transcriptionModel: settingsTxModelDraft, summaryModel: settingsSumModelDraft,
      userName: settingsNameDraft, userEmail: settingsEmailDraft, userCompany: settingsCompanyDraft,
      userRole: settingsRoleDraft, audioFormat: settingsAudioFormatDraft, recordingQuality: settingsRecordingQualityDraft,
      chunkDuration: settingsChunkDurationDraft, language: settingsLanguageDraft, dateFormat: settingsDateFormatDraft,
      autoSave: settingsAutoSaveDraft, autoTranscribe,
    })
    setGroqApiKey(settingsKeyDraft); setTranscriptionModel(settingsTxModelDraft); setSummaryModel(settingsSumModelDraft)
    setUserName(settingsNameDraft); setUserEmail(settingsEmailDraft); setUserCompany(settingsCompanyDraft)
    setUserRole(settingsRoleDraft); setAutoSave(settingsAutoSaveDraft)
    localStorage.setItem('ct-default-mic', settingsDefaultMicDraft)
    localStorage.setItem('ct-default-output', settingsDefaultOutputDraft)
    localStorage.setItem('ct-default-system', String(settingsDefaultSystemDraft))
    localStorage.setItem('ct-default-record-video', String(settingsRecordVideoDraft))
    localStorage.setItem('ct-default-video-quality', settingsVideoQualityDraft)
    setDefaultMicDeviceId(settingsDefaultMicDraft); setDefaultOutputDeviceId(settingsDefaultOutputDraft); setDefaultCaptureSystem(settingsDefaultSystemDraft)
    setDefaultRecordVideo(settingsRecordVideoDraft); setDefaultVideoQuality(settingsVideoQualityDraft)
    // NOTE: la Groq API key NO se sincroniza a la nube por seguridad — vive solo en el config.json local.
    if (session) supabase.from('profiles').update({ name: settingsNameDraft, email: settingsEmailDraft, company: settingsCompanyDraft, tx_model: settingsTxModelDraft, sum_model: settingsSumModelDraft, updated_at: new Date().toISOString() }).eq('id', session.user.id).then(() => {}, () => {})
    toast('Configuración guardada')
  }

  const openSettings = (tab: SettingsTab = 'api-keys') => {
    setSettingsKeyDraft(groqApiKey); setSettingsTxModelDraft(transcriptionModel); setSettingsSumModelDraft(summaryModel)
    setSettingsNameDraft(userName); setSettingsEmailDraft(userEmail); setSettingsCompanyDraft(userCompany)
    setSettingsRoleDraft(userRole)
    setSettingsDefaultMicDraft(defaultMicDeviceId); setSettingsDefaultOutputDraft(defaultOutputDeviceId); setSettingsDefaultSystemDraft(defaultCaptureSystem)
    setSettingsRecordVideoDraft(defaultRecordVideo); setSettingsVideoQualityDraft(defaultVideoQuality)
    setSettingsTab(tab); setScreen('settings')
  }

  const goToProject = (projectId: string) => { setActiveProjectId(projectId); setSearchQuery(''); setScreen('project-detail') }
  const goToCandidate = (candidateId: string, projectId?: string) => {
    if (projectId) setActiveProjectId(projectId)
    setActiveCandidateId(candidateId); setActiveTab('entrevistas'); setScreen('candidate-detail')
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setUserPhoto(dataUrl)
      localStorage.setItem('ct-user-photo', dataUrl)
      if (session) supabase.from('profiles').update({ photo: dataUrl, updated_at: new Date().toISOString() }).eq('id', session.user.id).then(() => {}, () => {})
      toast('Foto de perfil actualizada', 'success')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleOnboardingSave = async () => {
    if (!onboardingKeyDraft.trim()) return
    if (window.desktopApp?.saveConfig) await window.desktopApp.saveConfig({ groqApiKey: onboardingKeyDraft.trim(), transcriptionModel, summaryModel, userName, userEmail, userCompany })
    setGroqApiKey(onboardingKeyDraft.trim()); setShowOnboarding(false)
    localStorage.setItem(ONBOARDING_KEY, '1')
    toast('API Key guardada — ¡todo listo!')
  }

  // ── Breadcrumb ─────────────────────────────────────────────────────────
  const breadcrumb = useMemo(() => {
    if (screen === 'dashboard') return [{ label: 'Inicio' }]
    if (screen === 'projects') return [{ label: 'Inicio', action: () => setScreen('dashboard') }, { label: 'Proyectos' }]
    if (screen === 'project-detail' && activeProject) return [{ label: 'Inicio', action: () => setScreen('dashboard') }, { label: 'Proyectos', action: () => setScreen('projects') }, { label: activeProject.name }]
    if (screen === 'candidate-detail' && activeProject && activeCandidate) return [{ label: 'Inicio', action: () => setScreen('dashboard') }, { label: activeProject.name, action: () => goToProject(activeProject.id) }, { label: activeCandidate.name }]
    if (screen === 'candidates') return [{ label: 'Inicio', action: () => setScreen('dashboard') }, { label: 'Perfiles' }]
    if (screen === 'settings') return [{ label: 'Inicio', action: () => setScreen('dashboard') }, { label: 'Configuración' }]
    if (screen === 'profile') return [{ label: 'Inicio', action: () => setScreen('dashboard') }, { label: 'Mi Perfil' }]
    if (screen === 'search') return [{ label: 'Inicio', action: () => setScreen('dashboard') }, { label: 'Buscar' }]
    return []
  }, [screen, activeProject, activeCandidate])

  const resolveAudioPath = useCallback((stored: string | null): string | null => {
    if (!stored) return null
    if (stored.includes('/') || stored.includes('\\')) return stored // legacy absolute path
    return recordingsDir ? `${recordingsDir}\\${stored}` : stored
  }, [recordingsDir])

  const resolveVideoUrl = useCallback((stored: string | null): string | null => {
    const resolved = resolveAudioPath(stored)
    return resolved ? 'file:///' + resolved.replace(/\\/g, '/') : null
  }, [resolveAudioPath])

  const activeDateLocale = useMemo(() => {
    if (settingsDateFormatDraft === 'MM/DD/YYYY') return 'en-US'
    if (settingsDateFormatDraft === 'YYYY-MM-DD') return 'sv-SE'
    return 'es-ES'
  }, [settingsDateFormatDraft])

  const fd = useCallback((iso: string) => fmtDate(iso, activeDateLocale), [activeDateLocale])
  const fs = useCallback((iso: string) => fmtShort(iso, activeDateLocale), [activeDateLocale])

  const userInitials = initials(userName || userEmail || 'U')

  // ════════════════════════════════════════════════════════ RENDER ══════

  const renderSearch = () => {
    const q = globalSearchQuery.trim().toLowerCase()
    const results = q.length < 2 ? [] : interviews
      .filter(i => i.transcriptEdited?.toLowerCase().includes(q) || i.transcriptOriginal?.toLowerCase().includes(q) || i.summaryText?.toLowerCase().includes(q))
      .map(i => {
        const cand = candidates.find(c => c.id === i.candidateId)
        const proj = projects.find(p => p.id === cand?.projectId)
        const text = i.transcriptEdited || i.transcriptOriginal || i.summaryText || ''
        const idx = text.toLowerCase().indexOf(q)
        const start = Math.max(0, idx - 80)
        const end = Math.min(text.length, idx + q.length + 80)
        const excerpt = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
        const matchCount = (text.toLowerCase().match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
        return { interview: i, cand, proj, excerpt, matchCount, idx: idx - start }
      })
      .sort((a, b) => b.matchCount - a.matchCount)

    const highlight = (text: string, matchStart: number) => {
      if (matchStart < 0) return <>{text}</>
      return <>{text.slice(0, matchStart)}<mark className="gs-mark">{text.slice(matchStart, matchStart + q.length)}</mark>{text.slice(matchStart + q.length)}</>
    }

    return (
      <div className="screen-content">
        <div className="gs-header">
          <div className="gs-input-wrap">
            <SearchIcon />
            <input
              id="global-search-input"
              type="text"
              className="gs-input"
              placeholder="Buscar en transcripciones y resúmenes… (Ctrl+K)"
              value={globalSearchQuery}
              onChange={e => setGlobalSearchQuery(e.target.value)}
              autoFocus
            />
            {globalSearchQuery && <button type="button" className="gs-clear" onClick={() => setGlobalSearchQuery('')}>✕</button>}
          </div>
          {q.length >= 2 && <p className="gs-count">{results.length} {results.length === 1 ? 'resultado' : 'resultados'}</p>}
        </div>

        {q.length < 2 ? (
          <EmptyState icon={<SearchIcon />} title="Busca en tus entrevistas" sub="Escribe al menos 2 caracteres para buscar en todas las transcripciones y resúmenes." />
        ) : results.length === 0 ? (
          <EmptyState title="Sin resultados" sub={`No se encontró "${globalSearchQuery}" en ninguna transcripción.`} />
        ) : (
          <div className="gs-results">
            {results.map(({ interview: iv, cand, proj, excerpt, matchCount, idx }) => (
              <div key={iv.id} className="gs-result-card" onClick={() => { if (cand) { goToCandidate(cand.id, proj?.id); setSelectedInterviewId(iv.id); setActiveTab(iv.summaryText?.toLowerCase().includes(q) && !iv.transcriptEdited?.toLowerCase().includes(q) ? 'resumen' : 'transcripcion') } }}>
                <div className="gs-result-meta">
                  <span className="gs-result-name">{cand?.name ?? '—'}</span>
                  {proj && <span className="gs-result-proj">{proj.name}</span>}
                  <span className="gs-result-session">{iv.sessionName || fs(iv.createdAt)}</span>
                  <span className="gs-result-count">{matchCount} {matchCount === 1 ? 'coincidencia' : 'coincidencias'}</span>
                </div>
                <p className="gs-result-excerpt">{highlight(excerpt, idx)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderDashboard = () => {
    const recent = [...interviews]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3)

    const filteredProjects = projects.filter(p => {
      const matchFilter = p.status === dashFilter
      const matchSearch = !dashSearch.trim() ||
        p.name.toLowerCase().includes(dashSearch.toLowerCase()) ||
        p.company.toLowerCase().includes(dashSearch.toLowerCase())
      return matchFilter && matchSearch
    })

    return (
      <div className="dash-layout">
        {/* ── Lista de proyectos ── */}
        <div className="dash-main">
          <div className="dash-projects-header">
            <h2 className="dash-projects-title">Mis Proyectos</h2>
            <button type="button" className="primary-btn pill-btn" onClick={() => setShowNewProject(true)}>
              Nuevo proyecto
</button>
          </div>

          <div className="dash-toolbar">
            <div className="dash-search">
              <span className="dash-search-icon"><SearchIcon /></span>
              <input
                type="text"
                placeholder="Buscar por proyecto o empresa..."
                value={dashSearch}
                onChange={e => setDashSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              className={`dash-filter-btn${dashFilter === 'active' ? ' dash-filter-btn--on' : ''}`}
              onClick={() => setDashFilter('active')}
            >Activos</button>
            <button
              type="button"
              className={`dash-filter-btn${dashFilter === 'closed' ? ' dash-filter-btn--on' : ''}`}
              onClick={() => setDashFilter('closed')}
            >Cerrados</button>
            <ViewToggle mode={projectsViewMode} onChange={setProjectsViewMode} />
          </div>

          <div className={`proj-list${projectsViewMode === 'grid' ? ' proj-list--grid' : ''}`} style={projectsViewMode === 'grid' ? { '--cols': Math.min(3, filteredProjects.length) } as React.CSSProperties : undefined}>
            {filteredProjects.length === 0 ? (
              projects.length === 0
                ? <EmptyState icon={<FolderIcon />} title="No tienes proyectos todavía" sub="Crea tu primer proyecto para empezar a gestionar perfiles" btnLabel="Nuevo proyecto" onBtn={() => setShowNewProject(true)} />
                : <EmptyState title="Sin resultados" sub="Prueba otro filtro o búsqueda." />
            ) : filteredProjects.map(p => {
              const cCnt = candidates.filter(c => c.projectId === p.id).length
              const iCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id).length
              const tCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id && i.transcriptionStatus === 'done').length
              const pCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id && i.transcriptionStatus === 'pending').length
              const isClosed = p.status === 'closed'
              return (
                <div key={p.id} className={`plc${isClosed ? ' plc--closed' : ''}`}>
                  <div className="plc-accent" />
                  <div className="plc-body">
                    <div className="plc-top">
                      <div className="plc-info">
                        <h3 className="plc-title">{p.name}</h3>
                        <p className="plc-meta">{p.company} · Creado {fs(p.createdAt)}</p>
                      </div>
                      <div className="plc-top-right">
                        <button type="button" className="plc-edit-btn" onClick={e => { e.stopPropagation(); setProjectDraft({ name: p.name, company: p.company, status: p.status, evaluationCriteria: p.evaluationCriteria }); setEditingProjectId(p.id); setShowEditProject(true) }}><PencilIcon /> Editar</button>
                        <span className={`plc-badge${isClosed ? ' plc-badge--closed' : ' plc-badge--active'}`}>
                          {isClosed ? <><SquareFilled /> Cerrado</> : <><DotFilled /> Activo</>}
                        </span>
                      </div>
                    </div>
                    <div className="plc-bottom">
                      <div className="plc-stats">
                        <div className="plc-stat"><span className="plc-stat-num">{cCnt}</span><span className="plc-stat-lbl">perfiles</span></div>
                        <div className="plc-stat"><span className="plc-stat-num">{iCnt}</span><span className="plc-stat-lbl">entrevistas</span></div>
                        <div className="plc-stat"><span className="plc-stat-num">{tCnt}</span><span className="plc-stat-lbl">transcritas</span></div>
                        <div className="plc-stat">
                          <span className={`plc-stat-num${!isClosed && pCnt > 0 ? ' plc-stat-num--pending' : ''}${isClosed ? ' plc-stat-num--dim' : ''}`}>{pCnt}</span>
                          <span className="plc-stat-lbl">pendientes</span>
                        </div>
                      </div>
                      <div className="plc-actions">
                        <button
                          type="button"
                          className={`plc-open-btn${isClosed ? ' plc-open-btn--closed' : ''}`}
                          onClick={() => goToProject(p.id)}
                        >
                          {isClosed ? 'Ver proyecto' : 'Abrir proyecto'}
                        </button>
                        <button
                          type="button"
                          className={`plc-status-btn${isClosed ? ' plc-status-btn--reopen' : ' plc-status-btn--close'}`}
                          onClick={() => updateProject(p.id, { status: isClosed ? 'active' : 'closed' })}
                        >
                          {isClosed ? 'Reabrir' : 'Cerrar'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Account panel ── */}
        <aside className="account-panel">
          <div className="ap-top-accent" />
          <div className="ap-user-section">
            <div className="ap-avatar" style={{ background: userPhoto ? 'transparent' : undefined, padding: 0, overflow: 'hidden' }}>
              {userPhoto ? <img src={userPhoto} alt="U" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : userInitials}
            </div>
            <h3 className="ap-name">{userName || 'Usuario'}</h3>
            <p className="ap-email">{userEmail}</p>
          </div>
          <div className="ap-divider" />
          <div className="ap-section">
            <h4>Resumen global</h4>
            <div className="ap-stats-grid">
              {([['Proyectos', stats.projects], ['Entrevistas', stats.interviews], ['Transcritas', stats.transcribed], ['Resúmenes IA', stats.summaries]] as [string, number][]).map(([l, v]) => (
                <div key={l} className="ap-stat-card">
                  <span className="ap-stat-num">{v}</span>
                  <span className="ap-stat-lbl">{l}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ap-divider" />
          <div className="ap-section">
            <h4>Acciones rápidas</h4>
            <button type="button" className="outline-btn pill-btn ap-action-btn" onClick={() => setScreen('candidates')}><UsersIcon /> Ver perfiles</button>
            <button type="button" className="outline-btn pill-btn ap-action-btn" onClick={() => { setExportCandidateId(null); setShowExport(true) }}><DownloadIcon /> Exportar informes</button>
          </div>
          <div className="ap-divider" />
          <div className="ap-section">
            <h4>Actividad reciente</h4>
            {recent.length === 0
              ? <p className="ap-empty">Sin actividad reciente.</p>
              : recent.map(i => {
                const cand = candidates.find(c => c.id === i.candidateId)
                return (
                  <div key={i.id} className="ap-activity-row" onClick={() => cand && goToCandidate(cand.id, cand.projectId)}>
                    <span>{i.summaryStatus === 'done' ? <DocIcon /> : <MicIcon />} {i.sessionName || 'Entrevista'} — {cand?.name ?? '—'}</span>
                  </div>
                )
              })
            }
          </div>
        </aside>
      </div>
    )
  }

  const renderProjects = () => {
    const isFiltered = !!projectSearchQuery.trim() || projectStatusFilter !== 'all'
    return (
      <div className="screen-content">
        <div className="content-header">
          <div><h2>Mis Proyectos</h2></div>
          <button type="button" className="primary-btn pill-btn" onClick={() => setShowNewProject(true)}>Nuevo proyecto</button>
        </div>
        <div className="proj-toolbar">
          <div className={`proj-search-bar${projectSearchQuery ? ' proj-search-bar--active' : ''}`}>
            <span className="proj-search-icon"><SearchIcon /></span>
            <input type="text" placeholder="Buscar proyectos..." value={projectSearchQuery} onChange={e => setProjectSearchQuery(e.target.value)} />
            {projectSearchQuery && <button type="button" className="proj-search-clear" onClick={() => setProjectSearchQuery('')}>✕</button>}
          </div>
          <div className="proj-filter-group">
            <button type="button" className={`proj-filter-btn${projectStatusFilter === 'active' ? ' is-active' : ''}`} onClick={() => setProjectStatusFilter(f => f === 'active' ? 'all' : 'active')}>Activos</button>
            <button type="button" className={`proj-filter-btn${projectStatusFilter === 'closed' ? ' is-active' : ''}`} onClick={() => setProjectStatusFilter(f => f === 'closed' ? 'all' : 'closed')}>Cerrados</button>
          </div>
          <ViewToggle mode={projectsViewMode} onChange={setProjectsViewMode} />
        </div>
        {isFiltered && <p className="proj-results-label">{filteredProjects.length} resultado{filteredProjects.length !== 1 ? 's' : ''}{projectSearchQuery.trim() ? ` para "${projectSearchQuery}"` : ''}</p>}
        {filteredProjects.length === 0 ? (
          isFiltered
            ? <EmptyState title="Sin resultados" sub="No hay proyectos que coincidan con los filtros aplicados." />
            : <EmptyState icon={<FolderIcon />} title="No tienes proyectos todavía" sub="Crea tu primer proyecto para empezar a gestionar perfiles" btnLabel="Nuevo proyecto" onBtn={() => setShowNewProject(true)} />
        ) : (
          <div className={`proj-list${projectsViewMode === 'grid' ? ' proj-list--grid' : ''}`} style={projectsViewMode === 'grid' ? { '--cols': Math.min(3, filteredProjects.length) } as React.CSSProperties : undefined}>
            {filteredProjects.map(p => {
              const cCnt = candidates.filter(c => c.projectId === p.id).length
              const iCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id).length
              const tCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id && i.transcriptionStatus === 'done').length
              const pCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id && i.transcriptionStatus === 'pending').length
              const isClosed = p.status === 'closed'
              return (
                <div key={p.id} className={`plc${isClosed ? ' plc--closed' : ''}`}>
                  <div className="plc-accent" />
                  <div className="plc-body">
                    <div className="plc-top">
                      <div className="plc-info">
                        <h3 className="plc-title">{p.name}</h3>
                        <p className="plc-meta">{p.company} · Creado {fs(p.createdAt)}</p>
                      </div>
                      <div className="plc-top-right">
                        <button type="button" className="plc-edit-btn" onClick={e => { e.stopPropagation(); setProjectDraft({ name: p.name, company: p.company, status: p.status, evaluationCriteria: p.evaluationCriteria }); setEditingProjectId(p.id); setShowEditProject(true) }}><PencilIcon /> Editar</button>
                        <span className={`plc-badge${isClosed ? ' plc-badge--closed' : ' plc-badge--active'}`}>
                          {isClosed ? <><SquareFilled /> Cerrado</> : <><DotFilled /> Activo</>}
                        </span>
                      </div>
                    </div>
                    <div className="plc-bottom">
                      <div className="plc-stats">
                        <div className="plc-stat"><span className="plc-stat-num">{cCnt}</span><span className="plc-stat-lbl">perfiles</span></div>
                        <div className="plc-stat"><span className="plc-stat-num">{iCnt}</span><span className="plc-stat-lbl">entrevistas</span></div>
                        <div className="plc-stat"><span className="plc-stat-num">{tCnt}</span><span className="plc-stat-lbl">transcritas</span></div>
                        <div className="plc-stat">
                          <span className={`plc-stat-num${!isClosed && pCnt > 0 ? ' plc-stat-num--pending' : ''}${isClosed ? ' plc-stat-num--dim' : ''}`}>{pCnt}</span>
                          <span className="plc-stat-lbl">pendientes</span>
                        </div>
                      </div>
                      <div className="plc-actions">
                        <button type="button" className={`plc-open-btn${isClosed ? ' plc-open-btn--closed' : ''}`} onClick={() => goToProject(p.id)}>
                          {isClosed ? 'Ver proyecto' : 'Abrir proyecto'}
                        </button>
                        <button type="button" className={`plc-status-btn${isClosed ? ' plc-status-btn--reopen' : ' plc-status-btn--close'}`} onClick={e => { e.stopPropagation(); updateProject(p.id, { status: isClosed ? 'active' : 'closed' }) }}>
                          {isClosed ? 'Reabrir' : 'Cerrar'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {isFiltered && filteredProjects.length > 0 && projectSearchQuery.trim() && (
          <p className="proj-no-more">No hay más proyectos con '{projectSearchQuery}'</p>
        )}
      </div>
    )
  }

  const renderProjectDetail = () => {
    if (!activeProject) return null
    const iCount = interviews.filter(i => projectCandidates.find(c => c.id === i.candidateId)).length
    const tCount = interviews.filter(i => projectCandidates.find(c => c.id === i.candidateId) && i.transcriptionStatus === 'done').length
    return (
      <div className="screen-content">
        {/* Project header card */}
        <div className="proj-header-card">
          <div className="proj-header-accent" />
          <div className="proj-header-body">
            <div className="proj-header-info">
              <h2 className="proj-header-title">{activeProject.name}</h2>
              <p className="proj-header-sub">{activeProject.company} · Creado {fs(activeProject.createdAt)}</p>
            </div>
            <div className="proj-header-stats">
              <div className="proj-stat"><span className="proj-stat-n">{projectCandidates.length}</span><span className="proj-stat-l">perfiles</span></div>
              <div className="proj-stat"><span className="proj-stat-n">{iCount}</span><span className="proj-stat-l">entrevistas</span></div>
              <div className="proj-stat"><span className="proj-stat-n">{tCount}</span><span className="proj-stat-l">transcritas</span></div>
            </div>
            <div className="proj-header-actions">
              <button type="button" className="btn-icon" title="Exportar" onClick={() => { setExportCandidateId(null); setShowExport(true) }}><DownloadIcon /></button>
              <button
                type="button"
                className={`btn-trash${pendingDeleteId === activeProject.id ? ' confirming' : ''}`}
                title={pendingDeleteId === activeProject.id ? '¿Confirmar?' : 'Eliminar proyecto'}
                onClick={() => void handleDeleteProject(activeProject.id)}
              >
                {pendingDeleteId === activeProject.id
                  ? <><CheckIcon /><span className="confirming-label">Eliminar ({projectCandidates.length} perfiles)</span></>
                  : <TrashIcon />}
              </button>
            </div>
          </div>
        </div>

        {/* Criteria row */}
        <div className="proj-criteria-row">
          <div className="proj-criteria-chips">
            {activeProject.evaluationCriteria.length > 0
              ? activeProject.evaluationCriteria.map((id, i) => {
                  if (id.startsWith('otros:')) {
                    const text = id.slice(6).trim()
                    return text ? <span key={i} className="criteria-chip">Otros: {text}</span> : null
                  }
                  const c = EVALUATION_CRITERIA.find(x => x.id === id)
                  return c ? <span key={id} className="criteria-chip">{c.label}</span> : null
                })
              : <span className="criteria-chip criteria-chip--empty">Sin criterios — el resumen usará estructura por defecto</span>
            }
            <button type="button" className="criteria-edit-btn" onClick={() => setShowCriteriaEdit(v => !v)}>
              {showCriteriaEdit ? 'Cerrar' : 'Editar criterios'}
            </button>
          </div>
          {showCriteriaEdit && (
            <div className="criteria-edit-panel">
              {renderCriteriaGrid(
                activeProject.evaluationCriteria,
                updated => updateProject(activeProject.id, { evaluationCriteria: updated })
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="proj-tabs">
          <button type="button" className={`proj-tab${projDetailTab === 'perfiles' ? ' proj-tab--active' : ''}`} onClick={() => setProjDetailTab('perfiles')}>Perfiles</button>
          <button type="button" className={`proj-tab${projDetailTab === 'analisis' ? ' proj-tab--active' : ''}`} onClick={() => setProjDetailTab('analisis')}>Análisis</button>
        </div>

        {projDetailTab === 'analisis' ? (() => {
          const projInterviews = interviews.filter(i => projectCandidates.some(c => c.id === i.candidateId))
          const total = projInterviews.length
          const transcribed = projInterviews.filter(i => i.transcriptionStatus === 'done').length
          const summarized = projInterviews.filter(i => i.summaryStatus === 'done').length
          const avgDur = total > 0 ? Math.round(projInterviews.reduce((s, i) => s + i.durationSec, 0) / total) : 0
          const pendingCands = projectCandidates.filter(c => {
            const ci = projInterviews.filter(i => i.candidateId === c.id)
            return ci.length > 0 && ci.every(i => i.transcriptionStatus !== 'done')
          })
          const noCands = projectCandidates.filter(c => !projInterviews.some(i => i.candidateId === c.id))
          const recentActivity = [...projInterviews].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5)
          const bar = (val: number, max: number) => max === 0 ? 0 : Math.round((val / max) * 100)

          return (
            <div className="pa-layout">
              <div className="pa-stats-row">
                <div className="pa-stat-card">
                  <span className="pa-stat-n">{projectCandidates.length}</span>
                  <span className="pa-stat-l">Candidatos</span>
                </div>
                <div className="pa-stat-card">
                  <span className="pa-stat-n">{total}</span>
                  <span className="pa-stat-l">Entrevistas</span>
                </div>
                <div className="pa-stat-card">
                  <span className="pa-stat-n">{total > 0 ? `${Math.round((transcribed / total) * 100)}%` : '—'}</span>
                  <span className="pa-stat-l">Transcritas</span>
                </div>
                <div className="pa-stat-card">
                  <span className="pa-stat-n">{avgDur > 0 ? fmt(avgDur) : '—'}</span>
                  <span className="pa-stat-l">Duración media</span>
                </div>
              </div>

              <div className="pa-section">
                <h4 className="pa-section-title">Embudo del proceso</h4>
                {[
                  { label: 'Grabadas', val: total, max: total, color: 'var(--primary)' },
                  { label: 'Transcritas', val: transcribed, max: total, color: 'var(--green)' },
                  { label: 'Resumidas', val: summarized, max: total, color: '#8b5cf6' },
                ].map(({ label, val, max, color }) => (
                  <div key={label} className="pa-funnel-row">
                    <span className="pa-funnel-label">{label}</span>
                    <div className="pa-funnel-bar-bg">
                      <div className="pa-funnel-bar-fill" style={{ width: `${bar(val, max)}%`, background: color }} />
                    </div>
                    <span className="pa-funnel-val">{val} / {max}</span>
                  </div>
                ))}
              </div>

              {(pendingCands.length > 0 || noCands.length > 0) && (
                <div className="pa-section">
                  <h4 className="pa-section-title">Requieren atención</h4>
                  {noCands.map(c => (
                    <div key={c.id} className="pa-alert-row" onClick={() => goToCandidate(c.id, activeProject.id)}>
                      <div className="pa-alert-dot pa-alert-dot--gray" />
                      <span className="pa-alert-name">{c.name}</span>
                      <span className="pa-alert-tag">Sin entrevista</span>
                    </div>
                  ))}
                  {pendingCands.map(c => (
                    <div key={c.id} className="pa-alert-row" onClick={() => goToCandidate(c.id, activeProject.id)}>
                      <div className="pa-alert-dot pa-alert-dot--amber" />
                      <span className="pa-alert-name">{c.name}</span>
                      <span className="pa-alert-tag">Pendiente de transcribir</span>
                    </div>
                  ))}
                </div>
              )}

              {recentActivity.length > 0 && (
                <div className="pa-section">
                  <h4 className="pa-section-title">Actividad reciente</h4>
                  {recentActivity.map(iv => {
                    const cand = candidates.find(c => c.id === iv.candidateId)
                    return (
                      <div key={iv.id} className="pa-activity-row" onClick={() => cand && goToCandidate(cand.id, activeProject.id)}>
                        <span className="pa-activity-icon">{iv.summaryStatus === 'done' ? <DocIcon /> : iv.transcriptionStatus === 'done' ? <ClipboardIcon /> : <MicIcon />}</span>
                        <div className="pa-activity-info">
                          <span className="pa-activity-name">{cand?.name ?? '—'} — {iv.sessionName || fs(iv.createdAt)}</span>
                          <span className="pa-activity-date">{fd(iv.createdAt)}</span>
                        </div>
                        <span className="pa-activity-status">{iv.summaryStatus === 'done' ? 'Resumida' : iv.transcriptionStatus === 'done' ? 'Transcrita' : 'Grabada'}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })() : (
          <>
        {/* Section header */}
        <div className="proj-section-header">
          <h3 className="proj-section-title">Perfiles del proceso</h3>
          <div className="proj-section-header-actions">
            <ViewToggle mode={profilesViewMode} onChange={setProfilesViewMode} />
            <button type="button" className="primary-btn pill-btn" onClick={() => { setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft(''); setCandidateStatusDraft('pendiente'); setCandidateConsentDraft(false); setShowNewCandidate(true) }}>Nuevo perfil</button>
          </div>
        </div>

        {/* Search */}
        <div className="search-bar">
          <span className="search-icon"><SearchIcon /></span>
          <input type="text" placeholder="Buscar por nombre, email o puesto..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && <button type="button" className="search-clear" onClick={() => setSearchQuery('')}>✕</button>}
        </div>

        {filteredCandidates.length === 0 ? (
          searchQuery
            ? <EmptyState title="Sin resultados" sub={`No hay perfiles que coincidan con "${searchQuery}"`} />
            : <EmptyState icon={<UsersIcon />} title="No hay perfiles en este proyecto" sub="Añade tu primer perfil para empezar a grabar y transcribir entrevistas" btnLabel="Nuevo perfil" onBtn={() => { setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft(''); setCandidateStatusDraft('pendiente'); setCandidateConsentDraft(false); setShowNewCandidate(true) }} />
        ) : (
          <div className={`pdc-list${profilesViewMode === 'grid' ? ' pdc-list--grid' : ''}`} style={profilesViewMode === 'grid' ? { '--cols': Math.min(3, filteredCandidates.length) } as React.CSSProperties : undefined}>
            {filteredCandidates.map(c => {
              const ci = interviews.filter(i => i.candidateId === c.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              const last = ci[0]
              const hasDone = ci.some(i => i.transcriptionStatus === 'done')
              const hasPending = ci.some(i => i.transcriptionStatus === 'pending')
              const statusInfo: [React.ReactNode, string] = last
                ? hasDone ? [<><DotFilled /> Transcrita</>, 'pdc-badge--done'] : hasPending ? [<><DotRing /> Pendiente</>, 'pdc-badge--pending'] : [<><DotRing /> Sin transcripción</>, 'pdc-badge--pending']
                : [<><DotRing /> Sin entrevista</>, 'pdc-badge--none']
              return (
                <div key={c.id} className="pdc-row" onClick={() => goToCandidate(c.id, activeProject.id)}>
                  <div className="pdc-row-accent" />
                  <div className="pdc-row-body">
                    <div className="pdc-row-avatar">{initials(c.name)}</div>
                    <div className="pdc-row-info">
                      <span className="pdc-row-name">{c.name}</span>
                      <span className="pdc-row-meta">{c.email}{last ? ` · Última entrevista: ${fs(last.createdAt)}` : c.role ? ` · ${c.role}` : ''}</span>
                    </div>
                    <span className={`pdc-badge ${statusInfo[1]}`}>{statusInfo[0]}</span>
                    {c.candidateStatus !== 'pendiente' && (() => {
                      const st = c.candidateStatus
                      const bg = st === 'apto' ? '#d1fae5' : st === 'finalista' ? '#dbeafe' : '#fee2e2'
                      const cl = st === 'apto' ? '#065f46' : st === 'finalista' ? '#1d4ed8' : '#991b1b'
                      const lb = st === 'apto' ? '✓ Apto' : st === 'finalista' ? '⭐ Finalista' : '✗ Descartado'
                      return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: bg, color: cl, whiteSpace: 'nowrap' }}>{lb}</span>
                    })()}
                    <div className="pdc-row-actions" onClick={e => e.stopPropagation()}>
                      <button type="button" className="btn-icon" title="Editar" onClick={() => { setCandidateDraft({ name: c.name, email: c.email, phone: c.phone, role: c.role }); setCandidateNotesDraft(c.notes ?? ''); setCandidateStatusDraft(c.candidateStatus ?? 'pendiente'); setCandidateConsentDraft(c.consentGiven ?? false); setEditingCandidateId(c.id); setShowNewCandidate(true) }}><PencilIcon /></button>
                      <button type="button" className={`btn-trash${pendingDeleteId === c.id ? ' confirming' : ''}`} onClick={() => handleDeleteCandidate(c.id)}>{pendingDeleteId === c.id ? <><CheckIcon /><span className="confirming-label">Eliminar ({interviews.filter(i => i.candidateId === c.id).length} entrevistas)</span></> : <TrashIcon />}</button>
                      <button type="button" className="pdc-open-btn" onClick={() => goToCandidate(c.id, activeProject.id)}>Ver entrevistas</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
          </>
        )}
      </div>
    )
  }

  const renderCandidates = () => {
    const allCandidates = candidates.filter(c => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.role.toLowerCase().includes(q)
    })
    return (
      <div className="screen-content">
        <div className="content-header">
          <div><h2>Perfiles</h2><p className="screen-sub">{candidates.length} perfil{candidates.length !== 1 ? 'es' : ''}</p></div>
          <ViewToggle mode={profilesViewMode} onChange={setProfilesViewMode} />
        </div>
        <div className="search-bar">
          <span className="search-icon"><SearchIcon /></span>
          <input type="text" placeholder="Buscar por nombre, email o puesto..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && <button type="button" className="search-clear" onClick={() => setSearchQuery('')}>✕</button>}
        </div>
        {allCandidates.length === 0 ? (
          searchQuery
            ? <EmptyState title="Sin resultados" sub={`No hay perfiles que coincidan con "${searchQuery}"`} />
            : <EmptyState icon={<UsersIcon />} title="Sin perfiles" sub="Los perfiles aparecerán aquí cuando los añadas a un proyecto." />
        ) : (
          <div className={`candidates-table${profilesViewMode === 'grid' ? ' candidates-table--grid' : ''}`} style={profilesViewMode === 'grid' ? { '--cols': Math.min(3, allCandidates.length) } as React.CSSProperties : undefined}>
            {allCandidates.map(c => {
              const project = projects.find(p => p.id === c.projectId)
              const ci = interviews.filter(i => i.candidateId === c.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              const last = ci[0]
              const hasDone = ci.some(i => i.transcriptionStatus === 'done')
              const hasPending = ci.some(i => i.transcriptionStatus === 'pending')
              const [statusLabel, statusCls] = last
                ? hasDone ? [<><DotFilled /> Transcrita</>, 'status-done'] : hasPending ? [<><DotRing /> Pendiente</>, 'status-pending'] : [<><DotRing /> Sin transcripción</>, 'status-pending']
                : [<><DotRing /> Sin entrevista</>, 'status-none']
              return (
                <div key={c.id} className="ctr" onClick={() => goToCandidate(c.id, c.projectId)}>
                  <div className="ctr-avatar">{initials(c.name)}</div>
                  <div className="ctr-info">
                    <span className="ctr-name">{c.name}</span>
                    <span className="ctr-meta">{project ? `${project.name}` : ''}{c.role ? ` · ${c.role}` : ''}{last ? ` · Última: ${fs(last.createdAt)}` : ''}</span>
                  </div>
                  <span className={`ctr-status ${statusCls}`}>{statusLabel}</span>
                  {c.candidateStatus !== 'pendiente' && (() => {
                    const st = c.candidateStatus
                    const bg = st === 'apto' ? '#d1fae5' : st === 'finalista' ? '#dbeafe' : '#fee2e2'
                    const cl = st === 'apto' ? '#065f46' : st === 'finalista' ? '#1d4ed8' : '#991b1b'
                    const lb = st === 'apto' ? '✓ Apto' : st === 'finalista' ? '⭐ Finalista' : '✗ Descartado'
                    return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: bg, color: cl, whiteSpace: 'nowrap' }}>{lb}</span>
                  })()}
                  <div className="ctr-actions" onClick={e => e.stopPropagation()}>
                    <button type="button" className="btn-icon" title="Exportar" onClick={() => { setExportCandidateId(c.id); setShowExport(true) }}><DownloadIcon /></button>
                    <button type="button" className="btn-icon" title="Editar" onClick={() => { setCandidateDraft({ name: c.name, email: c.email, phone: c.phone, role: c.role }); setCandidateNotesDraft(c.notes ?? ''); setCandidateStatusDraft(c.candidateStatus ?? 'pendiente'); setCandidateConsentDraft(c.consentGiven ?? false); setEditingCandidateId(c.id); setShowNewCandidate(true) }}><PencilIcon /></button>
                    <button type="button" className={`btn-trash${pendingDeleteId === c.id ? ' confirming' : ''}`} title={pendingDeleteId === c.id ? '¿Confirmar eliminación?' : 'Eliminar perfil'} onClick={() => handleDeleteCandidate(c.id)}>{pendingDeleteId === c.id ? <><CheckIcon /><span className="confirming-label">Eliminar ({interviews.filter(i => i.candidateId === c.id).length} entrevistas)</span></> : <TrashIcon />}</button>
                  </div>
                  <button type="button" className="ctr-open">Ver entrevistas →</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const renderCandidateDetail = () => {
    if (!activeCandidate) return null
    const totalDuration = candidateInterviews.reduce((a, i) => a + i.durationSec, 0)
    const transcribedCount = candidateInterviews.filter(i => i.transcriptionStatus === 'done').length
    const hasError = candidateInterviews.some(i => i.transcriptionStatus === 'error')
    const subtitleParts = [activeCandidate.email, activeCandidate.role, activeProject?.name].filter(Boolean)
    return (
      <div className="screen-content screen-candidate">
        <div className="cand-header-card">
          <div className="cand-header-accent" />
          <div className="cand-header-body">
            <div className="cand-header-main">
              <h2 className="cand-header-name">{activeCandidate.name}</h2>
              {subtitleParts.length > 0 && <p className="cand-header-sub">{subtitleParts.join('  ·  ')}</p>}
              {activeCandidate.notes && <p className="cand-header-sub" style={{ marginTop: 4, fontStyle: 'italic', opacity: 0.75 }}>{activeCandidate.notes}</p>}
            </div>
            <div className="cand-header-stats">
              <div className="cand-hstat">
                <span className="cand-hstat-n">{candidateInterviews.length}</span>
                <span className="cand-hstat-l">grabaciones</span>
              </div>
              <div className="cand-hstat">
                <span className="cand-hstat-n">{transcribedCount}</span>
                <span className="cand-hstat-l">transcritas</span>
              </div>
              <div className="cand-hstat">
                <span className="cand-hstat-n cand-hstat-n--sm">{fmt(totalDuration)}</span>
                <span className="cand-hstat-l">duración total</span>
              </div>
            </div>
            <div className="cand-header-right">
              <span className={`cand-status-badge${hasError ? ' cand-status-badge--error' : transcribedCount > 0 ? ' cand-status-badge--done' : ''}`}>
                {hasError ? <><WarnTriangle /> Error</> : transcribedCount > 0 ? <><DotFilled /> Transcrita</> : <><DotRing /> Pendiente</>}
              </span>
              <span className={`consent-badge${activeCandidate.consentGiven ? ' consent-badge--ok' : ' consent-badge--missing'}`} title={activeCandidate.consentGiven && activeCandidate.consentAt ? `Consentimiento registrado el ${new Date(activeCandidate.consentAt).toLocaleString('es-ES')}` : 'Sin consentimiento registrado'}>
                {activeCandidate.consentGiven ? '🔒 Consentimiento ✓' : '⚠ Sin consentimiento'}
              </span>
              {activeCandidate.candidateStatus !== 'pendiente' && (() => {
                const st = activeCandidate.candidateStatus
                const bg = st === 'apto' ? '#d1fae5' : st === 'finalista' ? '#dbeafe' : '#fee2e2'
                const cl = st === 'apto' ? '#065f46' : st === 'finalista' ? '#1d4ed8' : '#991b1b'
                const lb = st === 'apto' ? '✓ Apto' : st === 'finalista' ? '⭐ Finalista' : '✗ Descartado'
                return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: bg, color: cl, whiteSpace: 'nowrap' }}>{lb}</span>
              })()}
              <div className="cand-header-actions">
                <button type="button" className="btn-icon" title="Exportar" onClick={() => { setExportCandidateId(activeCandidate.id); setShowExport(true) }}><DownloadIcon /></button>
                <button type="button" className="btn-icon" title="Editar" onClick={() => { setCandidateDraft({ name: activeCandidate.name, email: activeCandidate.email, phone: activeCandidate.phone, role: activeCandidate.role }); setCandidateNotesDraft(activeCandidate.notes ?? ''); setCandidateStatusDraft(activeCandidate.candidateStatus ?? 'pendiente'); setCandidateConsentDraft(activeCandidate.consentGiven ?? false); setEditingCandidateId(activeCandidate.id); setShowNewCandidate(true) }}><PencilIcon /></button>
              </div>
            </div>
          </div>
        </div>
        <div className="profile-tabs-pill">
          {([['entrevistas', <><MicIcon /> Entrevistas</>], ['transcripcion', <><DocIcon /> Transcripción</>], ['resumen', <>★ Resumen IA</>]] as [ProfileTab, ReactNode][]).map(([tab, label]) => (
            <button key={tab} type="button" className={`pill-tab${activeTab === tab ? ' pill-tab--active' : ''}`} onClick={() => setActiveTab(tab)}>
              {label}
            </button>
          ))}
        </div>
        {activeTab === 'entrevistas' && renderInterviewsTab()}
        {activeTab === 'transcripcion' && renderTranscriptTab()}
        {activeTab === 'resumen' && renderSummaryTab()}
      </div>
    )
  }

  const renderInterviewsTab = () => (
    <div className="interviews-tab">
      {!groqApiKey && (
        <div className="warning-note" style={{ marginBottom: 12 }}>
          ⚠ Sin API key de Groq — la transcripción no funcionará. <button type="button" className="link-btn" onClick={() => openSettings('api-keys')}>Configurar ahora →</button>
        </div>
      )}
      <div className="rec-section-header">
        <h3 className="rec-section-title">Grabaciones</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {playingInterviewId && (
            <select
              className="cfg-select"
              style={{ fontSize: 12, padding: '3px 6px', minWidth: 70 }}
              value={playbackRate}
              onChange={e => setPlaybackRate(parseFloat(e.target.value))}
              title="Velocidad de reproducción"
            >
              <option value="0.5">0.5×</option>
              <option value="0.75">0.75×</option>
              <option value="1">1×</option>
              <option value="1.25">1.25×</option>
              <option value="1.5">1.5×</option>
              <option value="2">2×</option>
            </select>
          )}
          {window.desktopApp?.selectAudioFile && (
            <button type="button" className="secondary-btn pill-btn" onClick={() => void handleImportAudio()}><UploadIcon /> Importar audio</button>
          )}
          <button type="button" className="primary-btn pill-btn" onClick={handleNewRecording}><MicIcon /> Nueva grabación</button>
        </div>
      </div>
      {candidateInterviews.length === 0 ? (
        <EmptyState icon={<MicIcon />} title="No hay grabaciones todavía" sub={`Graba la primera entrevista con ${activeCandidate?.name ?? 'el perfil'} para empezar`} btnLabel="Nueva grabación" onBtn={handleNewRecording} />
      ) : (
        <>
          {candidateInterviews.length > 2 && (
            <div className="search-bar" style={{ marginBottom: 8 }}>
              <span className="search-icon"><SearchIcon /></span>
              <input type="text" placeholder="Buscar grabación..." value={ivSearchQuery} onChange={e => setIvSearchQuery(e.target.value)} />
              {ivSearchQuery && <button type="button" className="search-clear" onClick={() => setIvSearchQuery('')}>✕</button>}
            </div>
          )}
        <div className="rec-rows">
          {candidateInterviews.filter(iv => !ivSearchQuery.trim() || iv.sessionName.toLowerCase().includes(ivSearchQuery.toLowerCase()) || fd(iv.createdAt).includes(ivSearchQuery)).map(iv => {
            const isDone = iv.transcriptionStatus === 'done'
            const isError = iv.transcriptionStatus === 'error'
            const isTranscribing = iv.transcriptionStatus === 'transcribing'
            return (
              <div key={iv.id}>
              <div
                className={`rec-row${iv.videoFilePath ? ' rec-row--expandable' : ''}`}
                onClick={() => { if (iv.videoFilePath) setExpandedVideoId(id => id === iv.id ? null : iv.id) }}
              >
                <div className="rec-row-accent" />
                <div className="rec-row-info">
                  <div className="rec-row-top">
                    {editingInterviewId === iv.id ? (
                      <div className="rec-row-edit-wrap" onClick={e => e.stopPropagation()}>
                        <input type="text" className="rec-row-edit-input" value={editingNameDraft} onChange={e => setEditingNameDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { if (editingNameDraft.trim()) updateInterview(iv.id, { sessionName: editingNameDraft.trim() }); setEditingInterviewId(null) } if (e.key === 'Escape') setEditingInterviewId(null) }} autoFocus />
                        <button type="button" className="btn-icon btn-icon--confirm" onClick={() => { if (editingNameDraft.trim()) updateInterview(iv.id, { sessionName: editingNameDraft.trim() }); setEditingInterviewId(null) }}><CheckIcon /></button>
                        <button type="button" className="btn-icon" onClick={() => setEditingInterviewId(null)}>✕</button>
                      </div>
                    ) : (
                      <span className="rec-row-name">{iv.sessionName || fd(iv.createdAt)}</span>
                    )}
                  </div>
                  <span className="rec-row-meta">
                    {fs(iv.createdAt)}{iv.durationSec > 0 ? `  ·  ${fmt(iv.durationSec)}` : ''}
                    {iv.videoFilePath ? <> · 🎥 vídeo <span className={`rec-row-chevron${expandedVideoId === iv.id ? ' rec-row-chevron--open' : ''}`}>▾</span></> : ''}
                  </span>
                  {iv.captureSource === 'mic' && (
                    <span className="rec-row-warning" title="No se capturó el audio del sistema: la transcripción solo incluirá tu micrófono, no la otra voz de la llamada.">
                      ⚠ Sin audio del interlocutor
                    </span>
                  )}
                </div>
                <span className={`rec-row-badge${isDone ? ' rec-row-badge--done' : isError ? ' rec-row-badge--error' : isTranscribing ? ' rec-row-badge--transcribing' : ' rec-row-badge--pending'}`}>
                  {isDone ? <><DotFilled /> Transcrita</> : isError ? <><WarnTriangle /> Error</> : isTranscribing ? <><span className="spinner" style={{width:8,height:8,display:'inline-block',verticalAlign:'middle',marginRight:2}}/> Transcribiendo</> : <><DotRing /> Pendiente</>}
                </span>
                <div className="rec-row-actions" onClick={e => e.stopPropagation()}>
                  {(iv.recordingUrl ?? iv.recordingFilePath) && (
                    <button type="button" className="btn-icon" title="Reproducir" onClick={() => handleTogglePlayback(iv)}>{playingInterviewId === iv.id ? <PauseIconSm /> : <PlayIcon />}</button>
                  )}
                  {renderSeekBar(iv)}
                  <button type="button" className="btn-icon" title="Renombrar" onClick={() => { setEditingInterviewId(iv.id); setEditingNameDraft(iv.sessionName || fd(iv.createdAt)) }}><PencilIcon /></button>
                  <button type="button" className={`btn-trash${pendingDeleteId === iv.id ? ' confirming' : ''}`} title={pendingDeleteId === iv.id ? '¿Confirmar?' : 'Eliminar'} onClick={() => handleDeleteInterview(iv.id)}>
                    {pendingDeleteId === iv.id ? <><CheckIcon /><span className="confirming-label">Confirmar</span></> : <TrashIcon />}
                  </button>
                </div>
                {isDone ? (
                  <button type="button" className="rec-row-btn rec-row-btn--outline" onClick={e => { e.stopPropagation(); setSelectedInterviewId(iv.id); setActiveTab('transcripcion') }}>Ver transcripción</button>
                ) : iv.recordingFilePath && !isTranscribing ? (
                  <button type="button" className="rec-row-btn rec-row-btn--primary" onClick={e => { e.stopPropagation(); void handleTranscribe(iv.id) }}>{isError ? '↺ Reintentar' : '▶ Transcribir'}</button>
                ) : isTranscribing ? (
                  <div className="rec-row-spinner"><span className="spinner" /></div>
                ) : null}
              </div>
              {iv.videoFilePath && expandedVideoId === iv.id && (
                <div className="video-player-card" onClick={e => e.stopPropagation()}>
                  <div className="video-player-title">🎥 Vídeo de la grabación</div>
                  <video
                    className="video-player-el"
                    controls
                    src={resolveVideoUrl(iv.videoFilePath) ?? undefined}
                    ref={el => { if (el) { el.playbackRate = videoPlaybackRate; el.volume = videoVolume } }}
                  />
                  <div className="video-player-controls">
                    <label className="video-player-ctrl">Velocidad
                      <select value={videoPlaybackRate} onChange={e => setVideoPlaybackRate(parseFloat(e.target.value))}>
                        <option value="0.5">0.5×</option>
                        <option value="0.75">0.75×</option>
                        <option value="1">1×</option>
                        <option value="1.25">1.25×</option>
                        <option value="1.5">1.5×</option>
                        <option value="2">2×</option>
                      </select>
                    </label>
                    <label className="video-player-ctrl">Volumen
                      <input type="range" min="0" max="1" step="0.05" value={videoVolume} onChange={e => setVideoVolume(parseFloat(e.target.value))} />
                    </label>
                  </div>
                  <span className="video-player-sub">🎥 Vídeo con audio  ·  {fs(iv.createdAt)}  ·  {fmt(iv.durationSec)}  ·  guardado en tu equipo</span>
                </div>
              )}
              </div>
            )
          })}
        </div>
        </>
      )}
    </div>
  )

  const renderTranscriptTab = () => {
    const wordCount = transcriptDraft.trim() ? transcriptDraft.trim().split(/\s+/).length : 0
    const readingMin = Math.ceil(wordCount / 150)
    return (
      <div className="transcript-layout-v2">
        <aside className="trx-list-panel">
          {candidateInterviews.length === 0 ? <p className="tab-note">No hay entrevistas todavía.</p> : candidateInterviews.map(iv => {
            const hasDone = iv.transcriptionStatus === 'done'
            const isSelected = iv.id === selectedInterviewId
            return (
              <div key={iv.id} className={`trx-list-item${isSelected ? ' is-selected' : ''}`} onClick={() => setSelectedInterviewId(iv.id)}>
                <div className="trx-list-item-info">
                  <span className="trx-list-item-name">{iv.sessionName || fd(iv.createdAt)}</span>
                  <span className="trx-list-item-date">{fs(iv.createdAt)}</span>
                </div>
                <div className="trx-list-item-bottom">
                  <span className={`trx-status-badge${hasDone ? ' trx-status-badge--done' : ''}`}>{hasDone ? <><DotFilled /> Transcrita</> : <><DotRing /> Pendiente</>}</span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {(iv.recordingUrl ?? iv.recordingFilePath) && (
                      <button type="button" className="trx-transcribe-btn" title="Reproducir" onClick={e => { e.stopPropagation(); handleTogglePlayback(iv) }}>{playingInterviewId === iv.id ? <PauseIconSm /> : <PlayIcon />}</button>
                    )}
                    {iv.recordingFilePath && iv.transcriptionStatus !== 'transcribing' && (
                      <button type="button" className="trx-transcribe-btn" onClick={e => { e.stopPropagation(); void handleTranscribe(iv.id) }}>{hasDone ? '↺' : 'Transcribir'}</button>
                    )}
                    {iv.transcriptionStatus === 'transcribing' && <span className="spinner" style={{ width: 12, height: 12 }} />}
                  </div>
                </div>
                {renderSeekBar(iv, true)}
              </div>
            )
          })}
        </aside>
        <div className="trx-separator" />
        <div className="trx-editor-panel">
          {selectedInterview ? (
            <>
              <div className="trx-toolbar">
                <div className="trx-search">
                  <SearchIcon />
                  <input type="text" placeholder="Buscar en transcripción..." value={txSearchQuery} onChange={e => setTxSearchQuery(e.target.value)} />
                  {txSearchQuery.trim() && (() => {
                    const count = transcriptDraft ? (transcriptDraft.toLowerCase().split(txSearchQuery.toLowerCase()).length - 1) : 0
                    return <span style={{ fontSize: 11, color: count > 0 ? 'var(--primary)' : 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 4 }}>{count} {count === 1 ? 'resultado' : 'resultados'}</span>
                  })()}
                </div>
                <select
                  className="trx-lang-select"
                  value={txLang}
                  onChange={e => setTxLang(e.target.value)}
                  title="Idioma para transcripción"
                >
                  <option value="auto">🌐 Auto-detectar</option>
                  <option value="es">🇪🇸 Español</option>
                  <option value="en">🇬🇧 English</option>
                  <option value="fr">🇫🇷 Français</option>
                  <option value="de">🇩🇪 Deutsch</option>
                  <option value="pt">🇵🇹 Português</option>
                  <option value="it">🇮🇹 Italiano</option>
                </select>
                {selectedInterview.recordingFilePath && (
                  <button
                    type="button"
                    className={`trx-tool-btn${retranscribeConfirmId === selectedInterview.id ? ' trx-tool-btn--retranscribe' : ' trx-tool-btn--retranscribe'}`}
                    disabled={selectedInterview.transcriptionStatus === 'transcribing'}
                    style={retranscribeConfirmId === selectedInterview.id ? { background: 'var(--warning, #f59e0b)', color: '#fff' } : undefined}
                    onClick={() => {
                      if (selectedInterview.transcriptEdited && retranscribeConfirmId !== selectedInterview.id) {
                        setRetranscribeConfirmId(selectedInterview.id)
                      } else {
                        setRetranscribeConfirmId(null)
                        void handleTranscribe(selectedInterview.id)
                      }
                    }}
                    title={selectedInterview.transcriptEdited ? 'Volver a transcribir (sobreescribe la actual)' : 'Transcribir grabación'}
                  >
                    {selectedInterview.transcriptionStatus === 'transcribing'
                      ? <><span className="spinner" /> Transcribiendo...</>
                      : retranscribeConfirmId === selectedInterview.id
                        ? '⚠ ¿Confirmar?'
                        : selectedInterview.transcriptEdited ? '↺ Re-transcribir' : '▶ Transcribir'}
                  </button>
                )}
                <button type="button" className="trx-tool-btn trx-tool-btn--outline" onClick={async () => { try { await navigator.clipboard.writeText(transcriptDraft); toast('Copiada') } catch { toast('No se pudo copiar', 'error') } }}><ClipboardIcon /> Copiar todo</button>
                <button type="button" className="trx-tool-btn trx-tool-btn--primary" onClick={() => { const blob = new Blob([transcriptDraft], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${selectedInterview.sessionName || 'transcripcion'}.txt`; a.click(); URL.revokeObjectURL(url) }}><DownloadIcon /> Descargar .txt</button>
              </div>
              {selectedInterview.transcriptionStatus === 'transcribing' && <div className="spinner-row"><span className="spinner" /><span>Transcripción en curso...</span><button type="button" className="secondary-btn" style={{ marginLeft: 12 }} onClick={() => updateInterview(selectedInterview.id, { transcriptionStatus: 'pending' })}>Cancelar</button></div>}
              {selectedInterview.transcriptionStatus === 'error' && (
                <div className="trx-error-card">
                  <div className="trx-error-accent" />
                  <div className="trx-error-body">
                    <div className="trx-error-icon-wrap"><span className="trx-error-icon">⚠</span></div>
                    <h3 className="trx-error-title">Error al transcribir</h3>
                    <p className="trx-error-sub1">No se pudo completar la transcripción.</p>
                    <p className="trx-error-sub2">Verifica tu clave API de Groq o inténtalo de nuevo.</p>
                    <button type="button" className="primary-btn pill-btn trx-error-btn" onClick={() => void handleTranscribe(selectedInterview.id)}>↺  Reintentar</button>
                    <button type="button" className="link-btn trx-error-back" onClick={() => setActiveTab('entrevistas')}>← Volver a grabaciones</button>
                  </div>
                </div>
              )}
              {selectedInterview.transcriptionStatus !== 'transcribing' && (
                !selectedInterview.transcriptEdited ? (
                  <div className="trx-pending-state">
                    <div className="trx-pending-icon">⊙</div>
                    <p className="trx-pending-title">Esta grabación aún no ha sido transcrita</p>
                    <p className="trx-pending-sub">Pulsa "Transcribir" en el panel izquierdo para procesarla con Whisper.</p>
                  </div>
                ) : (
                  <textarea className="trx-textarea" value={transcriptDraft} onChange={e => setTranscriptDraft(e.target.value)} placeholder="La transcripción aparecerá aquí..." />
                )
              )}
              <div className="trx-footer">
                <span className="trx-footer-info">✎ Haz clic para editar · {wordCount} palabras · {readingMin} min</span>
                <div className="trx-footer-actions">
                  <button type="button" className="trx-footer-btn" onClick={() => { updateInterview(selectedInterview.id, { transcriptEdited: transcriptDraft, transcriptUpdatedAt: new Date().toISOString() }); toast('Transcripción guardada') }}>Guardar</button>
                  <button type="button" className="trx-footer-btn" onClick={() => { const orig = selectedInterview.transcriptOriginal; setTranscriptDraft(orig); updateInterview(selectedInterview.id, { transcriptEdited: orig, transcriptUpdatedAt: new Date().toISOString() }); toast('Transcripción restaurada') }}>Restaurar original</button>
                </div>
              </div>
            </>
          ) : <p className="tab-note">Selecciona una entrevista para editar su transcripción.</p>}
        </div>
      </div>
    )
  }

  const renderSummaryTab = () => {
    const SECTION_COLORS: [string, string][] = [['perfil', '#2563eb'], ['general', '#2563eb'], ['fuertes', '#1ab273'], ['mejora', '#f2991a'], ['áreas', '#f2991a'], ['areas', '#f2991a'], ['recomend', '#2563eb']]
    const getSectionColor = (title: string) => { const l = title.toLowerCase(); for (const [k, c] of SECTION_COLORS) { if (l.includes(k)) return c }; return '#2563eb' }
    const parseSections = (text: string) => {
      const lines = text.split('\n')
      const sections: { title: string; content: string; color: string }[] = []
      let cur: { title: string; lines: string[]; color: string } | null = null
      for (const line of lines) {
        const isHeading = line.match(/^#{1,3}\s+/) || (line.match(/^\*\*.+\*\*$/) && line.trim().length < 60)
        if (isHeading) {
          if (cur) sections.push({ title: cur.title, content: cur.lines.join('\n').trim(), color: cur.color })
          const title = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim()
          cur = { title, lines: [], color: getSectionColor(title) }
        } else if (cur) { cur.lines.push(line) } else if (line.trim()) { cur = { title: '', lines: [line], color: '#2563eb' } }
      }
      if (cur) sections.push({ title: cur.title, content: cur.lines.join('\n').trim(), color: cur.color })
      return sections.filter(s => s.title || s.content)
    }
    const summarySections = selectedInterview?.summaryText ? parseSections(selectedInterview.summaryText) : []
    return (
      <div className="transcript-layout-v2">
        <aside className="trx-list-panel">
          {candidateInterviews.length === 0 ? <p className="tab-note">No hay entrevistas todavía.</p> : candidateInterviews.map(iv => {
            const hasSummary = iv.summaryStatus === 'done' || !!iv.summaryText
            const isSelected = iv.id === selectedInterviewId
            return (
              <div key={iv.id} className={`trx-list-item${isSelected ? ' is-selected' : ''}`} onClick={() => setSelectedInterviewId(iv.id)}>
                <div className="trx-list-item-info">
                  <span className="trx-list-item-name">{iv.sessionName || fd(iv.createdAt)}</span>
                  <span className="trx-list-item-date">{fs(iv.createdAt)}</span>
                </div>
                <div className="trx-list-item-bottom">
                  <span className={`trx-status-badge${hasSummary ? ' trx-status-badge--done' : ''}`}>{hasSummary ? <><DotFilled /> Con resumen</> : <><DotRing /> Sin resumen</>}</span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {(iv.recordingUrl ?? iv.recordingFilePath) && (
                      <button type="button" className="trx-transcribe-btn" title="Reproducir" onClick={e => { e.stopPropagation(); handleTogglePlayback(iv) }}>{playingInterviewId === iv.id ? <PauseIconSm /> : <PlayIcon />}</button>
                    )}
                  </div>
                </div>
                {renderSeekBar(iv, true)}
              </div>
            )
          })}
        </aside>
        <div className="trx-separator" />
        <div className="trx-editor-panel">
          {selectedInterview ? (
            <>
              <div className="trx-toolbar">
                <select className={`sum-type-select${selectedInterview.summaryType === 'resumen' ? ' sum-type-select--active' : ''}`} value={selectedInterview.summaryType} onChange={e => updateInterview(selectedInterview.id, { summaryType: e.target.value as 'resumen' | 'listado' })}>
                  <option value="resumen">Resumen descriptivo ⌄</option>
                  <option value="listado">Listado por puntos ⌄</option>
                </select>
                <button type="button" className="trx-tool-btn trx-tool-btn--copy" disabled={!selectedInterview.summaryText} onClick={async () => { try { await navigator.clipboard.writeText(selectedInterview.summaryText); toast('Resumen copiado') } catch { toast('No se pudo copiar', 'error') } }}>⎘ Copiar</button>
                <button type="button" className="trx-tool-btn trx-tool-btn--primary" onClick={() => void handleGenerateSummary(selectedInterview.id)} disabled={!groqApiKey || selectedInterview.transcriptionStatus !== 'done' || selectedInterview.summaryStatus === 'generating'}>{selectedInterview.summaryText ? '↺ Regenerar' : '★ Generar'}</button>
              </div>
              {!groqApiKey && <p className="warning-note">Configura tu API key de Groq en <button type="button" className="link-btn" onClick={() => openSettings()}>Configuración</button></p>}
              {selectedInterview.transcriptionStatus !== 'done' && <p className="warning-note">Primero transcribe la entrevista</p>}
              {selectedInterview.summaryStatus === 'generating' && <div className="spinner-row"><span className="spinner" /><span>Generando resumen...</span></div>}
              {selectedInterview.summaryStatus === 'error' && <p className="error-note">Error. Inténtalo de nuevo.</p>}
              {(() => {
                const cand = candidates.find(c => c.id === selectedInterview.candidateId)
                const proj = cand ? projects.find(p => p.id === cand.projectId) : null
                const crit = proj?.evaluationCriteria ?? []
                const labels = crit.map(id => EVALUATION_CRITERIA.find(c => c.id === id)?.label).filter(Boolean)
                return labels.length > 0
                  ? <p className="sum-criteria-hint">Criterios del proyecto: <strong>{labels.join(', ')}</strong></p>
                  : <p className="sum-criteria-hint sum-criteria-hint--empty">Sin criterios definidos — configúralos en el proyecto para enfocar el resumen</p>
              })()}
              {selectedInterview.summaryText ? (
                selectedInterview.summaryType === 'resumen' ? (
                  <div className="sum-prose-card">
                    <p className="sum-prose-text">{selectedInterview.summaryText}</p>
                  </div>
                ) : summarySections.length > 1 ? (
                  <div className="sum-sections">
                    {summarySections.map((sec, i) => (
                      <div key={i} className="sum-section" style={{ borderLeftColor: sec.color }}>
                        {sec.title && <h4 className="sum-section-title" style={{ color: sec.color }}>{sec.title}</h4>}
                        <div className="sum-section-content">{sec.content.split('\n').map((line, j) => line.trim() ? <p key={j}>{line}</p> : null)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="summary-result"><textarea value={selectedInterview.summaryText} onChange={e => updateInterview(selectedInterview.id, { summaryText: e.target.value })} rows={10} /></div>
                )
              ) : (
                selectedInterview.transcriptionStatus === 'done' && selectedInterview.summaryStatus !== 'generating' && (
                  <button type="button" className="gen-summary-btn" onClick={() => void handleGenerateSummary(selectedInterview.id)} disabled={!groqApiKey}>
                    ★ Generar resumen con IA
                  </button>
                )
              )}
            </>
          ) : <p className="tab-note">Selecciona una entrevista para generar su resumen.</p>}
        </div>
      </div>
    )
  }

  const renderSettings = () => (
    <div className="screen-content">
      <div className="content-header"><h2>Configuración</h2></div>
      <div className="settings-layout">
        <aside className="settings-nav">
          {([
            ['api-keys', <KeyIcon />, 'API Keys'],
            ['grabacion', <MicIcon />, 'Grabación'],
            ['general', <SettingsIcon />, 'General'],
          ] as [SettingsTab, React.ReactNode, string][]).map(([tab, icon, label]) => (
            <button key={tab} type="button" className={`settings-nav-item${settingsTab === tab ? ' is-active' : ''}`} onClick={() => setSettingsTab(tab)}>
              <span className="settings-nav-icon">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </aside>
        <div className="settings-panel">
          {settingsTab === 'api-keys' && (
            <div className="settings-sections">
              <div className="settings-section">
                <div className="settings-section-title">API Key de Groq</div>
                <div className="settings-section-divider" />
                <p className="modal-link-note">Groq es gratuita — <a href="https://console.groq.com" target="_blank" rel="noreferrer">console.groq.com</a></p>
                <label className="modal-label">API Key<input type="password" className="modal-input" value={settingsKeyDraft} onChange={e => setSettingsKeyDraft(e.target.value)} placeholder="gsk_..." /></label>
              </div>
              <div className="settings-section">
                <div className="settings-section-title">Modelos IA</div>
                <div className="settings-section-divider" />
                <label className="modal-label">Transcripción (Whisper)
                  <select className="modal-input modal-select" value={settingsTxModelDraft} onChange={e => setSettingsTxModelDraft(e.target.value)}>
                    <option value="whisper-large-v3">whisper-large-v3 — Mayor precisión</option>
                    <option value="whisper-large-v3-turbo">whisper-large-v3-turbo — Rápido y preciso</option>
                  </select>
                </label>
                <label className="modal-label">Resumen IA (LLM)
                  <select className="modal-input modal-select" value={settingsSumModelDraft} onChange={e => setSettingsSumModelDraft(e.target.value)}>
                    <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile — Más capaz</option>
                    <option value="llama-3.1-8b-instant">llama-3.1-8b-instant — Más rápido</option>
                    <option value="gemma2-9b-it">gemma2-9b-it — Alternativa</option>
                  </select>
                </label>
              </div>
              <div className="settings-save"><button type="button" className="primary-btn pill-btn" onClick={() => void handleSaveSettings()}>Guardar cambios</button></div>
            </div>
          )}
          {settingsTab === 'grabacion' && (
            <>
              <div className="panel-header">
                <h2 className="panel-title">Grabación</h2>
              </div>
              <div className="panel-header-divider" />
              <div className="settings-sections">
                <div className="settings-section">
                  <div className="settings-section-label">FORMATO DE AUDIO</div>
                  <div className="settings-section-divider" />
                  <p className="cfg-field-desc">Elige el formato en que se guardan las grabaciones</p>
                  <div className="cfg-format-toggle">
                    <button type="button" className={`cfg-fmt-btn${settingsAudioFormatDraft === 'mp3' ? ' is-active' : ''}`} onClick={() => setSettingsAudioFormatDraft('mp3')}>MP3</button>
                    <button type="button" className={`cfg-fmt-btn${settingsAudioFormatDraft === 'wav' ? ' is-active' : ''}`} onClick={() => setSettingsAudioFormatDraft('wav')}>WAV</button>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">DURACIÓN DE FRAGMENTO (SEG)</div>
                  <div className="settings-section-divider" />
                  <input type="number" className="cfg-input" value={settingsChunkDurationDraft} onChange={e => setSettingsChunkDurationDraft(Number(e.target.value))} min={5} max={300} />
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">CALIDAD DE GRABACIÓN</div>
                  <div className="settings-section-divider" />
                  <select className="cfg-select" value={settingsRecordingQualityDraft} onChange={e => setSettingsRecordingQualityDraft(e.target.value)}>
                    <option value="high">Alta (128 kbps)</option>
                    <option value="medium">Media (64 kbps)</option>
                    <option value="low">Baja (32 kbps)</option>
                  </select>
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">VÍDEO</div>
                  <div className="settings-section-divider" />
                  <div className="toggle-row">
                    <div><span className="toggle-label">Grabar vídeo de la reunión</span><span className="notif-sub">El vídeo se guarda en tu equipo, no en la nube (ocupa más espacio).</span></div>
                    <button type="button" className={`toggle-btn${settingsRecordVideoDraft ? ' on' : ''}`} onClick={() => setSettingsRecordVideoDraft(t => !t)}><span className="toggle-circle" /></button>
                  </div>
                  <label className="modal-label" style={{ marginTop: 12 }}>Calidad de vídeo
                    <select className="modal-input modal-select" value={settingsVideoQualityDraft} onChange={e => setSettingsVideoQualityDraft(e.target.value as '720p' | '1080p')}>
                      <option value="1080p">1080p (Full HD)</option>
                      <option value="720p">720p (HD)</option>
                    </select>
                  </label>
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">DISPOSITIVOS PREDETERMINADOS</div>
                  <div className="settings-section-divider" />
                  <p className="cfg-field-desc">Se usarán automáticamente al iniciar una grabación</p>
                  <label className="modal-label">Micrófono predeterminado (entrada)
                    <select className="modal-input modal-select" value={settingsDefaultMicDraft} onChange={e => setSettingsDefaultMicDraft(e.target.value)}>
                      {micDevices.length === 0
                        ? <option value="">Sin dispositivos detectados</option>
                        : micDevices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)
                      }
                    </select>
                  </label>
                  <label className="modal-label" style={{ marginTop: 12 }}>Dispositivo de salida predeterminado
                    <select className="modal-input modal-select" value={settingsDefaultOutputDraft} onChange={e => setSettingsDefaultOutputDraft(e.target.value)}>
                      {outputDevices.length === 0
                        ? <option value="">Sin dispositivos detectados</option>
                        : outputDevices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)
                      }
                    </select>
                  </label>
                  <div className="toggle-row" style={{ marginTop: 12 }}>
                    <div><span className="toggle-label">Capturar audio del sistema</span><span className="notif-sub">Capturar también el audio que sale por los altavoces</span></div>
                    <button type="button" className={`toggle-btn${settingsDefaultSystemDraft ? ' on' : ''}`} onClick={() => setSettingsDefaultSystemDraft(t => !t)}><span className="toggle-circle" /></button>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">COMPORTAMIENTO</div>
                  <div className="settings-section-divider" />
                  <div className="toggle-row">
                    <div><span className="toggle-label">Transcripción automática</span><span className="notif-sub">Transcribir automáticamente al terminar cada grabación</span></div>
                    <button type="button" className={`toggle-btn${autoTranscribe ? ' on' : ''}`} onClick={() => setAutoTranscribe(t => !t)}><span className="toggle-circle" /></button>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">ARCHIVOS</div>
                  <div className="settings-section-divider" />
                  <p className="cfg-field-desc">Las grabaciones se guardan en <code style={{ fontSize: 11, background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4 }}>Documentos/CallTranscriber</code></p>
                  {window.desktopApp?.openRecordingsFolder && (
                    <button type="button" className="outline-btn pill-btn" style={{ marginTop: 10 }} onClick={() => void window.desktopApp!.openRecordingsFolder!()}>
                      <FolderIcon /> Abrir carpeta de grabaciones
                    </button>
                  )}
                </div>
                <div className="settings-save"><button type="button" className="primary-btn pill-btn" onClick={() => void handleSaveSettings()}>Guardar cambios</button></div>
              </div>
            </>
          )}
          {settingsTab === 'general' && (
            <>
              <div className="panel-header">
                <h2 className="panel-title">General</h2>
              </div>
              <div className="panel-header-divider" />
              <div className="settings-sections">
                <div className="settings-section">
                  <div className="settings-section-label">IDIOMA DE LA INTERFAZ</div>
                  <div className="settings-section-divider" />
                  <select className="cfg-select" value={settingsLanguageDraft} onChange={e => setSettingsLanguageDraft(e.target.value)}>
                    <option value="es">Español</option>
                    <option value="en">English</option>
                    <option value="fr">Français</option>
                  </select>
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">GUARDADO AUTOMÁTICO</div>
                  <div className="settings-section-divider" />
                  <div className="toggle-row">
                    <div><span className="toggle-label">Guardado automático</span><span className="notif-sub">Guarda los cambios automáticamente al cerrar</span></div>
                    <button type="button" className={`toggle-btn${settingsAutoSaveDraft ? ' on' : ''}`} onClick={() => setSettingsAutoSaveDraft(t => !t)}><span className="toggle-circle" /></button>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">FORMATO DE FECHA</div>
                  <div className="settings-section-divider" />
                  <select className="cfg-select" value={settingsDateFormatDraft} onChange={e => setSettingsDateFormatDraft(e.target.value)}>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </select>
                </div>
                <div className="settings-save"><button type="button" className="primary-btn pill-btn" onClick={() => void handleSaveSettings()}>Guardar cambios</button></div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )

  const renderProfile = () => (
    <div className="screen-content">
      <div className="content-header"><h2>Mi Perfil</h2></div>
      <div className="settings-layout">
        <aside className="settings-nav">
          {([
            ['perfil', <UserIcon />, 'Perfil'],
            ['plan', <StarIcon />, 'Plan & Uso'],
            ['seguridad', <LockIcon />, 'Seguridad'],
            ['notif', <BellIcon />, 'Notificaciones'],
          ] as [ProfileScreenTab, React.ReactNode, string][]).map(([tab, icon, label]) => (
            <button key={tab} type="button" className={`settings-nav-item${profileScreenTab === tab ? ' is-active' : ''}`} onClick={() => setProfileScreenTab(tab)}>
              <span className="settings-nav-icon">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </aside>
        <div className="settings-panel">
          {profileScreenTab === 'perfil' && (
            <div className="settings-sections">
              <div className="settings-section">
                <div className="prof-avatar-row">
                  <div className="prof-avatar-circle" onClick={() => photoInputRef.current?.click()} style={{ background: userPhoto ? 'transparent' : undefined, overflow: 'hidden' }}>
                    {userPhoto ? <img src={userPhoto} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block' }} /> : userInitials}
                    <div className="prof-avatar-overlay"><CameraIcon /></div>
                  </div>
                  <div className="prof-avatar-info">
                    <p className="prof-avatar-name">{userName || 'Sin nombre'}</p>
                    <p className="prof-avatar-email">{userEmail || 'Sin email'}</p>
                    <button type="button" className="prof-avatar-link" onClick={() => photoInputRef.current?.click()}>Cambiar foto →</button>
                    {userPhoto && <button type="button" className="prof-avatar-remove" onClick={() => { setUserPhoto(''); localStorage.removeItem('ct-user-photo') }}>Eliminar foto</button>}
                  </div>
                </div>
              </div>
              <div className="settings-section">
                <div className="settings-section-label">DATOS PERSONALES</div>
                <div className="settings-section-divider" />
                <div className="prof-fields-grid">
                  <label className="modal-label">Nombre<input type="text" className="modal-input" value={settingsNameDraft} onChange={e => setSettingsNameDraft(e.target.value)} placeholder="Tu nombre" /></label>
                  <label className="modal-label">Email<input type="email" className="modal-input" value={settingsEmailDraft} onChange={e => setSettingsEmailDraft(e.target.value)} placeholder="tu@email.com" /></label>
                  <label className="modal-label">Empresa<input type="text" className="modal-input" value={settingsCompanyDraft} onChange={e => setSettingsCompanyDraft(e.target.value)} placeholder="Nombre de la empresa" /></label>
                  <label className="modal-label">Cargo<input type="text" className="modal-input" value={settingsRoleDraft} onChange={e => setSettingsRoleDraft(e.target.value)} placeholder="Tu cargo" /></label>
                </div>
              </div>
              <div className="settings-save"><button type="button" className="primary-btn pill-btn" onClick={() => void handleSaveSettings()}>Guardar cambios</button></div>
            </div>
          )}
          {profileScreenTab === 'plan' && (
            <>
              <div className="panel-header">
                <h2 className="panel-title">Plan & Uso</h2>
                <p className="panel-subtitle">Tu plan actual y estadísticas de uso</p>
              </div>
              <div className="panel-header-divider" />
              <div className="settings-sections">
                <div className="settings-section">
                  <div className="prof-plan-card">
                    <p className="prof-plan-label">Cuenta</p>
                    <div className="prof-plan-badge" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>Plan gratuito</div>
                    <div className="prof-plan-card-divider" />
                    <p className="prof-plan-email">{userEmail || 'usuario'}</p>
                    <p className="prof-plan-since">Miembro desde {session?.user.created_at ? new Date(session.user.created_at).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }) : '—'}</p>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">ESTADÍSTICAS DE USO</div>
                  <div className="settings-section-divider" />
                  <div className="prof-stats-grid">
                    {([['Proyectos', stats.projects], ['Entrevistas', stats.interviews], ['Transcritas', stats.transcribed], ['Resúmenes IA', stats.summaries]] as [string, number][]).map(([label, val]) => (
                      <div key={label} className="prof-stat-card"><span className="prof-stat-n">{val}</span><span className="prof-stat-l">{label}</span></div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
          {profileScreenTab === 'seguridad' && (
            <>
              <div className="panel-header">
                <h2 className="panel-title">Seguridad</h2>
                <p className="panel-subtitle">Gestiona tu contraseña y acceso</p>
              </div>
              <div className="panel-header-divider" />
              <div className="settings-sections">
                <div className="settings-section">
                  <div className="settings-section-label">CAMBIAR CONTRASEÑA</div>
                  <div className="settings-section-divider" />
                  <label className="sec-field-label">Contraseña actual</label>
                  <input type="password" className="sec-input" value={settingsPasswordDraft} onChange={e => setSettingsPasswordDraft(e.target.value)} placeholder="••••••••" />
                  <label className="sec-field-label">Nueva contraseña</label>
                  <input type="password" className="sec-input" value={settingsPasswordNewDraft} onChange={e => setSettingsPasswordNewDraft(e.target.value)} placeholder="••••••••" />
                  <label className="sec-field-label">Confirmar nueva contraseña</label>
                  <input type="password" className="sec-input" value={settingsPasswordConfirmDraft} onChange={e => setSettingsPasswordConfirmDraft(e.target.value)} placeholder="••••••••" />
                </div>
                <div className="sec-bottom-divider" />
                <div className="settings-save"><button type="button" className="primary-btn pill-btn sec-update-btn" onClick={() => void handleChangePassword()}>Actualizar contraseña</button></div>
              </div>
            </>
          )}
          {profileScreenTab === 'notif' && (
            <>
              <div className="panel-header">
                <h2 className="panel-title">Notificaciones</h2>
                <p className="panel-subtitle">Elige cuándo y cómo te avisamos</p>
              </div>
              <div className="panel-header-divider" />
              <div className="notif-list">
                <div className="notif-row">
                  <div><span className="toggle-label">Transcripción completada</span><span className="notif-sub">Recibe un email cuando una transcripción finaliza</span></div>
                  <button type="button" className={`toggle-btn${notifTranscription ? ' on' : ''}`} onClick={() => setNotifTranscription(t => !t)}><span className="toggle-circle" /></button>
                </div>
                <div className="notif-divider" />
                <div className="notif-row">
                  <div><span className="toggle-label">Resumen semanal</span><span className="notif-sub">Resumen de actividad cada lunes por la mañana</span></div>
                  <button type="button" className={`toggle-btn${notifSummary ? ' on' : ''}`} onClick={() => setNotifSummary(t => !t)}><span className="toggle-circle" /></button>
                </div>
                <div className="notif-divider" />
                <div className="notif-row">
                  <div><span className="toggle-label">Alertas de error</span><span className="notif-sub">Notificación si falla el procesamiento de audio</span></div>
                  <button type="button" className={`toggle-btn${notifErrors ? ' on' : ''}`} onClick={() => setNotifErrors(t => !t)}><span className="toggle-circle" /></button>
                </div>
                <div className="notif-divider" />
                <div className="notif-row">
                  <div><span className="toggle-label">Novedades del producto</span><span className="notif-sub">Actualizaciones y nuevas funcionalidades</span></div>
                  <button type="button" className={`toggle-btn${notifProductUpdates ? ' on' : ''}`} onClick={() => setNotifProductUpdates(t => !t)}><span className="toggle-circle" /></button>
                </div>
                <div className="notif-divider" />
              </div>
              <div className="settings-save" style={{ marginTop: 20 }}><button type="button" className="primary-btn pill-btn" onClick={() => void handleSaveSettings()}>Guardar preferencias</button></div>
            </>
          )}
        </div>
      </div>
    </div>
  )

  // ── Overlays ───────────────────────────────────────────────────────────

  const renderCriteriaGrid = (
    criteria: string[],
    onChange: (updated: string[]) => void
  ) => {
    const otrosChecked = criteria.some(c => c.startsWith('otros:'))
    const otrosText = criteria.find(c => c.startsWith('otros:'))?.slice(6) ?? ''
    return (
      <>
        <div className="criteria-grid">
          {EVALUATION_CRITERIA.map(c => {
            const isOtros = c.id === 'otros'
            const checked = isOtros ? otrosChecked : criteria.includes(c.id)
            return (
              <label key={c.id} className="criteria-checkbox">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => {
                    if (isOtros) {
                      onChange(e.target.checked
                        ? [...criteria.filter(x => !x.startsWith('otros:')), 'otros:']
                        : criteria.filter(x => !x.startsWith('otros:')))
                    } else {
                      onChange(e.target.checked
                        ? [...criteria, c.id]
                        : criteria.filter(x => x !== c.id))
                    }
                  }}
                />
                <span>{c.label}</span>
              </label>
            )
          })}
        </div>
        {otrosChecked && (
          <input
            type="text"
            className="modal-input modal-input--figma criteria-otros-input"
            placeholder="Describe el criterio personalizado..."
            value={otrosText}
            onChange={e => onChange([
              ...criteria.filter(x => !x.startsWith('otros:')),
              `otros:${e.target.value}`,
            ])}
            autoFocus
          />
        )}
      </>
    )
  }

  const renderRecordingScreen = () => {
    if (!activeRecordingInterview) return null
    const isRecording = activeRecordingInterview.status === 'recording'
    const contextLabel = [activeRecordingCandidate?.name, activeRecordingProject ? `Proyecto: ${activeRecordingProject.name}` : null].filter(Boolean).join('  ·  ')
    return (
      <div className="rec-screen">
        {livePreviewStream && (
          <div className="rec-pip">
            <div className="rec-pip-video-wrap">
              <video ref={pipVideoRef} className="rec-pip-video" autoPlay muted playsInline />
              <span className="rec-pip-live-badge">● EN VIVO</span>
            </div>
            <span className="rec-pip-caption">🎥 Grabando ventana: {captureWindowLabel}</span>
          </div>
        )}
        <div className="rec-screen-content">
          <div className={`rec-badge${isRecording ? '' : ' rec-badge--paused'}`}>
            {isRecording ? '● EN GRABACIÓN' : '‖ EN PAUSA'}
          </div>
          <div className="rec-screen-timer">{fmt(activeRecordingInterview.durationSec)}</div>
          {contextLabel && <p className="rec-screen-context">{contextLabel}</p>}
          <div className="rec-screen-separator" />
          <div className="rec-waveform">
            {[20, 38, 52, 42, 62, 46, 58, 36, 50, 28, 44, 22].map((h, i) => (
              <div key={i} className="rec-wave-bar" style={{ height: h, animationDelay: `${i * 0.08}s` }} />
            ))}
          </div>
          <div className="rec-screen-controls">
            <div className="rec-screen-btn-wrap">
              <button type="button" className="rec-stop-btn" onClick={handleStopRecording}>
                <div className="rec-stop-icon" />
              </button>
              <span className="rec-btn-label rec-stop-label">Detener</span>
            </div>
            <div className="rec-screen-btn-wrap">
              {isRecording ? (
                <button type="button" className="rec-pause-btn" onClick={handlePauseRecording}>‖</button>
              ) : (
                <button type="button" className="rec-pause-btn" onClick={handleResumeRecording}>▶</button>
              )}
              <span className="rec-btn-label">{isRecording ? 'Pausar' : 'Reanudar'}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderTranscribingModal = () => {
    if (!transcribingInterview) return null
    const cand = candidates.find(c => c.id === transcribingInterview.candidateId)
    const step = (label: string, active: boolean, done: boolean) => (
      <div className={`proc-step${active ? ' active' : done ? ' done' : ''}`}>
        <span className="proc-step-icon">{done ? '✓' : active ? <span className="spinner" /> : '○'}</span>
        <span>{label}</span>
      </div>
    )
    return (
      <div className="modal-overlay">
        <div className="modal-box proc-modal">
          <h2>Procesando grabación...</h2>
          <p>Esto puede tardar unos segundos</p>
          {cand && <p className="proc-candidate">{cand.name} — {transcribingInterview.sessionName || fd(transcribingInterview.createdAt)}</p>}
          <div className="proc-steps">
            {step('Subiendo audio', false, true)}
            {step('Transcribiendo', true, false)}
            {step('Generando resumen', false, false)}
          </div>
          <button type="button" className="secondary-btn" onClick={() => updateInterview(transcribingInterview.id, { transcriptionStatus: 'pending' })}>Cancelar</button>
        </div>
      </div>
    )
  }

  const renderExportModal = () => {
    if (!showExport) return null
    const allCandidatesToExport = exportCandidateId
      ? [candidates.find(c => c.id === exportCandidateId)].filter(Boolean) as Candidate[]
      : activeProjectId ? candidates.filter(c => c.projectId === activeProjectId) : []

    const exportText = allCandidatesToExport.map(cand => {
      const ci = interviews.filter(i => i.candidateId === cand.id && (i.transcriptionStatus === 'done' || i.summaryStatus === 'done'))
      if (ci.length === 0) return `# ${cand.name}\nSin entrevistas transcritas.`
      return `# ${cand.name}\n${cand.role ? `Puesto: ${cand.role}\n` : ''}${cand.email ? `Email: ${cand.email}\n` : ''}\n` +
        ci.map(i => {
          let out = `## ${i.sessionName || fd(i.createdAt)}\n`
          if (i.summaryText) out += `### Resumen IA\n${i.summaryText}\n`
          if (i.transcriptEdited) out += `### Transcripción\n${i.transcriptEdited}\n`
          return out
        }).join('\n---\n\n')
    }).join('\n\n====\n\n')

    const handleExport = async () => {
      if (exportFormat === 'clipboard') {
        try { await navigator.clipboard.writeText(exportText); toast('Copiado al portapapeles', 'info', 'El texto ha sido copiado exitosamente.'); setShowExport(false) }
        catch { toast('No se pudo copiar', 'error') }
      } else if (exportFormat === 'txt') {
        const blob = new Blob([exportText], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = 'exportacion.txt'; a.click(); URL.revokeObjectURL(url)
        toast('Archivo descargado', 'success'); setShowExport(false)
      } else {
        if (!window.desktopApp?.exportPdf) { toast('PDF no disponible fuera de la app de escritorio', 'warning'); return }
        const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Exportación Call Transcriber</title><style>body{font-family:Arial,sans-serif;max-width:820px;margin:0 auto;padding:24px;color:#1a1a1a}h1{color:#2563eb;border-bottom:2px solid #2563eb;padding-bottom:8px;margin-top:32px}h2{color:#333;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px}h3{color:#555;margin-top:20px}p{line-height:1.7;margin:6px 0}hr{border:none;border-top:2px solid #eee;margin:32px 0}pre{white-space:pre-wrap;font-family:inherit}</style></head><body>${exportText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>').replace(/^# (.+)$/gm,'<h1>$1</h1>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^====<br>$/gm,'<hr>')}</body></html>`
        const candidateName = allCandidatesToExport[0]?.name ?? 'exportacion'
        const result = await window.desktopApp.exportPdf({ html, fileName: `${candidateName}.pdf` })
        if (result.ok) { toast('PDF guardado correctamente', 'success'); setShowExport(false) }
        else if (!result.cancelled) toast('Error al generar el PDF', 'error')
      }
    }

    const options: { key: 'pdf' | 'txt' | 'clipboard'; icon: string; title: string; desc: string }[] = [
      { key: 'pdf', icon: '≡', title: 'PDF', desc: 'Documento con diseño y formato' },
      { key: 'txt', icon: '✎', title: 'Texto plano (.txt)', desc: 'Sin formato, solo texto' },
      { key: 'clipboard', icon: '⎘', title: 'Copiar al portapapeles', desc: 'Copia el texto al clipboard' },
    ]

    return (
      <div className="modal-overlay" onClick={() => setShowExport(false)}>
        <div className="modal-box modal-box--figma exp-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <h2 className="modal-title">Exportar transcripción</h2>
              <p className="modal-subtitle">Selecciona el formato de exportación</p>
            </div>
            <button type="button" className="modal-close" onClick={() => setShowExport(false)}>✕</button>
          </div>
          <div className="modal-header-divider" />
          <div className="exp-options">
            {options.map(opt => (
              <button key={opt.key} type="button" className={`exp-option${exportFormat === opt.key ? ' exp-option--selected' : ''}`} onClick={() => setExportFormat(opt.key)}>
                <span className={`exp-option-icon${exportFormat === opt.key ? ' exp-option-icon--selected' : ''}`}>{opt.icon}</span>
                <div className="exp-option-text">
                  <span className={`exp-option-title${exportFormat === opt.key ? ' exp-option-title--selected' : ''}`}>{opt.title}</span>
                  <span className="exp-option-desc">{opt.desc}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="modal-footer-divider" />
          <div className="modal-actions modal-actions--figma">
            <button type="button" className="modal-cancel-btn" onClick={() => setShowExport(false)}>Cancelar</button>
            <button type="button" className="modal-action-btn" onClick={() => void handleExport()}>Exportar →</button>
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════ MAIN JSX ════

  if (authLoading) return (
    <div className="auth-root">
      <div className="auth-card" style={{ alignItems: 'center', gap: 16 }}>
        <span className="spinner" style={{ width: 28, height: 28 }} />
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>Iniciando...</p>
      </div>
    </div>
  )

  if (!session) return <AuthScreen />

  if (recoveryMode) return (
    <div className="auth-root">
      <div className="auth-right" style={{ width: '100%' }}>
        <div className="auth-card">
          <h2 className="auth-title">Nueva contraseña</h2>
          <p className="auth-sub">Elige una contraseña nueva para tu cuenta.</p>
          <div className="auth-form">
            <label className="auth-label">Nueva contraseña
              <input type="password" className="auth-input" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" autoFocus />
            </label>
            <label className="auth-label">Confirmar contraseña
              <input type="password" className="auth-input" value={newPasswordConfirm} onChange={e => setNewPasswordConfirm(e.target.value)} placeholder="Repetir contraseña" />
            </label>
            {recoveryError && <p className="auth-error">{recoveryError}</p>}
            <button className="auth-submit-btn" disabled={recoveryLoading} onClick={async () => {
              setRecoveryError('')
              if (newPassword.length < 6) { setRecoveryError('La contraseña debe tener al menos 6 caracteres.'); return }
              if (newPassword !== newPasswordConfirm) { setRecoveryError('Las contraseñas no coinciden.'); return }
              setRecoveryLoading(true)
              const { error } = await supabase.auth.updateUser({ password: newPassword })
              setRecoveryLoading(false)
              if (error) { setRecoveryError(error.message); return }
              setRecoveryMode(false)
            }}>
              {recoveryLoading ? <span className="spinner" /> : 'Guardar contraseña'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="app-shell">
      {/* Banner de actualización */}
      {updateStatus && (updateStatus.status === 'downloaded' || updateStatus.status === 'downloading') && (
        <div className={`update-banner update-banner--${updateStatus.status}`}>
          {updateStatus.status === 'downloading' ? (
            <span>Descargando actualización… {updateStatus.percent ?? 0}%</span>
          ) : (
            <>
              <span>Hay una nueva versión{updateStatus.version ? ` (${updateStatus.version})` : ''} lista para instalar.</span>
              <button type="button" className="update-banner__btn" onClick={() => void window.desktopApp?.installUpdate?.()}>
                Reiniciar e instalar
              </button>
              <button type="button" className="update-banner__dismiss" onClick={() => setUpdateStatus(null)} aria-label="Cerrar">✕</button>
            </>
          )}
        </div>
      )}
      {/* Global top bar */}
      <header className="global-top-bar">
        <div className="gtb-accent" />
        <div className="gtb-logo">
          <svg viewBox="0 0 80 80" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
            <rect width="80" height="80" rx="40" fill="#2563eb"/>
            <rect x="13" y="31" width="7" height="18" rx="2" fill="#ffffff"/>
            <rect x="25" y="25" width="7" height="30" rx="2" fill="#ffffff"/>
            <rect x="37" y="18" width="7" height="44" rx="2" fill="#ffffff"/>
            <rect x="49" y="25" width="7" height="30" rx="2" fill="#ffffff"/>
            <rect x="61" y="31" width="7" height="18" rx="2" fill="#ffffff"/>
          </svg>
          <span className="gtb-title">Call Transcriber</span>
          {appVersion && <span className="gtb-version">v{appVersion}</span>}
        </div>
      </header>

      <div className="app-body">
        {/* Sidebar */}
        {screen === 'candidate-detail' && activeProject ? (
          <aside className="sidebar sidebar--cands">
            <div className="csb-header">
              <button type="button" className="csb-back" onClick={() => setScreen('project-detail')}><ChevronLeft /></button>
              <span className="csb-project-name">{activeProject.name}</span>
            </div>
            <div className="csb-list">
              {projectCandidates.map(c => (
                <button key={c.id} type="button" className={`csb-item${c.id === activeCandidateId ? ' is-active' : ''}`} onClick={() => goToCandidate(c.id, activeProject.id)}>
                  <div className="csb-avatar" style={{ background: avatarColor(c.id) }}>{initials(c.name)}</div>
                  <div className="csb-info">
                    <span className="csb-name">{c.name}</span>
                    <span className="csb-role">{c.role || '—'}</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>
        ) : (
          <aside className="sidebar">
            <nav className="sidebar-nav">
              <button type="button" className={`nav-item${screen === 'dashboard' ? ' is-active' : ''}`} onClick={() => setScreen('dashboard')}><HomeIcon /><span>Inicio</span></button>
              <button type="button" className={`nav-item${(screen === 'projects' || screen === 'project-detail') ? ' is-active' : ''}`} onClick={() => setScreen('projects')}><FolderIcon /><span>Proyectos</span></button>
              <button type="button" className={`nav-item${(screen === 'candidates' || screen === 'candidate-detail') ? ' is-active' : ''}`} onClick={() => setScreen('candidates')}><UsersIcon /><span>Perfiles</span></button>
              <button type="button" className={`nav-item${screen === 'search' ? ' is-active' : ''}`} onClick={() => { setScreen('search'); setTimeout(() => document.getElementById('global-search-input')?.focus(), 50) }}><SearchIcon /><span>Buscar</span></button>
            </nav>
            <div className="sidebar-bottom">
              <button type="button" className="sidebar-user" onClick={() => setShowProfilePopup(p => !p)}>
                <div className="sidebar-avatar" style={{ background: userPhoto ? 'transparent' : undefined, padding: 0, overflow: 'hidden' }}>
                    {userPhoto ? <img src={userPhoto} alt="U" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : userInitials}
                  </div>
                <div className="sidebar-user-info">
                  <span className="sidebar-user-name">{userName || session?.user.email?.split('@')[0] || 'Usuario'}</span>
                  <span className="sidebar-user-email">{userEmail || session?.user.email || ''}</span>
                </div>
              </button>
            </div>
          </aside>
        )}

        {/* Main */}
        <div className="main-area">
          {screen !== 'dashboard' && (
            <header className="top-bar">
              <div className="breadcrumb">
                {breadcrumb.map((item, i) => (
                  <span key={i} className="bc-item">
                    {i > 0 && <span className="bc-sep"><ChevronRight /></span>}
                    {item.action ? <button type="button" className="bc-link" onClick={item.action}>{item.label}</button> : <span className="bc-current">{item.label}</span>}
                  </span>
                ))}
              </div>
            </header>
          )}
          <main className="content-area">
            {activeRecordingInterview ? renderRecordingScreen() : (
              <>
                {screen === 'dashboard' && renderDashboard()}
                {screen === 'projects' && renderProjects()}
                {screen === 'project-detail' && renderProjectDetail()}
                {screen === 'candidates' && renderCandidates()}
                {screen === 'candidate-detail' && renderCandidateDetail()}
                {screen === 'settings' && renderSettings()}
                {screen === 'profile' && renderProfile()}
                {screen === 'search' && renderSearch()}
              </>
            )}
          </main>
        </div>
      </div>

      {/* Profile popup */}
      {showProfilePopup && (
        <div className="profile-popup" onMouseLeave={() => setShowProfilePopup(false)}>
          <div className="pp-user">
            <div className="pp-avatar" style={{ background: userPhoto ? 'transparent' : avatarColor(userEmail || 'u'), overflow: 'hidden', padding: 0 }}>
              {userPhoto ? <img src={userPhoto} alt="U" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : userInitials}
            </div>
            <div><p className="pp-name">{userName || 'Usuario'}</p><p className="pp-email">{userEmail}</p></div>
          </div>
          <div className="pp-divider" />
          <button type="button" className="pp-item" onClick={() => { setSettingsNameDraft(userName); setSettingsEmailDraft(userEmail); setSettingsCompanyDraft(userCompany); setScreen('profile'); setProfileScreenTab('perfil'); setShowProfilePopup(false) }}><UserIcon /> Mi perfil</button>
          <button type="button" className="pp-item" onClick={() => { openSettings('general'); setShowProfilePopup(false) }}><SettingsIcon /> Configuración</button>
          <div className="pp-divider" />
          <button type="button" className="pp-item pp-item--danger" onClick={() => { setShowProfilePopup(false); void handleSignOut() }}>→ Cerrar sesión</button>
        </div>
      )}

      {/* Onboarding */}
      {showOnboarding && (
        <div className="modal-overlay">
          <div className="modal-box onboarding-box" onClick={e => e.stopPropagation()}>
            <div className="onboarding-logo"><div className="sidebar-logo-badge" style={{ width: 48, height: 48, fontSize: 18 }}>CT</div></div>
            <h2 style={{ textAlign: 'center', margin: 0 }}>Bienvenido a Call Transcriber</h2>
            <p style={{ textAlign: 'center', margin: 0 }}>Para empezar necesitas una API Key de Groq. Es gratuita.</p>
            <label className="modal-label">Tu Groq API Key
              <input type="password" className="modal-input" value={onboardingKeyDraft} onChange={e => setOnboardingKeyDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && onboardingKeyDraft.trim()) void handleOnboardingSave() }} placeholder="gsk_..." autoFocus />
            </label>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>¿Cómo obtengo mi clave? → <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>console.groq.com</a></p>
            <div className="modal-actions" style={{ justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="primary-btn" style={{ width: '100%', padding: '12px' }} onClick={() => void handleOnboardingSave()} disabled={!onboardingKeyDraft.trim()}>Empezar a grabar →</button>
              <button type="button" style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }} onClick={() => { setShowOnboarding(false); localStorage.setItem(ONBOARDING_KEY, '1') }}>Configurar más tarde</button>
            </div>
          </div>
        </div>
      )}

      {/* Session name modal */}
      {showSessionNameModal && (
        <div className="modal-overlay">
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h2>Nombrar sesión</h2>
            <p>¿Cómo quieres llamar a esta sesión?</p>
            <label className="modal-label">Nombre<input type="text" className="modal-input" value={sessionNameDraft} onChange={e => setSessionNameDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void handleConfirmSessionName() }} placeholder="Ej: Primera entrevista técnica (opcional)" autoFocus /></label>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Si lo dejas en blanco se usará la fecha y hora como nombre.</p>
            <div className="modal-actions">
              <button type="button" className="primary-btn" onClick={() => void handleConfirmSessionName()}>Guardar</button>
              {discardConfirming ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--error)' }}>¿Seguro? El audio se perderá.</span>
                  <button type="button" style={{ color: 'var(--error)', fontWeight: 600 }} onClick={() => void handleDiscardRecording()}>Sí, descartar</button>
                  <button type="button" onClick={() => setDiscardConfirming(false)}>Cancelar</button>
                </div>
              ) : (
                <button type="button" onClick={() => setDiscardConfirming(true)}>Descartar grabación</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Candidate modal */}
      {(showNewCandidate || editingCandidateId !== null) && (
        <div className="modal-overlay" onClick={() => { setShowNewCandidate(false); setEditingCandidateId(null); setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft(''); setCandidateStatusDraft('pendiente'); setCandidateConsentDraft(false) }}>
          <div className="modal-box modal-box--figma" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">{editingCandidateId ? 'Editar perfil' : 'Nuevo perfil'}</h2>
                <p className="modal-subtitle">Añade los datos de la persona a entrevistar</p>
              </div>
              <button type="button" className="modal-close" onClick={() => { setShowNewCandidate(false); setEditingCandidateId(null); setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft(''); setCandidateStatusDraft('pendiente'); setCandidateConsentDraft(false) }}>✕</button>
            </div>
            <div className="modal-header-divider" />
            <div className="modal-field">
              <span className="modal-field-label">Nombre completo *</span>
              <input type="text" className="modal-input modal-input--figma" value={candidateDraft.name} onChange={e => setCandidateDraft(d => ({ ...d, name: e.target.value }))} placeholder="Ej: Ana García" autoFocus />
            </div>
            <div className="modal-row-2">
              <div className="modal-field">
                <span className="modal-field-label">Email</span>
                <input type="email" className="modal-input modal-input--figma" value={candidateDraft.email} onChange={e => setCandidateDraft(d => ({ ...d, email: e.target.value }))} placeholder="ana@email.com" />
              </div>
              <div className="modal-field">
                <span className="modal-field-label">Teléfono</span>
                <input type="text" className="modal-input modal-input--figma" value={candidateDraft.phone} onChange={e => setCandidateDraft(d => ({ ...d, phone: e.target.value }))} placeholder="+34 600 000 000" />
              </div>
            </div>
            <div className="modal-field">
              <span className="modal-field-label">Cargo</span>
              <input type="text" className="modal-input modal-input--figma" value={candidateDraft.role} onChange={e => setCandidateDraft(d => ({ ...d, role: e.target.value }))} placeholder="Ej: Desarrollador Frontend" />
            </div>
            <div className="modal-field">
              <span className="modal-field-label">Notas previas (opcional)</span>
              <textarea className="modal-input modal-input--figma modal-textarea" value={candidateNotesDraft} onChange={e => setCandidateNotesDraft(e.target.value)} placeholder="Puntos a tratar, perfil del CV, observaciones..." rows={3} />
            </div>
            <div className="modal-field">
              <span className="modal-field-label">Estado</span>
              <select className="modal-input modal-input--figma modal-select" value={candidateStatusDraft} onChange={e => setCandidateStatusDraft(e.target.value as Candidate['candidateStatus'])}>
                <option value="pendiente">⬜ Pendiente</option>
                <option value="apto">✅ Apto</option>
                <option value="finalista">⭐ Finalista</option>
                <option value="descartado">❌ Descartado</option>
              </select>
            </div>
            <div className="modal-field">
              <label className="consent-check">
                <input type="checkbox" checked={candidateConsentDraft} onChange={e => setCandidateConsentDraft(e.target.checked)} />
                <span>El candidato ha sido informado y <strong>consiente</strong> la grabación, transcripción y tratamiento de la entrevista (incluido su envío a servicios de IA en EE.&nbsp;UU.) conforme a la política de privacidad.</span>
              </label>
            </div>
            <div className="modal-footer-divider" />
            <div className="modal-actions modal-actions--figma">
              <button type="button" className="modal-cancel-btn" onClick={() => { setShowNewCandidate(false); setEditingCandidateId(null); setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft(''); setCandidateStatusDraft('pendiente'); setCandidateConsentDraft(false) }}>Cancelar</button>
              <button type="button" className="modal-action-btn" onClick={editingCandidateId ? handleUpdateCandidate : handleCreateCandidate} disabled={!candidateDraft.name.trim()}>{editingCandidateId ? <><UserIcon /> Guardar cambios</> : <><UserIcon /> Añadir perfil</>}</button>
            </div>
          </div>
        </div>
      )}

      {/* Audio setup modal */}
      {showAudioSetupModal && (
        <div className="modal-overlay" onClick={() => setShowAudioSetupModal(false)}>
          <div className="modal-box modal-box--figma" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Nueva grabación</h2>
                <p className="modal-subtitle">Elige qué quieres grabar</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setShowAudioSetupModal(false)}>✕</button>
            </div>
            <div className="modal-header-divider" />
            <div className="rec-option-cards">
              <button
                type="button"
                className={`rec-option-card${!pendingRecordVideo ? ' rec-option-card--active' : ''}`}
                onClick={() => setPendingRecordVideo(false)}
              >
                <span className="rec-option-icon">🎙️</span>
                <span className="rec-option-title">Solo audio</span>
                <span className="rec-option-desc">Graba solo el sonido: tu micro + el audio de la llamada.</span>
              </button>
              <button
                type="button"
                className={`rec-option-card${pendingRecordVideo ? ' rec-option-card--active' : ''}`}
                onClick={() => setPendingRecordVideo(true)}
              >
                <span className="rec-option-icon">🎥</span>
                <span className="rec-option-title">Llamada entera (vídeo + audio)</span>
                <span className="rec-option-desc">Graba también la pantalla. Al empezar eliges qué ventana.</span>
              </button>
            </div>
            {pendingRecordVideo && (
              <div className="rec-video-banner">🎥 Al empezar se te pedirá elegir qué pantalla o ventana grabar.</div>
            )}
            <div className="modal-field" style={{ marginTop: 16 }}>
              <span className="modal-field-label">Micrófono</span>
              <select
                className="modal-input modal-input--figma modal-select"
                value={pendingMicId}
                onChange={e => setPendingMicId(e.target.value)}
              >
                {micDevices.length === 0
                  ? <option value="">Sin dispositivos detectados</option>
                  : micDevices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)
                }
              </select>
            </div>
            <div className="modal-field" style={{ marginTop: 12 }}>
              <span className="modal-field-label">Altavoces / audio de la llamada</span>
              <select
                className="modal-input modal-input--figma modal-select"
                value={pendingOutputId}
                onChange={e => setPendingOutputId(e.target.value)}
              >
                {outputDevices.length === 0
                  ? <option value="">Sin dispositivos detectados</option>
                  : outputDevices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)
                }
              </select>
            </div>
            <div className="modal-footer-divider" />
            <div className="modal-actions modal-actions--figma">
              <button type="button" className="modal-cancel-btn" onClick={() => setShowAudioSetupModal(false)}>Cancelar</button>
              <button type="button" className="modal-action-btn" onClick={handleConfirmRecordingSetup} disabled={!pendingMicId}><MicIcon /> Iniciar grabación</button>
            </div>
          </div>
        </div>
      )}

      {/* Capture source picker (screen/window) */}
      {captureSources && (
        <div className="modal-overlay" onClick={() => pickCaptureSource(null)}>
          <div className="modal-box modal-box--figma source-picker-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Elige qué compartir</h2>
                <p className="modal-subtitle">Selecciona la ventana o pantalla que quieres grabar</p>
              </div>
              <button type="button" className="modal-close" onClick={() => pickCaptureSource(null)}>✕</button>
            </div>
            <div className="modal-header-divider" />
            {captureSources.length === 0 ? (
              <p className="tab-note">No se encontraron ventanas o pantallas disponibles.</p>
            ) : (
              <div className="source-picker-grid">
                {captureSources.map(s => (
                  <button key={s.id} type="button" className="source-picker-item" onClick={() => pickCaptureSource(s.id)}>
                    <span className="source-picker-thumb">
                      {s.thumbnail ? <img src={s.thumbnail} alt={s.name} /> : <span className="source-picker-thumb-fallback">🖥️</span>}
                    </span>
                    <span className="source-picker-name">{s.name || 'Sin nombre'}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="modal-footer-divider" />
            <div className="modal-actions modal-actions--figma">
              <button type="button" className="modal-cancel-btn" onClick={() => pickCaptureSource(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Project modal */}
      {showNewProject && (
        <div className="modal-overlay" onClick={() => { setShowNewProject(false); setProjectDraft(EMPTY_PROJECT);  }}>
          <div className="modal-box modal-box--figma" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Nuevo proyecto</h2>
                <p className="modal-subtitle">Define el proceso de selección que vas a gestionar</p>
              </div>
              <button type="button" className="modal-close" onClick={() => { setShowNewProject(false); setProjectDraft(EMPTY_PROJECT);  }}>✕</button>
            </div>
            <div className="modal-header-divider" />
            <div className="modal-field">
              <span className="modal-field-label">Nombre del proyecto *</span>
              <input type="text" className="modal-input modal-input--figma" value={projectDraft.name} onChange={e => setProjectDraft(d => ({ ...d, name: e.target.value }))} placeholder="Ej: Administrativo/a Seguros" autoFocus />
            </div>
            <div className="modal-row-2">
              <div className="modal-field">
                <span className="modal-field-label">Empresa / Cliente *</span>
                <input type="text" className="modal-input modal-input--figma" value={projectDraft.company} onChange={e => setProjectDraft(d => ({ ...d, company: e.target.value }))} placeholder="Ej: Cosmobrok" />
              </div>
              <div className="modal-field">
                <span className="modal-field-label">Tipo de proceso</span>
                <select className="modal-input modal-input--figma modal-select"><option value="">Seleccionar tipo...</option><option>Selección directa</option><option>ETT</option><option>Headhunting</option></select>
              </div>
            </div>
            <div className="modal-field">
              <span className="modal-field-label">Criterios de evaluación del resumen</span>
              <p className="modal-field-hint">Selecciona qué aspectos quieres que se analicen en el resumen de cada candidato</p>
              {renderCriteriaGrid(
                projectDraft.evaluationCriteria,
                updated => setProjectDraft(d => ({ ...d, evaluationCriteria: updated }))
              )}
            </div>
            <div className="modal-footer-divider" />
            <div className="modal-actions modal-actions--figma">
              <button type="button" className="modal-cancel-btn" onClick={() => { setShowNewProject(false); setProjectDraft(EMPTY_PROJECT);  }}>Cancelar</button>
              <button type="button" className="modal-action-btn" onClick={handleCreateProject} disabled={!projectDraft.name.trim()}>Crear proyecto</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit project modal */}
      {showEditProject && (
        <div className="modal-overlay" onClick={() => { setShowEditProject(false); setEditingProjectId(null); setProjectDraft(EMPTY_PROJECT) }}>
          <div className="modal-box modal-box--figma" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Editar proyecto</h2>
                <p className="modal-subtitle">Modifica los datos y criterios del proyecto</p>
              </div>
              <button type="button" className="modal-close" onClick={() => { setShowEditProject(false); setEditingProjectId(null); setProjectDraft(EMPTY_PROJECT) }}>✕</button>
            </div>
            <div className="modal-header-divider" />
            <div className="modal-field">
              <span className="modal-field-label">Nombre del proyecto *</span>
              <input type="text" className="modal-input modal-input--figma" value={projectDraft.name} onChange={e => setProjectDraft(d => ({ ...d, name: e.target.value }))} placeholder="Ej: Administrativo/a Seguros" autoFocus />
            </div>
            <div className="modal-row-2">
              <div className="modal-field">
                <span className="modal-field-label">Empresa / Cliente</span>
                <input type="text" className="modal-input modal-input--figma" value={projectDraft.company} onChange={e => setProjectDraft(d => ({ ...d, company: e.target.value }))} placeholder="Ej: Cosmobrok" />
              </div>
              <div className="modal-field">
                <span className="modal-field-label">Estado</span>
                <select className="modal-input modal-input--figma modal-select" value={projectDraft.status} onChange={e => setProjectDraft(d => ({ ...d, status: e.target.value as 'active' | 'closed' }))}>
                  <option value="active">Activo</option>
                  <option value="closed">Cerrado</option>
                </select>
              </div>
            </div>
            <div className="modal-field">
              <span className="modal-field-label">Criterios de evaluación del resumen</span>
              <p className="modal-field-hint">Selecciona qué aspectos quieres que se analicen en el resumen de cada candidato</p>
              {renderCriteriaGrid(
                projectDraft.evaluationCriteria,
                updated => setProjectDraft(d => ({ ...d, evaluationCriteria: updated }))
              )}
            </div>
            <div className="modal-footer-divider" />
            <div className="modal-actions modal-actions--figma">
              <button type="button" className="modal-cancel-btn" onClick={() => { setShowEditProject(false); setEditingProjectId(null); setProjectDraft(EMPTY_PROJECT) }}>Cancelar</button>
              <button type="button" className="modal-action-btn" onClick={handleSaveEditProject} disabled={!projectDraft.name.trim()}>Guardar cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* Recording screen is rendered above app-body */}

      {/* Transcribing modal */}
      {renderTranscribingModal()}

      {/* Export modal */}
      {renderExportModal()}

      {/* Hidden photo input */}
      <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(t => {
          const icons: Record<Toast['type'], string> = { success: '✓', error: '✕', info: '⎘', warning: '⚠' }
          return (
            <div key={t.id} className={`toast toast--${t.type}`}>
              <div className="toast-accent" />
              <span className="toast-icon">{icons[t.type]}</span>
              <div className="toast-body">
                <span className="toast-title">{t.message}</span>
                {t.sub && <span className="toast-sub">{t.sub}</span>}
              </div>
              <button type="button" className="toast-close" onClick={() => setToasts(x => x.filter(x2 => x2.id !== t.id))}>✕</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default App
