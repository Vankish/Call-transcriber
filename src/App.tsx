import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import type { DbCandidate, DbInterview, DbProject } from './lib/supabase'
import { buscarUsuarioPorCorreo, compartirProyecto, dejarDeCompartir, listarComparticiones } from './lib/sharing'
import type { ProjectShare, SharedUser } from './lib/sharing'
import { PROFILE_SORT_LABELS, isProfileSort, lastInterviewMap, sortProfiles } from './lib/sortProfiles'
import type { ProfileSort } from './lib/sortProfiles'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BellIcon,
  CameraIcon,
  CheckIcon,
  ChevronLeft,
  ChevronRight,
  CircleIcon,
  ClipboardIcon,
  CloseIcon,
  CloudIcon,
  CloudUploadIcon,
  DocIcon,
  DotFilled,
  DotRing,
  DownloadIcon,
  FolderIcon,
  GridViewIcon,
  HomeIcon,
  InfoIcon,
  KeyIcon,
  ListViewIcon,
  LockIcon,
  LogoutIcon,
  MicIcon,
  MonitorIcon,
  PauseIconSm,
  PencilIcon,
  PlayIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  SquareFilled,
  StarIcon,
  TargetIcon,
  TrashIcon,
  UploadIcon,
  UserIcon,
  UsersIcon,
  VideoIcon,
  WarnTriangle,
} from './icons'
import { Select } from './Select'
import { AuthScreen } from './AuthScreen'

// ── Types ──────────────────────────────────────────────────────────────────
// `ownerId` = quién creó la carpeta. Con las carpetas compartidas ya no basta
// con "todo lo que veo es mío": hay que poder distinguir lo propio de lo que
// otra persona te ha dejado ver, para no ofrecer botones que la base de datos
// va a rechazar (renombrar, borrar, repartir accesos).
type Project = { id: string; ownerId: string; name: string; company: string; createdAt: string; status: 'active' | 'closed'; evaluationCriteria: string[]; interviewers: string[] }

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
type Candidate = { id: string; projectId: string; createdAt: string; name: string; email: string; phone: string; role: string; notes: string; candidateStatus: 'pendiente' | 'apto' | 'descartado' | 'finalista'; consentGiven: boolean; consentAt: string | null }
type ProfileTab = 'entrevistas' | 'transcripcion' | 'resumen'
type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped'
type Interview = {
  // ownerId = dueño de la entrevista. Imprescindible para el audio: en Storage
  // la ruta empieza por la carpeta del dueño, así que sin esto una entrevista de
  // un proyecto compartido se buscaría en la carpeta equivocada y "no existiría".
  id: string; ownerId: string; candidateId: string; createdAt: string; sessionName: string
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
  summaryContext: SummaryContext
  interviewerName: string
  // true = los audios de esta entrevista están en Supabase Storage y por tanto
  // se pueden recuperar desde cualquier PC. false = viven solo en el que grabó.
  audioUploaded: boolean
}
type AudioSyncState = 'uploading' | 'downloading' | 'error'
type AudioDeviceOption = { id: string; name: string }
type Toast = { id: string; message: string; sub?: string; type: 'success' | 'error' | 'info' | 'warning' }
type Screen = 'dashboard' | 'projects' | 'project-detail' | 'candidate-detail' | 'candidates' | 'settings' | 'profile' | 'search'
type ProfileScreenTab = 'perfil' | 'plan' | 'seguridad' | 'notif'
type SettingsTab = 'api-keys' | 'grabacion' | 'general'

// ── Motores de IA ──────────────────────────────────────────────────────────
// El catálogo de proveedores vive en electron/providers.cjs y llega por IPC.
// Aquí solo están los valores por defecto (Groq, que es gratis) y los ayudantes
// para saber si un motor está listo para usarse.
const DEFAULT_STT_CFG: ProviderConfig = { provider: 'groq', apiKey: '', model: 'whisper-large-v3' }
const DEFAULT_LLM_CFG: ProviderConfig = { provider: 'groq', apiKey: '', model: 'openai/gpt-oss-120b' }

type ProviderTest = { ok: boolean; detail: string } | 'testing' | null

const findPreset = (presets: ProviderPreset[] | undefined, id: string) => presets?.find(p => p.id === id)

/** Un motor está listo si tiene modelo, clave (salvo que el proveedor no la pida)
 *  y, en el caso de un servicio personalizado, una URL. */
const isProviderReady = (cfg: ProviderConfig, preset: ProviderPreset | undefined) => {
  if (!cfg.model.trim()) return false
  if (cfg.provider === 'custom' && !cfg.baseUrl?.trim()) return false
  return preset?.noKey ? true : Boolean(cfg.apiKey.trim())
}

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

const INTERVIEWERS_KEY = 'ct-interviewers-cache'
const getInterviewersCache = (): Record<string, string[]> => {
  try { return JSON.parse(localStorage.getItem(INTERVIEWERS_KEY) ?? '{}') } catch { return {} }
}
const saveInterviewersCache = (projectId: string, interviewers: string[]) => {
  const cache = getInterviewersCache()
  cache[projectId] = interviewers
  localStorage.setItem(INTERVIEWERS_KEY, JSON.stringify(cache))
}

// Enfoque del resumen por llamada (Entrevista de selección / Reunión de negocio).
// Vivía solo en localStorage sin sincronizar entre equipos; ahora es un campo más
// de la entrevista en Supabase. SUMMARY_CONTEXT_KEY se conserva solo para migrar
// una vez el cache antiguo del navegador la primera vez que carguen los datos.
const SUMMARY_CONTEXT_KEY = 'ct-summary-context'
type SummaryContext = 'entrevista' | 'reunion'

const getLegacySummaryContexts = (): Record<string, SummaryContext> => {
  try { return JSON.parse(localStorage.getItem(SUMMARY_CONTEXT_KEY) ?? '{}') } catch { return {} }
}

// El vídeo de una entrevista solo se guarda en local (nunca sube a Supabase, pesa
// demasiado), así que su ruta también hay que cachearla en local: si no, se pierde
// cada vez que la app recarga las entrevistas desde la nube (que no sabe de vídeos).
// Notas ya extraídas de una conversación larga. Se guardan aquí y no en Supabase
// a propósito: son un intermedio reconstruible, ocupan bastante, y valen solo
// para el equipo donde se prepararon.
//
// La huella evita el peor fallo posible: redactar un informe sobre las notas de
// una transcripción que ya no existe. Si se edita la transcripción o se cambia
// de entrevista a reunión, las notas dejan de valer y se rehacen.
const SUMMARY_NOTES_KEY = 'ct-summary-notes'
type NotasPreparadas = { notas: string; huella: string; recortado: boolean }
const huellaTranscripcion = (texto: string, contexto: string) => {
  // No hace falta criptografía, solo detectar que el texto ha cambiado. Se mezcla
  // la longitud con una suma rodante barata sobre todo el contenido.
  let h = 0
  for (let i = 0; i < texto.length; i++) h = (Math.imul(31, h) + texto.charCodeAt(i)) | 0
  return `${contexto}:${texto.length}:${h}`
}
const getNotesCache = (): Record<string, NotasPreparadas> => {
  try { return JSON.parse(localStorage.getItem(SUMMARY_NOTES_KEY) ?? '{}') } catch { return {} }
}
const saveNotesCache = (interviewId: string, entry: NotasPreparadas | null) => {
  const cache = getNotesCache()
  if (entry) cache[interviewId] = entry
  else delete cache[interviewId]
  try { localStorage.setItem(SUMMARY_NOTES_KEY, JSON.stringify(cache)) } catch {
    // Si el almacén local se llena, no vale la pena romper nada: sin notas
    // guardadas el resumen sigue funcionando, solo que tarda lo de siempre.
  }
}

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
// Tiempo restante en lenguaje de persona. Se redondea al alza y en minutos a
// partir del minuto: prometer "2 min" y tardar 2:30 molesta menos que prometer
// "1 min 47 s" y fallar por segundos en una estimación que ya es aproximada.
const formatEta = (sec: number) => sec < 60
  ? `${Math.max(5, Math.round(sec / 5) * 5)} s`
  : `${Math.ceil(sec / 60)} min`
const fmtDate = (iso: string, locale = 'es-ES') => new Date(iso).toLocaleString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const fmtShort = (iso: string, locale = 'es-ES') => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
const getExt = (mime: string) => mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'bin'

// ── Audios en la nube ──────────────────────────────────────────────────────
// Bucket privado de Supabase Storage. Las rutas son {dueño}/{interview_id}/{archivo}.
// OJO: la primera carpeta es la del DUEÑO de la entrevista, no la de quien está
// usando la app. En una carpeta compartida son personas distintas, y buscar el
// audio en la carpeta equivocada equivale a que "no exista". Los permisos del
// bucket contemplan los dos casos (ver supabase-migration-compartir.sql).
const RECORDINGS_BUCKET = 'recordings'
// Las grabaciones antiguas guardaban la ruta absoluta en vez del nombre; en la nube
// solo se usa el nombre, o las barras crearían carpetas fantasma.
const baseName = (stored: string) => stored.split(/[\\/]/).pop() ?? stored
const cloudAudioKey = (userId: string, interviewId: string, fileName: string) => `${userId}/${interviewId}/${fileName}`
const audioMime = (fileName: string) => /\.mp3$/i.test(fileName) ? 'audio/mpeg' : /\.webm$/i.test(fileName) ? 'audio/webm' : /\.ogg$/i.test(fileName) ? 'audio/ogg' : /\.mp4|\.m4a$/i.test(fileName) ? 'audio/mp4' : 'application/octet-stream'
const initials = (name: string) => name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
const AVATAR_COLORS = ['#2563eb', '#10b981', '#f59e33', '#eb4566', '#8b5cf6', '#ec4899']
const avatarColor = (id: string) => AVATAR_COLORS[id.charCodeAt(id.length - 1) % AVATAR_COLORS.length]

const EMPTY_PROJECT = { name: '', company: '', status: 'active' as const, evaluationCriteria: [] as string[], interviewers: [] as string[] }
const EMPTY_CANDIDATE = { name: '', email: '', phone: '', role: '' }

function normalizeInterviews(arr: Interview[]): Interview[] {
  return arr.map(i => ({
    ...i,
    // Las entrevistas guardadas antes de que existieran las carpetas compartidas
    // no traen dueño. Vacío = "de quien tenga la sesión abierta", que es lo que
    // eran cuando se guardaron.
    ownerId: i.ownerId ?? '',
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
    summaryContext: i.summaryContext ?? 'entrevista',
    interviewerName: i.interviewerName ?? '',
  }))
}

// Los perfiles guardados antes de que existiera `createdAt` no lo traen. Se deja
// vacío a propósito en vez de inventar la fecha de hoy: un perfil viejo fingiendo
// ser de hoy se colaría arriba del todo al ordenar por recientes. Al ordenar, un
// createdAt vacío cae a la fecha de su última entrevista (ver profileActivity).
function normalizeCandidates(arr: Candidate[]): Candidate[] {
  return arr.map(c => ({ ...c, createdAt: c.createdAt ?? '' }))
}

// Igual que arriba: los proyectos que ya estaban en este equipo antes de las
// carpetas compartidas no tienen dueño guardado.
function normalizeProjects(arr: Project[]): Project[] {
  return arr.map(p => ({ ...p, ownerId: p.ownerId ?? '' }))
}

// ── DB ↔ App converters ────────────────────────────────────────────────────────
const projFromDb  = (r: DbProject):   Project   => ({ id: r.id, ownerId: r.user_id, name: r.name, company: r.company, createdAt: r.created_at, status: r.status as Project['status'], evaluationCriteria: (r.evaluation_criteria as string[] | undefined) ?? [], interviewers: (r.interviewers as string[] | undefined) ?? [] })
const candFromDb  = (r: DbCandidate): Candidate => ({ id: r.id, projectId: r.project_id, createdAt: r.created_at ?? '', name: r.name, email: r.email, phone: r.phone, role: r.role, notes: r.notes ?? '', candidateStatus: (r.candidate_status as Candidate['candidateStatus']) ?? 'pendiente', consentGiven: r.consent_given ?? false, consentAt: r.consent_at ?? null })
const ivFromDb    = (r: DbInterview): Interview => ({
  id: r.id, ownerId: r.user_id, candidateId: r.candidate_id, createdAt: r.created_at,
  sessionName: r.session_name, status: r.status as RecordingStatus,
  durationSec: r.duration_sec, micDeviceId: r.mic_device_id, outputDeviceId: r.output_device_id,
  transcriptOriginal: r.transcript_original, transcriptEdited: r.transcript_edited,
  transcriptUpdatedAt: r.transcript_updated_at, recordingUrl: null, recordingFilePath: r.recording_file_path, videoFilePath: null,
  // El nombre de la pista de sistema ya viaja por la nube; la caché local de
  // localStorage sigue existiendo solo para entrevistas anteriores a esa columna.
  systemAudioFilePath: r.system_audio_file_name || null,
  audioUploaded: r.audio_uploaded ?? false,
  captureSource: r.capture_source as Interview['captureSource'],
  transcriptionStatus: r.transcription_status as Interview['transcriptionStatus'],
  summaryInstructions: r.summary_instructions, summaryText: r.summary_text,
  summaryStatus: r.summary_status as Interview['summaryStatus'],
  summaryType: r.summary_type as Interview['summaryType'],
  summaryContext: (r.summary_context as SummaryContext | undefined) ?? 'entrevista',
  interviewerName: r.interviewer_name ?? '',
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
  if (patch.summaryContext        !== undefined) db.summary_context       = patch.summaryContext
  if (patch.interviewerName       !== undefined) db.interviewer_name      = patch.interviewerName
  if (patch.systemAudioFilePath   !== undefined) db.system_audio_file_name = patch.systemAudioFilePath ?? ''
  if (patch.audioUploaded         !== undefined) db.audio_uploaded        = patch.audioUploaded
  return db
}


const EmptyState = ({ icon, title, sub, btnLabel, onBtn }: { icon?: React.ReactNode; title: string; sub: string; btnLabel?: string; onBtn?: () => void }) => (
  <div className="empty-state">
    <div className="es-circle"><span className="es-icon">{icon ?? <TargetIcon />}</span></div>
    <h3 className="es-title">{title}</h3>
    <p className="es-sub">{sub}</p>
    {btnLabel && onBtn && <button type="button" className="primary-btn pill-btn es-btn" onClick={onBtn}>{btnLabel}</button>}
  </div>
)

// Estado del candidato. Estaba repetido en tres pantallas con los colores y las
// etiquetas copiados a mano; ahora vive en un sitio.
const CANDIDATE_STATUS: Record<string, { bg: string; color: string; icon: ReactNode; label: string }> = {
  apto:       { bg: '#d1fae5', color: '#065f46', icon: <CheckIcon size={11} />, label: 'Apto' },
  finalista:  { bg: '#dbeafe', color: '#1d4ed8', icon: <StarIcon size={11} />,  label: 'Finalista' },
  descartado: { bg: '#fee2e2', color: '#991b1b', icon: <CloseIcon size={11} />, label: 'Descartado' },
}

const CandidateStatusPill = ({ status }: { status: Candidate['candidateStatus'] }) => {
  const s = CANDIDATE_STATUS[status]
  if (!s) return null
  return <span className="cand-pill" style={{ background: s.bg, color: s.color }}>{s.icon} {s.label}</span>
}

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

const SortSelect = ({ value, onChange }: { value: ProfileSort; onChange: (v: ProfileSort) => void }) => (
  <label className="sort-select">
    <span className="sort-select-label">Ordenar</span>
    <Select
      className="sort-select-input"
      value={value}
      onChange={v => onChange(v as ProfileSort)}
      options={(Object.keys(PROFILE_SORT_LABELS) as ProfileSort[]).map(k => ({ value: k, label: PROFILE_SORT_LABELS[k] }))}
    />
  </label>
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
  const [profilesSort, setProfilesSort] = useState<ProfileSort>(() => {
    const saved = localStorage.getItem('ct-profiles-sort')
    return isProfileSort(saved) ? saved : 'recent'
  })

  // ── Interview selection ────────────────────────────────────────────────
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null)
  const [transcriptDraft, setTranscriptDraft] = useState('')

  // ── Progreso del resumen ───────────────────────────────────────────────
  // Un resumen de una llamada larga son varios minutos, casi todos esperando la
  // cuota por minuto del proveedor. Sin señales de vida parece que se ha colgado.
  const [summaryProgress, setSummaryProgress] = useState<SummaryProgress | null>(null)
  // Entrevistas cuya conversación se está leyendo en segundo plano tras transcribir.
  const [preparingIds, setPreparingIds] = useState<string[]>([])
  // Solo para repintar cuando se guardan notas nuevas: la verdad vive en el cache.
  const [notesReadyTick, setNotesReadyTick] = useState(0)
  // Solo para repintar la cuenta atrás. Corre únicamente mientras se espera cuota,
  // que es cuando hay un número en pantalla que cambia solo.
  const [, setClockTick] = useState(0)

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
  // Motores de IA: transcripción y resumen se configuran por separado, cada uno
  // con su proveedor, su clave y su modelo. Ver electron/providers.cjs.
  const [sttCfg, setSttCfg] = useState<ProviderConfig>(DEFAULT_STT_CFG)
  const [llmCfg, setLlmCfg] = useState<ProviderConfig>(DEFAULT_LLM_CFG)
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog | null>(null)
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [userCompany, setUserCompany] = useState('')
  const [autoTranscribe, setAutoTranscribe] = useState(false)
  const [notifTranscription, setNotifTranscription] = useState(true)
  const [notifSummary, setNotifSummary] = useState(true)
  const [notifErrors, setNotifErrors] = useState(true)

  // ── Settings drafts ────────────────────────────────────────────────────
  const [sttDraft, setSttDraft] = useState<ProviderConfig>(DEFAULT_STT_CFG)
  const [llmDraft, setLlmDraft] = useState<ProviderConfig>(DEFAULT_LLM_CFG)
  const [sameKeyForLlm, setSameKeyForLlm] = useState(false)
  const [sttTest, setSttTest] = useState<ProviderTest>(null)
  const [llmTest, setLlmTest] = useState<ProviderTest>(null)
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
  // Subidas/bajadas de audio en curso, por id de entrevista. Solo para pintar el
  // estado en la interfaz; la verdad de si un audio está en la nube es
  // interview.audioUploaded.
  const [audioSync, setAudioSync] = useState<Record<string, AudioSyncState>>({})
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
  const [projectDraft, setProjectDraft] = useState<{ name: string; company: string; status: 'active' | 'closed'; evaluationCriteria: string[]; interviewers: string[] }>(EMPTY_PROJECT)
  const [newInterviewerDraft, setNewInterviewerDraft] = useState('')
  // ── Compartir carpetas con compañeros ────────────────────────────────────
  // `shares` son todos los accesos que ve este usuario: los que él ha repartido
  // y los que le han dado a él. Ver src/lib/sharing.ts y
  // supabase-migration-compartir.sql.
  const [shares, setShares] = useState<ProjectShare[]>([])
  const [shareEmailDraft, setShareEmailDraft] = useState('')
  const [shareBuscando, setShareBuscando] = useState(false)
  const [shareEncontrado, setShareEncontrado] = useState<SharedUser | null>(null)
  const [shareError, setShareError] = useState('')
  const [candidateDraft, setCandidateDraft] = useState(EMPTY_CANDIDATE)
  const [showSessionNameModal, setShowSessionNameModal] = useState(false)
  const [sessionNameDraft, setSessionNameDraft] = useState('')
  // Entrevistador elegido en el modal de "Nombrar sesión", y el proyecto del que
  // sacar la lista. Se guarda el id al abrir el modal porque para entonces la
  // grabación ya ha parado y activeRecordingInterview vale null.
  const [sessionInterviewerDraft, setSessionInterviewerDraft] = useState('')
  const [sessionModalProjectId, setSessionModalProjectId] = useState<string | null>(null)
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
  // Desde donde se abrio el perfil. Si vienes de "Perfiles" (la lista de todos),
  // el panel de la izquierda tiene que seguir siendo esa lista: antes saltaba a
  // la del proyecto y aparecia gente de otro proceso sin venir a cuento.
  const [candidateFrom, setCandidateFrom] = useState<'project' | 'all'>('project')
  // OJO: el tipo de proceso se elige pero no se guarda en el proyecto. Estaba asi
  // desde antes (el <select> no tenia ni value ni onChange); queda pendiente de
  // decidir si se persiste o se quita del modal.
  const [projectTypeDraft, setProjectTypeDraft] = useState('')
  const [repairingVideoId, setRepairingVideoId] = useState<string | null>(null)
  const [videoReloadKey, setVideoReloadKey] = useState(0)
  const [videoTime, setVideoTime] = useState({ current: 0, total: 0 })
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
  const [sourcePickerTab, setSourcePickerTab] = useState<'screen' | 'window'>('screen')
  const [videoPlaybackRate, setVideoPlaybackRate] = useState(1)
  const [videoVolume, setVideoVolume] = useState(1)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Segundo al que hay que saltar en cuanto el audio tenga metadatos, cuando la
  // reproducción se lanza desde una marca de tiempo de la transcripción.
  const pendingSeekRef = useRef<number | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  // De qué entrevista es el vídeo que hay ahora mismo en pantalla, para no mandar
  // un salto de tiempo al vídeo equivocado.
  const videoElInterviewRef = useRef<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const localDataLoaded = useRef(false)

  // ── Derived ────────────────────────────────────────────────────────────
  const activeProject = projects.find(p => p.id === activeProjectId) ?? null
  const activeCandidate = candidates.find(c => c.id === activeCandidateId) ?? null
  const projectCandidates = useMemo(() => candidates.filter(c => c.projectId === activeProjectId), [candidates, activeProjectId])

  // ── Orden de los perfiles ──────────────────────────────────────────────
  const lastInterviewAt = useMemo(() => lastInterviewMap(interviews), [interviews])
  const sortByPref = useCallback(
    (list: Candidate[]) => sortProfiles(list, profilesSort, lastInterviewAt),
    [profilesSort, lastInterviewAt])

  // La misma lista que se ve en la pantalla "Perfiles", para que el panel de la
  // izquierda no cambie de contenido al abrir a alguien desde ahi.
  const sidebarAllCandidates = useMemo(() => sortByPref(candidates), [candidates, sortByPref])

  const changeProfilesSort = useCallback((v: ProfileSort) => {
    setProfilesSort(v)
    localStorage.setItem('ct-profiles-sort', v)
  }, [])

  const filteredCandidates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const list = !q ? projectCandidates
      : projectCandidates.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.role.toLowerCase().includes(q))
    return sortByPref(list)
  }, [projectCandidates, searchQuery, sortByPref])
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
  const sessionModalProject = sessionModalProjectId ? projects.find(p => p.id === sessionModalProjectId) ?? null : null
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
      if (event === 'SIGNED_OUT') { setProjects([]); setCandidates([]); setInterviews([]); setShares([]) }
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
            // Solo se reclama como propio lo que no tiene dueño (creado en este
            // equipo sin sesión). Una carpeta compartida por otra persona nunca
            // llega hasta aquí, pero si llegara, intentar apropiársela lo único
            // que consigue es un error de permisos de Supabase.
            const projs = (d.projects ?? []).filter(p => !p.ownerId || p.ownerId === userId); const cands = normalizeCandidates(d.candidates ?? []); const ivs = normalizeInterviews(d.interviews ?? []).filter(i => !i.ownerId || i.ownerId === userId)
            if (projs.length) await supabase.from('projects').upsert(projs.map(p => ({ id: p.id, user_id: userId, name: p.name, company: p.company, status: p.status, evaluation_criteria: p.evaluationCriteria ?? [], interviewers: p.interviewers ?? [], created_at: p.createdAt })), { onConflict: 'id' })
            if (cands.length) await supabase.from('candidates').upsert(cands.map(c => ({ id: c.id, user_id: userId, project_id: c.projectId, name: c.name, email: c.email, phone: c.phone, role: c.role, notes: c.notes ?? '', candidate_status: c.candidateStatus ?? 'pendiente', consent_given: c.consentGiven ?? false, consent_at: c.consentAt ?? null, created_at: c.createdAt || new Date().toISOString() })), { onConflict: 'id' })
            for (const iv of ivs) {
              const cand = cands.find(c => c.id === iv.candidateId)
              if (!cand) continue
              await supabase.from('interviews').upsert({ id: iv.id, user_id: userId, candidate_id: iv.candidateId, project_id: cand.projectId, session_name: iv.sessionName, status: iv.status, duration_sec: iv.durationSec, mic_device_id: iv.micDeviceId, output_device_id: iv.outputDeviceId, transcript_original: iv.transcriptOriginal, transcript_edited: iv.transcriptEdited, transcript_updated_at: iv.transcriptUpdatedAt, recording_file_path: iv.recordingFilePath, capture_source: iv.captureSource, transcription_status: iv.transcriptionStatus, summary_instructions: iv.summaryInstructions, summary_text: iv.summaryText, summary_status: iv.summaryStatus, summary_type: iv.summaryType, summary_context: iv.summaryContext ?? 'entrevista', interviewer_name: iv.interviewerName ?? '', created_at: iv.createdAt, updated_at: iv.createdAt }, { onConflict: 'id' })
            }
            if (projs.length || cands.length || ivs.length) { localStorage.removeItem(V2_KEY); toast('Datos de este equipo sincronizados a la nube') }
          }
        } catch { /* si el merge falla, seguimos y cargamos lo que haya en la nube */ }

        // OJO: aquí ya NO se filtra por user_id. Con las carpetas compartidas, lo
        // que puedes ver lo decide Supabase con sus reglas de permisos (RLS), no
        // esta consulta: pide "todo" y la base de datos devuelve lo tuyo más lo
        // que te hayan compartido. Filtrar aquí por user_id volvería a esconder
        // justamente lo compartido. Ver supabase-migration-compartir.sql.
        const [pRes, cRes, iRes, prRes, sharesRes] = await Promise.all([
          supabase.from('projects').select('*').order('created_at'),
          supabase.from('candidates').select('*').order('created_at'),
          supabase.from('interviews').select('*').order('created_at'),
          supabase.from('profiles').select('*').eq('id', userId).single(),
          listarComparticiones(),
        ])
        setShares(sharesRes)
        if (pRes.error) { toast(`Error cargando proyectos: ${pRes.error.message}`, 'error'); return }
        if (cRes.error) { toast(`Error cargando perfiles: ${cRes.error.message}`, 'error'); return }
        const hasRemote = (pRes.data?.length ?? 0) > 0 || (cRes.data?.length ?? 0) > 0
        if (hasRemote) {
          const criteriaCache = getCriteriaCache()
          const updatedCache: Record<string, string[]> = {}
          const interviewersCache = getInterviewersCache()
          const updatedInterviewersCache: Record<string, string[]> = {}
          const loadedProjects = (pRes.data ?? []).map(r => {
            let p = projFromDb(r)
            if (p.evaluationCriteria.length > 0) {
              // Supabase tiene datos: es la fuente de verdad, actualizamos cache
              updatedCache[p.id] = p.evaluationCriteria
            } else {
              // Supabase devuelve vacío (columna sin datos o no existe): usamos cache local
              const cached = criteriaCache[p.id]
              if (cached) p = { ...p, evaluationCriteria: cached }
            }
            if (p.interviewers.length > 0) {
              updatedInterviewersCache[p.id] = p.interviewers
            } else {
              const cachedIv = interviewersCache[p.id]
              if (cachedIv) p = { ...p, interviewers: cachedIv }
            }
            return p
          })
          // Persistir los caches actualizados desde Supabase
          if (Object.keys(updatedCache).length > 0) {
            localStorage.setItem(CRITERIA_KEY, JSON.stringify({ ...criteriaCache, ...updatedCache }))
          }
          if (Object.keys(updatedInterviewersCache).length > 0) {
            localStorage.setItem(INTERVIEWERS_KEY, JSON.stringify({ ...interviewersCache, ...updatedInterviewersCache }))
          }
          setProjects(loadedProjects)
          setCandidates((cRes.data ?? []).map(candFromDb))
          if (iRes.error) {
            toast(`Error cargando entrevistas: ${iRes.error.message}`, 'error')
          } else {
            const videoPathCache = getVideoPathCache()
            const systemAudioPathCache = getSystemAudioPathCache()
            // Modo de resumen (Entrevista/Reunión): migración única desde el cache
            // local antiguo, por si aquí había una preferencia que Supabase todavía
            // no conoce (columna recién creada o nunca sincronizada desde este PC).
            const legacyContexts = getLegacySummaryContexts()
            const loadedInterviews = normalizeInterviews((iRes.data ?? []).map(r => {
              const iv = ivFromDb(r)
              const legacyCtx = legacyContexts[iv.id]
              return {
                ...iv,
                videoFilePath: videoPathCache[iv.id] ?? iv.videoFilePath,
                // La nube manda; la caché local solo cubre las entrevistas
                // anteriores a que el nombre de la pista de sistema se guardara allí.
                systemAudioFilePath: iv.systemAudioFilePath ?? systemAudioPathCache[iv.id] ?? null,
                summaryContext: legacyCtx ?? iv.summaryContext,
              }
            }))
            setInterviews(loadedInterviews)
            if (Object.keys(legacyContexts).length > 0) {
              for (const iv of loadedInterviews) {
                const legacyCtx = legacyContexts[iv.id]
                if (legacyCtx) await supabase.from('interviews').update({ summary_context: legacyCtx }).eq('id', iv.id)
              }
              localStorage.removeItem(SUMMARY_CONTEXT_KEY)
            }
          }
        } else {
          // First login: migrate localStorage data to Supabase
          const raw = localStorage.getItem(V2_KEY)
          if (raw) {
            try {
              const d = JSON.parse(raw) as { projects?: Project[]; candidates?: Candidate[]; interviews?: Interview[] }
              const projs = d.projects ?? []; const cands = normalizeCandidates(d.candidates ?? []); const ivs = normalizeInterviews(d.interviews ?? [])
              if (projs.length || cands.length) {
                if (projs.length) await supabase.from('projects').insert(projs.map(p => ({ id: p.id, user_id: userId, name: p.name, company: p.company, status: p.status, evaluation_criteria: p.evaluationCriteria ?? [], interviewers: p.interviewers ?? [], created_at: p.createdAt })))
                if (cands.length) await supabase.from('candidates').insert(cands.map(c => ({ id: c.id, user_id: userId, project_id: c.projectId, name: c.name, email: c.email, phone: c.phone, role: c.role, notes: '' })))
                for (const iv of ivs) {
                  const cand = cands.find(c => c.id === iv.candidateId)
                  if (!cand) continue
                  await supabase.from('interviews').insert({ id: iv.id, user_id: userId, candidate_id: iv.candidateId, project_id: cand.projectId, session_name: iv.sessionName, status: iv.status, duration_sec: iv.durationSec, mic_device_id: iv.micDeviceId, output_device_id: iv.outputDeviceId, transcript_original: iv.transcriptOriginal, transcript_edited: iv.transcriptEdited, transcript_updated_at: iv.transcriptUpdatedAt, recording_file_path: iv.recordingFilePath, capture_source: iv.captureSource, transcription_status: iv.transcriptionStatus, summary_instructions: iv.summaryInstructions, summary_text: iv.summaryText, summary_status: iv.summaryStatus, summary_type: iv.summaryType, summary_context: iv.summaryContext ?? 'entrevista', interviewer_name: iv.interviewerName ?? '', created_at: iv.createdAt, updated_at: iv.createdAt })
                }
                setProjects(normalizeProjects(projs)); setCandidates(cands); setInterviews(ivs)
                localStorage.removeItem(V2_KEY)
                toast('Datos migrados a la nube')
              }
            } catch { /* ignore migration errors */ }
          }
        }
        if (prRes.data) {
          const p = prRes.data
          if (p.name)          setUserName(p.name)
          if (p.company)       setUserCompany(p.company)
          if (p.photo)         setUserPhoto(p.photo)
          // Los motores de IA (proveedor + clave + modelo) NO se leen de la nube:
          // viven solo en el config.json local. La nube guarda el nombre del modelo
          // a título informativo, pero aplicarlo aquí podría dejar una combinación
          // imposible — p.ej. proveedor Deepgram con un modelo de Whisper.
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
        setProjects(normalizeProjects(d.projects ?? []))
        setCandidates(normalizeCandidates(d.candidates ?? []))
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
      // El proceso principal ya entrega stt/llm migrados desde el formato antiguo
      // si hacía falta (ver providers.migrateConfig).
      setSttCfg(cfg.stt ?? DEFAULT_STT_CFG)
      setLlmCfg(cfg.llm ?? DEFAULT_LLM_CFG)
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

  // ── Catálogo de proveedores (lo sirve el proceso principal) ─────────────
  useEffect(() => {
    if (!window.desktopApp?.getProviderCatalog) return
    void window.desktopApp.getProviderCatalog().then(setProviderCatalog).catch(() => {})
  }, [])

  const sttPreset = findPreset(providerCatalog?.stt, sttCfg.provider)
  const llmPreset = findPreset(providerCatalog?.llm, llmCfg.provider)
  // Antes de que llegue el catálogo se asume que hace falta clave, que es el caso
  // de casi todos: así no se habilitan botones que luego fallarían.
  const sttReady = isProviderReady(sttCfg, sttPreset)
  const llmReady = isProviderReady(llmCfg, llmPreset)

  // ── Show onboarding if no engine configured ────────────────────────────
  useEffect(() => {
    if (!configLoaded) return
    const done = localStorage.getItem(ONBOARDING_KEY)
    if (!done && !sttReady) setShowOnboarding(true)
  }, [configLoaded, sttReady])

  // (data loaded from Supabase via the auth effect above)

  // ── Load user photo ────────────────────────────────────────────────────
  useEffect(() => { const p = localStorage.getItem('ct-user-photo'); if (p) setUserPhoto(p) }, [])

  useEffect(() => window.desktopApp?.onSummaryProgress?.(setSummaryProgress), [])

  useEffect(() => {
    if (!summaryProgress?.esperaHasta) return
    const id = setInterval(() => setClockTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [summaryProgress?.esperaHasta])

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
    window.desktopApp?.onCaptureSources?.(sources => {
      setCaptureSources(sources)
      setSourcePickerTab(sources.some(s => s.type === 'screen') ? 'screen' : 'window')
    })
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
      setRecordingMessage('Solicitando permisos…')
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
          // frameRate baja a propósito: esto es una captura de pantalla de referencia para
          // revisar la llamada después, no vídeo de acción — grabar a la frecuencia nativa
          // del monitor (30/60/144Hz) hace que Chromium tenga que codificar vídeo por software
          // a esa misma cadencia durante TODA la llamada, y eso es lo que se comía la CPU/GPU
          // y acababa notándose en todo el PC en llamadas largas.
          sysStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { frameRate: { ideal: 8, max: 12 } } })
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

      if (!recordVideo && videoTrack) {
        // getDisplayMedia obliga a pedir vídeo para poder acceder al audio "loopback"
        // del sistema, pero si no vamos a grabar pantalla esa pista de captura se queda
        // viva sin nadie consumiéndola. Chromium sigue capturando fotogramas de la
        // pantalla entera igualmente, y eso va acumulando carga de CPU/GPU cuanto más
        // dura la llamada — el PC entero se nota más lento y se llega a congelar en
        // llamadas largas. Al no necesitar los fotogramas, se para la pista ya mismo.
        videoTrack.stop()
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

        // Los nombres de archivo que se acaban de guardar. Se anotan aquí porque
        // updateInterview actualiza el estado de React de forma asíncrona y la
        // subida a la nube (al final de esta función) los necesita ya.
        let savedAudioName: string | null = null
        let savedSystemName: string | null = null

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
              savedAudioName = fileName
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
              savedSystemName = systemFileName
              updateInterview(iv.id, { systemAudioFilePath: systemFileName })
              saveSystemAudioPathCache(iv.id, systemFileName)
            }
          } catch { /* ignore */ }
        }

        const wasDiscarded = discardedInterviewIdsRef.current.has(iv.id)
        discardedInterviewIdsRef.current.delete(iv.id)

        // Subida a la nube en segundo plano, para que la grabación esté disponible
        // en el otro equipo. `iv` es el objeto de antes de grabar, así que hay que
        // releer la entrevista ya con las rutas que se acaban de guardar.
        if (!wasDiscarded && savedAudioName) {
          void uploadInterviewAudio({ ...iv, recordingFilePath: savedAudioName, systemAudioFilePath: savedSystemName }, { silent: true })
        }

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
        setSessionNameDraft('')
        setSessionInterviewerDraft(iv.interviewerName || '')
        setSessionModalProjectId(ivCandidate?.projectId ?? null)
        setShowSessionNameModal(true)
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
      id: uid(), ownerId: session?.user.id ?? '', candidateId: activeCandidateId, createdAt: new Date().toISOString(),
      sessionName: defaultName, status: 'stopped', durationSec: 0,
      micDeviceId: '', outputDeviceId: '',
      transcriptOriginal: '', transcriptEdited: '', transcriptUpdatedAt: null,
      recordingUrl: null, recordingFilePath: filePath, videoFilePath: null, systemAudioFilePath: null,
      captureSource: 'none', transcriptionStatus: 'pending',
      summaryInstructions: '', summaryText: '', summaryStatus: 'idle', summaryType: 'resumen',
      summaryContext: 'entrevista', interviewerName: '', audioUploaded: false,
    }
    setInterviews(c => [n, ...c])
    setSelectedInterviewId(n.id)
    if (session) {
      supabase.from('interviews').insert({ id: n.id, user_id: session.user.id, candidate_id: n.candidateId, project_id: activeCandidate.projectId, session_name: n.sessionName, status: n.status, duration_sec: 0, mic_device_id: '', output_device_id: '', transcript_original: '', transcript_edited: '', transcript_updated_at: null, recording_url: null, recording_file_path: fileName, capture_source: 'none', transcription_status: 'pending', summary_instructions: '', summary_text: '', summary_status: 'idle', summary_type: 'resumen', summary_context: 'entrevista', interviewer_name: '', created_at: n.createdAt, updated_at: n.createdAt })
        .then(({ error }) => { if (error) toast(`Error al guardar importación en la nube: ${error.message}`, 'error') })
    }
    toast(`Audio importado: ${fileName}`)
    if (autoTranscribe) void handleTranscribe(n.id)
  }

  const handleConfirmRecordingSetup = () => {
    if (!activeCandidateId || !activeCandidate || !pendingMicId) return
    setShowAudioSetupModal(false)
    const n: Interview = { id: uid(), ownerId: session?.user.id ?? '', candidateId: activeCandidateId, createdAt: new Date().toISOString(), sessionName: '', status: 'idle', durationSec: 0, micDeviceId: pendingMicId, outputDeviceId: pendingOutputId, transcriptOriginal: '', transcriptEdited: '', transcriptUpdatedAt: null, recordingUrl: null, recordingFilePath: null, videoFilePath: null, systemAudioFilePath: null, captureSource: 'none', transcriptionStatus: 'pending', summaryInstructions: '', summaryText: '', summaryStatus: 'idle', summaryType: 'resumen', summaryContext: 'entrevista', interviewerName: '', audioUploaded: false }
    setInterviews(c => [n, ...c])
    if (session) {
      supabase.from('interviews').insert({ id: n.id, user_id: session.user.id, candidate_id: n.candidateId, project_id: activeCandidate.projectId, session_name: '', status: n.status, duration_sec: 0, mic_device_id: n.micDeviceId, output_device_id: n.outputDeviceId, transcript_original: '', transcript_edited: '', transcript_updated_at: null, recording_url: null, recording_file_path: null, capture_source: n.captureSource, transcription_status: n.transcriptionStatus, summary_instructions: '', summary_text: '', summary_status: n.summaryStatus, summary_type: n.summaryType, summary_context: n.summaryContext, interviewer_name: n.interviewerName, created_at: n.createdAt, updated_at: n.createdAt })
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
    updateInterview(iId, { sessionName: finalName, interviewerName: sessionInterviewerDraft, ...(blob ? { recordingUrl: URL.createObjectURL(blob) } : {}) })
    setSessionModalProjectId(null); setSessionInterviewerDraft('')
    activeInterviewIdRef.current = null
    toast('Grabación guardada')
  }

  // ── Transcription / Summary ────────────────────────────────────────────
  const handleTranscribe = async (interviewId: string, language?: string) => {
    const interview = interviews.find(i => i.id === interviewId)
    // Estas salidas eran mudas: al pulsar "Transcribir" no pasaba nada y no había
    // forma de saber por qué. Cada una dice ahora qué falta.
    if (!interview) { toast('No se encuentra la entrevista', 'error'); return }
    if (!interview.recordingFilePath) { toast('Esta entrevista no tiene grabación asociada', 'error'); return }
    if (!window.desktopApp?.transcribeAudio) { toast('La transcripción solo funciona en la app de escritorio', 'error'); return }
    if (!sttReady) { toast('Configura un motor de transcripción', 'error', 'Ajustes → Motores de IA'); return }
    // Si el audio se grabó en el otro equipo, se baja de la nube antes de seguir.
    // `systemPath` es la pista solo-sistema (voz limpia del interlocutor): su
    // presencia activa la separación determinista de hablantes en el backend.
    const audio = await ensureLocalAudio(interview)
    if (!audio) {
      toast('No se encuentra el audio de esta entrevista', 'error',
        interview.audioUploaded ? 'Falló la descarga desde la nube' : 'Se grabó en otro equipo y no se subió a la nube')
      return
    }
    const { filePath: fullPath, systemFilePath: systemPath } = audio
    const candidateName = candidates.find(c => c.id === interview.candidateId)?.name ?? ''
    const interviewerName = (interview.interviewerName || userName || '').trim()
    updateInterview(interviewId, { transcriptionStatus: 'transcribing' })
    try {
      const result = await window.desktopApp.transcribeAudio({ filePath: fullPath, systemFilePath: systemPath ?? undefined, language: language ?? txLang, candidateName, interviewerName })
      updateInterview(interviewId, { transcriptOriginal: result.text, transcriptEdited: result.text, transcriptionStatus: 'done' })
      if (selectedInterviewId === interviewId) setTranscriptDraft(result.text)
      if (notifTranscription) toast('Transcripción completada')
      // La lectura de la conversación arranca sola aquí. Sin await: transcribir ya
      // ha terminado y esto es un adelanto que corre por detrás.
      void prepareSummaryNotes(interviewId, result.text, interview?.summaryContext ?? 'entrevista')
    } catch (err) {
      updateInterview(interviewId, { transcriptionStatus: 'error' })
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      if (notifErrors) toast('Error al transcribir', 'error', msg)
    }
  }

  /** Lee la conversación y guarda las notas, sin redactar nada todavía.
   *
   *  Es la parte cara: de las ~11 peticiones que cuesta resumir una llamada de
   *  una hora, 10 son esto. Hacerlo al acabar de transcribir mueve la espera a un
   *  momento en el que nadie la mira, y de propina deja el regenerar en segundos:
   *  las notas no dependen del tipo de informe ni de los criterios. */
  const prepareSummaryNotes = async (interviewId: string, transcript: string, contexto: SummaryContext) => {
    if (!window.desktopApp?.prepareSummary || !transcript.trim()) return
    const huella = huellaTranscripcion(transcript, contexto)
    if (getNotesCache()[interviewId]?.huella === huella) return   // ya preparada
    // Si ya se está redactando un informe de esta entrevista, ese camino saca las
    // notas por su cuenta y las guarda al terminar. Prepararlas ahora en paralelo
    // sería pagar dos veces exactamente el mismo trabajo.
    if (interviews.find(i => i.id === interviewId)?.summaryStatus === 'generating') return
    setPreparingIds(ids => ids.includes(interviewId) ? ids : [...ids, interviewId])
    try {
      const iv = interviews.find(i => i.id === interviewId)
      const cand = candidates.find(c => c.id === iv?.candidateId)
      const proj = cand ? projects.find(p => p.id === cand.projectId) : null
      const res = await window.desktopApp.prepareSummary({
        interviewId, transcript,
        criteria: proj?.evaluationCriteria ?? [],
        summaryType: iv?.summaryType ?? 'resumen',
        summaryContext: contexto,
        candidateName: cand?.name ?? '',
        interviewerName: (iv?.interviewerName || userName || '').trim(),
      })
      // `needed: false` = cabía de una vez. No se guarda nada: no hay atajo que dar.
      if (res.needed && res.notes) {
        saveNotesCache(interviewId, { notas: res.notes, huella, recortado: !!res.recortado })
        setNotesReadyTick(t => t + 1)
      }
    } catch (err) {
      // Preparar es un adelanto, no un paso obligatorio: si falla, el resumen
      // sigue funcionándole al usuario por el camino largo de siempre. Molestarle
      // con un error por algo que no ha pedido no aporta nada.
      console.error('No se pudieron preparar las notas del resumen:', err)
    } finally {
      setPreparingIds(ids => ids.filter(id => id !== interviewId))
    }
  }

  const handleGenerateSummary = async (interviewId: string) => {
    const interview = interviews.find(i => i.id === interviewId)
    if (!interview || !window.desktopApp?.generateSummary) return
    const candidate = candidates.find(c => c.id === interview.candidateId)
    const project = candidate ? projects.find(p => p.id === candidate.projectId) : null
    const criteria = project?.evaluationCriteria ?? []
    const interviewerName = (interview.interviewerName || userName || '').trim()
    updateInterview(interviewId, { summaryStatus: 'generating' })
    setSummaryProgress(null)
    try {
      const contexto = interview.summaryContext ?? 'entrevista'
      const guardadas = getNotesCache()[interviewId]
      const huella = huellaTranscripcion(interview.transcriptEdited, contexto)
      // Solo valen si son de ESTA transcripción y de este enfoque. Si no coinciden
      // se ignoran y se hace el camino largo, que sigue funcionando igual.
      const notasPreparadas = guardadas?.huella === huella ? guardadas.notas : null
      const result = await window.desktopApp.generateSummary({ interviewId, transcript: interview.transcriptEdited, criteria, summaryType: interview.summaryType, summaryContext: contexto, candidateName: candidate?.name ?? '', interviewerName, notasPreparadas })
      updateInterview(interviewId, { summaryText: result.text, summaryStatus: 'done' })
      // Si ha habido que trocear, las notas vienen de vuelta: se guardan para que
      // el próximo informe sobre esta misma conversación salga en segundos.
      if (result.notes) {
        saveNotesCache(interviewId, { notas: result.notes, huella, recortado: !!result.recortado })
        setNotesReadyTick(t => t + 1)
      }
      if (notifSummary) toast('Resumen generado')
    } catch (err) {
      updateInterview(interviewId, { summaryStatus: 'error' })
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      if (notifErrors) toast('Error al generar resumen', 'error', msg)
    } finally {
      setSummaryProgress(null)
    }
  }

  // ── Playback ───────────────────────────────────────────────────────────
  const stopAudio = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; audioRef.current = null }
    setPlayingInterviewId(null); setPlaybackProgress(0); setPlaybackCurrentTime(0); setPlaybackDuration(0)
  }

  const handleTogglePlayback = async (interview: Interview, startAt?: number) => {
    // Con startAt no se alterna: se salta a ese punto, esté sonando o no.
    // Esto va ANTES de tocar el archivo: si ya está sonando no hay nada que bajar.
    if (playingInterviewId === interview.id) {
      if (startAt === undefined) { stopAudio(); return }
      handleSeek(startAt)
      void audioRef.current?.play()
      return
    }
    // Puede estar solo en la nube si se grabó en el otro equipo.
    let src = interview.recordingUrl
    if (!src) {
      const audioFiles = await ensureLocalAudio(interview)
      if (!audioFiles) {
        toast('No se encuentra el audio de esta entrevista', 'error',
          interview.audioUploaded ? 'Falló la descarga desde la nube' : 'Se grabó en otro equipo y no se subió a la nube')
        return
      }
      src = 'file:///' + audioFiles.filePath.replace(/\\/g, '/')
    }
    stopAudio()
    if (startAt !== undefined) pendingSeekRef.current = startAt
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
      // Salto pedido desde una marca de tiempo de la transcripción. Se aplica al
      // final a propósito: el sondeo de duración de abajo mueve el cursor y lo pisaría.
      const applyPendingSeek = () => {
        const at = pendingSeekRef.current
        pendingSeekRef.current = null
        if (at === null) return false
        audio.currentTime = at
        setPlaybackCurrentTime(at)
        return true
      }
      if (isFinite(audio.duration) && audio.duration > 0) { applyDuration(); applyPendingSeek(); return }
      // Forzar el cálculo de la duración real con un seek al final, una sola vez.
      probing = true
      const onProbe = () => {
        audio.removeEventListener('timeupdate', onProbe)
        probing = false
        if (!applyPendingSeek()) audio.currentTime = 0
        applyDuration()
      }
      audio.addEventListener('timeupdate', onProbe)
      audio.currentTime = 1e101
    }
    audio.onended = audio.onerror = () => { setPlayingInterviewId(null); setPlaybackProgress(0); setPlaybackCurrentTime(0); setPlaybackDuration(0) }
    void audio.play(); setPlayingInterviewId(interview.id)
  }

  // Los vídeos grabados (MediaRecorder → webm) reportan duration=Infinity hasta que se
  // "busca" hasta el final una vez — mismo problema que ya se arregló para el audio
  // (ver handleTogglePlayback). Sin esto, la barra de progreso NATIVA del <video controls>
  // no puede calcular la posición y no se mueve hasta que el usuario hace clic manualmente
  // en la barra (eso fuerza a Chromium a resolver la duración real de rebote).
  const fixVideoDuration = (el: HTMLVideoElement) => {
    el.onloadedmetadata = () => {
      if (isFinite(el.duration) && el.duration > 0) return
      const onProbe = () => { el.removeEventListener('timeupdate', onProbe); el.currentTime = 0 }
      el.addEventListener('timeupdate', onProbe)
      el.currentTime = 1e101
    }
  }

  // El sondeo de arriba deja la duración "finita", pero no la REAL: mientras el
  // archivo no lleve la duración en la cabecera, el navegador la estima sobre lo
  // que lleva leído y la barra avanza a saltos (llega al final en segundos y luego
  // se arrastra). La cabecera se escribe ahora al guardar, así que esto solo repara
  // las grabaciones anteriores, la primera vez que se abren.

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

  // Doble clic en la transcripción → saltar al momento en que se dijo eso.
  //
  // La transcripción es un textarea editable, así que no se pueden poner enlaces
  // dentro. Pero como cada turno empieza por su marca [mm:ss], basta con buscar
  // hacia atrás desde donde está el cursor la última marca que haya: esa es la del
  // turno en el que se ha hecho doble clic.
  const handleTranscriptSeek = (el: HTMLTextAreaElement, iv: Interview) => {
    const marks = [...el.value.slice(0, el.selectionStart).matchAll(/\[(?:(\d+):)?(\d{1,2}):(\d{2})\]/g)]
    const last = marks[marks.length - 1]
    if (!last) return
    const sec = (last[1] ? parseInt(last[1], 10) * 3600 : 0) + parseInt(last[2], 10) * 60 + parseInt(last[3], 10)
    // Si el vídeo de esta entrevista está en pantalla manda el vídeo: es donde está mirando.
    const video = videoElRef.current
    if (videoElInterviewRef.current === iv.id && video) {
      video.currentTime = sec
      void video.play()
      return
    }
    void handleTogglePlayback(iv, sec)
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
    if (interview) void deleteCloudAudio(interview)
    saveVideoPathCache(interviewId, null)
    saveNotesCache(interviewId, null)
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
    candidateInterviewIds.forEach(i => { if (i.recordingFilePath && window.desktopApp?.deleteRecording) { const fp = resolveAudioPath(i.recordingFilePath); if (fp) void window.desktopApp.deleteRecording({ filePath: fp }) }; if (i.videoFilePath && window.desktopApp?.deleteRecording) { const fp = resolveAudioPath(i.videoFilePath); if (fp) void window.desktopApp.deleteRecording({ filePath: fp }) }; if (i.systemAudioFilePath && window.desktopApp?.deleteRecording) { const fp = resolveAudioPath(i.systemAudioFilePath); if (fp) void window.desktopApp.deleteRecording({ filePath: fp }) }; saveVideoPathCache(i.id, null); saveSystemAudioPathCache(i.id, null); saveNotesCache(i.id, null); void deleteCloudAudio(i) })
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
    // Una carpeta compartida solo la borra su dueño. El botón ya está oculto para
    // los demás, pero esto cubre atajos de teclado y estados raros: sin esto, la
    // app borraría la carpeta de la pantalla y Supabase la devolvería al recargar.
    if (!esMiProyecto(projects.find(p => p.id === projectId))) {
      toast('Esta carpeta no es tuya', 'warning', 'Solo quien la creó puede borrarla')
      setPendingDeleteId(null); return
    }
    if (pendingDeleteId !== projectId) { setPendingDeleteId(projectId); return }
    setPendingDeleteId(null)
    const projCandidates = candidates.filter(c => c.projectId === projectId)
    const projInterviewIds = interviews.filter(i => projCandidates.some(c => c.id === i.candidateId))
    projInterviewIds.forEach(i => { if (i.recordingFilePath && window.desktopApp?.deleteRecording) void window.desktopApp.deleteRecording({ filePath: i.recordingFilePath }); if (i.videoFilePath && window.desktopApp?.deleteRecording) void window.desktopApp.deleteRecording({ filePath: i.videoFilePath }); if (i.systemAudioFilePath && window.desktopApp?.deleteRecording) void window.desktopApp.deleteRecording({ filePath: i.systemAudioFilePath }); saveVideoPathCache(i.id, null); saveSystemAudioPathCache(i.id, null); saveNotesCache(i.id, null); void deleteCloudAudio(i) })
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
    const now = new Date().toISOString()
    const consentAt = candidateConsentDraft ? now : null
    const c: Candidate = { id: uid(), projectId: activeProjectId, createdAt: now, name: candidateDraft.name.trim(), email: candidateDraft.email.trim(), phone: candidateDraft.phone.trim(), role: candidateDraft.role.trim(), notes: candidateNotesDraft, candidateStatus: candidateStatusDraft, consentGiven: candidateConsentDraft, consentAt }
    setCandidates(curr => [...curr, c])
    setShowNewCandidate(false); setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft(''); setCandidateStatusDraft('pendiente'); setCandidateConsentDraft(false)
    if (session) {
      const { error } = await supabase.from('candidates').insert({ id: c.id, user_id: session.user.id, project_id: c.projectId, name: c.name, email: c.email, phone: c.phone, role: c.role, notes: candidateNotesDraft, candidate_status: candidateStatusDraft, consent_given: c.consentGiven, consent_at: c.consentAt, created_at: c.createdAt })
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

  // ── Compartir carpetas ─────────────────────────────────────────────────
  // Un proyecto sin dueño es de quien lo tenga delante: son las carpetas creadas
  // en este equipo antes de que existiera el compartir, o sin haber entrado con
  // cuenta. Solo el dueño puede renombrar, cerrar, borrar y repartir accesos; el
  // compañero invitado sí puede trabajar dentro (transcribir, resumir, editar).
  const esMiProyecto = (p: Project | null | undefined) =>
    !p ? false : !p.ownerId || p.ownerId === session?.user.id

  const comparticionesDe = (projectId: string) => shares.filter(sh => sh.projectId === projectId)

  const limpiarBuscadorCompartir = () => {
    setShareEmailDraft(''); setShareEncontrado(null); setShareError(''); setShareBuscando(false)
  }

  const handleBuscarCompanero = async () => {
    setShareBuscando(true); setShareError(''); setShareEncontrado(null)
    const res = await buscarUsuarioPorCorreo(shareEmailDraft)
    setShareBuscando(false)
    if (!res.ok) { setShareError(res.message); return }
    // Ya tenía acceso: se avisa aquí en vez de dejar que falle el insert.
    if (editingProjectId && comparticionesDe(editingProjectId).some(sh => sh.sharedWithId === res.user.id)) {
      setShareError('Esa persona ya tiene acceso a este proyecto'); return
    }
    setShareEncontrado(res.user)
  }

  const handleDarAcceso = async () => {
    if (!shareEncontrado || !editingProjectId || !session) return
    const res = await compartirProyecto({ projectId: editingProjectId, ownerId: session.user.id, user: shareEncontrado })
    if (!res.ok) { setShareError(res.message); return }
    setShares(c => [...c, res.share])
    limpiarBuscadorCompartir()
    toast(`${shareEncontrado.name} ya puede ver este proyecto`, 'success', 'Tendrá que cerrar y abrir su app para verlo')
  }

  // Píldora de la tarjeta de proyecto: "de quién es esta carpeta". Solo aparece
  // cuando hay algo que contar, para no ensuciar las carpetas normales.
  const renderSharedBadge = (p: Project) => {
    if (!esMiProyecto(p)) {
      const mia = comparticionesDe(p.id).find(sh => sh.sharedWithId === session?.user.id)
      return <span className="shared-badge" title="Otra persona te ha dado acceso a esta carpeta"><UsersIcon /> Compartido por {mia?.ownerName || 'un compañero'}</span>
    }
    const con = comparticionesDe(p.id).length
    if (con === 0) return null
    return <span className="shared-badge shared-badge--owner" title="Has dado acceso a esta carpeta"><UsersIcon /> Compartido con {con}</span>
  }

  const handleQuitarAcceso = async (share: ProjectShare) => {
    const res = await dejarDeCompartir(share.id)
    if (!res.ok) { toast('No se pudo quitar el acceso', 'error', res.message); return }
    setShares(c => c.filter(x => x.id !== share.id))
    toast(`${share.sharedWithName} ya no tiene acceso`)
  }

  const updateProject = (id: string, changes: Partial<Project>) => {
    setProjects(c => c.map(p => p.id === id ? { ...p, ...changes } : p))
    if (changes.evaluationCriteria !== undefined) saveCriteriaCache(id, changes.evaluationCriteria)
    if (changes.interviewers       !== undefined) saveInterviewersCache(id, changes.interviewers)
    if (session) {
      const db: Record<string, unknown> = {}
      if (changes.name               !== undefined) db.name                = changes.name
      if (changes.company            !== undefined) db.company             = changes.company
      if (changes.status             !== undefined) db.status              = changes.status
      if (changes.evaluationCriteria !== undefined) db.evaluation_criteria = changes.evaluationCriteria
      if (changes.interviewers       !== undefined) db.interviewers        = changes.interviewers
      supabase.from('projects').update(db).eq('id', id)
        .then(({ error }) => { if (error) toast(`Error sincronizando proyecto: ${error.message}`, 'error') }, () => {})
    }
  }

  const handleCreateProject = async () => {
    if (!projectDraft.name.trim()) return
    const p: Project = { id: uid(), ownerId: session?.user.id ?? '', name: projectDraft.name.trim(), company: projectDraft.company.trim(), createdAt: new Date().toISOString(), status: projectDraft.status, evaluationCriteria: projectDraft.evaluationCriteria, interviewers: projectDraft.interviewers }
    setProjects(c => [...c, p])
    setShowNewProject(false); setProjectDraft(EMPTY_PROJECT)
    if (session) {
      const { error } = await supabase.from('projects').insert({ id: p.id, user_id: session.user.id, name: p.name, company: p.company, status: p.status, evaluation_criteria: p.evaluationCriteria, interviewers: p.interviewers, created_at: p.createdAt })
      if (error) { toast(`Error guardando proyecto: ${error.message}`, 'error'); setProjects(c => c.filter(x => x.id !== p.id)); return }
    }
    toast(`Proyecto ${p.name} creado`)
  }

  const handleSaveEditProject = () => {
    if (!editingProjectId || !projectDraft.name.trim()) return
    // Renombrar, cerrar o cambiar criterios es cosa del dueño. Si no lo eres, la
    // pantalla se quedaría con un cambio que la nube nunca aceptó.
    if (!esMiProyecto(projects.find(p => p.id === editingProjectId))) {
      toast('Esta carpeta no es tuya', 'warning', 'Solo quien la creó puede cambiar sus datos')
      setShowEditProject(false); setEditingProjectId(null); setProjectDraft(EMPTY_PROJECT); limpiarBuscadorCompartir(); return
    }
    updateProject(editingProjectId, { name: projectDraft.name.trim(), company: projectDraft.company.trim(), status: projectDraft.status, evaluationCriteria: projectDraft.evaluationCriteria, interviewers: projectDraft.interviewers })
    setShowEditProject(false); setEditingProjectId(null); setProjectDraft(EMPTY_PROJECT); limpiarBuscadorCompartir()
    toast('Proyecto actualizado')
  }

  const handleSaveSettings = async () => {
    const nextStt = sttDraft
    const nextLlm = sameKeyForLlm ? { ...llmDraft, apiKey: sttDraft.apiKey } : llmDraft
    if (window.desktopApp?.saveConfig) await window.desktopApp.saveConfig({
      stt: nextStt, llm: nextLlm,
      // Campos antiguos: se siguen escribiendo para que una versión anterior de la
      // app (o un downgrade) siga encontrando la configuración de Groq.
      groqApiKey: nextStt.provider === 'groq' ? nextStt.apiKey : '',
      transcriptionModel: nextStt.model, summaryModel: nextLlm.model,
      userName: settingsNameDraft, userEmail: settingsEmailDraft, userCompany: settingsCompanyDraft,
      userRole: settingsRoleDraft, audioFormat: settingsAudioFormatDraft, recordingQuality: settingsRecordingQualityDraft,
      chunkDuration: settingsChunkDurationDraft, language: settingsLanguageDraft, dateFormat: settingsDateFormatDraft,
      autoSave: settingsAutoSaveDraft, autoTranscribe,
    })
    setSttCfg(nextStt); setLlmCfg(nextLlm)
    setUserName(settingsNameDraft); setUserEmail(settingsEmailDraft); setUserCompany(settingsCompanyDraft)
    setUserRole(settingsRoleDraft); setAutoSave(settingsAutoSaveDraft)
    localStorage.setItem('ct-default-mic', settingsDefaultMicDraft)
    localStorage.setItem('ct-default-output', settingsDefaultOutputDraft)
    localStorage.setItem('ct-default-system', String(settingsDefaultSystemDraft))
    localStorage.setItem('ct-default-record-video', String(settingsRecordVideoDraft))
    localStorage.setItem('ct-default-video-quality', settingsVideoQualityDraft)
    setDefaultMicDeviceId(settingsDefaultMicDraft); setDefaultOutputDeviceId(settingsDefaultOutputDraft); setDefaultCaptureSystem(settingsDefaultSystemDraft)
    setDefaultRecordVideo(settingsRecordVideoDraft); setDefaultVideoQuality(settingsVideoQualityDraft)
    // NOTE: las API keys NO se sincronizan a la nube por seguridad — viven solo en el config.json local.
    if (session) supabase.from('profiles').update({ name: settingsNameDraft, email: settingsEmailDraft, company: settingsCompanyDraft, tx_model: nextStt.model, sum_model: nextLlm.model, updated_at: new Date().toISOString() }).eq('id', session.user.id).then(() => {}, () => {})
    toast('Configuración guardada')
  }

  const openSettings = (tab: SettingsTab = 'api-keys') => {
    setSttDraft(sttCfg); setLlmDraft(llmCfg)
    setSameKeyForLlm(Boolean(sttCfg.apiKey) && sttCfg.apiKey === llmCfg.apiKey)
    setSttTest(null); setLlmTest(null)
    setSettingsNameDraft(userName); setSettingsEmailDraft(userEmail); setSettingsCompanyDraft(userCompany)
    setSettingsRoleDraft(userRole)
    setSettingsDefaultMicDraft(defaultMicDeviceId); setSettingsDefaultOutputDraft(defaultOutputDeviceId); setSettingsDefaultSystemDraft(defaultCaptureSystem)
    setSettingsRecordVideoDraft(defaultRecordVideo); setSettingsVideoQualityDraft(defaultVideoQuality)
    setSettingsTab(tab); setScreen('settings')
  }

  // ── Motores de IA: cambio de proveedor y prueba de conexión ────────────
  // Al cambiar de servicio se arrastra el modelo por defecto del nuevo (y su
  // dialecto/URL si es personalizado), para que nunca quede una combinación
  // imposible como "Deepgram + llama-3.3".
  const changeProvider = (kind: 'stt' | 'llm', providerId: string) => {
    const preset = findPreset(kind === 'stt' ? providerCatalog?.stt : providerCatalog?.llm, providerId)
    const next: ProviderConfig = {
      provider: providerId,
      apiKey: '',
      model: preset?.models[0] ?? '',
      ...(providerId === 'custom' ? { baseUrl: '', dialect: 'openai' } : {}),
    }
    if (kind === 'stt') { setSttDraft(next); setSttTest(null) }
    else { setLlmDraft(next); setLlmTest(null) }
  }

  const testProvider = async (kind: 'stt' | 'llm') => {
    if (!window.desktopApp?.testProvider) return
    const draft = kind === 'stt' ? sttDraft : (sameKeyForLlm ? { ...llmDraft, apiKey: sttDraft.apiKey } : llmDraft)
    const setter = kind === 'stt' ? setSttTest : setLlmTest
    setter('testing')
    try {
      setter(await window.desktopApp.testProvider({ kind, draft }))
    } catch (err) {
      setter({ ok: false, detail: String((err as Error)?.message || err) })
    }
  }

  const goToProject = (projectId: string) => { setActiveProjectId(projectId); setSearchQuery(''); setScreen('project-detail') }
  const goToCandidate = (candidateId: string, projectId?: string, from: 'project' | 'all' = 'project') => {
    if (projectId) setActiveProjectId(projectId)
    setCandidateFrom(from)
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

  // El onboarding ofrece el camino fácil (Groq, gratis). Quien ya use otro
  // servicio salta a Ajustes → Motores de IA y lo configura allí.
  const handleOnboardingSave = async () => {
    const key = onboardingKeyDraft.trim()
    if (!key) return
    const stt: ProviderConfig = { ...DEFAULT_STT_CFG, apiKey: key }
    const llm: ProviderConfig = { ...DEFAULT_LLM_CFG, apiKey: key }
    if (window.desktopApp?.saveConfig) await window.desktopApp.saveConfig({
      stt, llm, groqApiKey: key, transcriptionModel: stt.model, summaryModel: llm.model,
      userName, userEmail, userCompany,
    })
    setSttCfg(stt); setLlmCfg(llm); setShowOnboarding(false)
    localStorage.setItem(ONBOARDING_KEY, '1')
    toast('API Key guardada — ¡todo listo!')
  }

  const skipOnboardingToSettings = () => {
    setShowOnboarding(false)
    localStorage.setItem(ONBOARDING_KEY, '1')
    openSettings('api-keys')
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

  // Antes esto colgaba del desplegable de video de la lista de grabaciones. Ese
  // desplegable ya no existe (el video vive en la pestaña Transcripcion), asi que
  // la reparacion se lanza la primera vez que se muestra el video de cada entrevista.
  const repairedVideosRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const iv = selectedInterview
    if (activeTab !== 'transcripcion' || !iv?.videoFilePath) return
    if (repairedVideosRef.current.has(iv.id)) return
    if (!window.desktopApp?.ensureRecordingDuration) return
    const filePath = resolveAudioPath(iv.videoFilePath)
    if (!filePath) return
    repairedVideosRef.current.add(iv.id)
    setRepairingVideoId(iv.id)
    void window.desktopApp.ensureRecordingDuration({ filePath })
      // Si se ha reescrito el archivo hay que recargar el <video>: el que ya está
      // en pantalla sigue con la duración mal calculada.
      .then(r => { if (r.repaired) setVideoReloadKey(k => k + 1) })
      .finally(() => setRepairingVideoId(null))
  }, [activeTab, selectedInterview, resolveAudioPath])

  // ── Audios en la nube ──────────────────────────────────────────────────────
  // Los audios se guardan en Documents\CallTranscriber del PC que grabó. Antes se
  // quedaban ahí: en el otro equipo la entrevista salía en la lista pero sin audio,
  // así que no se podía ni escuchar ni re-transcribir. Ahora se suben también a
  // Supabase Storage y se vuelven a bajar al PC que las necesite.
  //
  // Se suben DOS archivos por entrevista: la mezcla (lo que se transcribe) y la
  // pista de sistema (la voz limpia del interlocutor, necesaria para separar
  // hablantes). El VÍDEO no se sube — pesa ~300 MB y no cabe en el plan gratuito.
  const uploadInterviewAudio = async (interview: Interview, opts?: { silent?: boolean }): Promise<boolean> => {
    const userId = session?.user.id
    if (!userId || !isSupabaseConfigured) return false
    if (!interview.recordingFilePath || !window.desktopApp?.readRecordingBytes) return false

    const names = [interview.recordingFilePath, interview.systemAudioFilePath].filter((n): n is string => !!n)
    setAudioSync(s => ({ ...s, [interview.id]: 'uploading' }))
    try {
      let subidos = 0
      for (const stored of names) {
        const fullPath = resolveAudioPath(stored)
        if (!fullPath) continue
        const read = await window.desktopApp.readRecordingBytes({ filePath: fullPath })
        // Si el archivo no está en este PC simplemente no hay nada que subir de él.
        if (!read.ok || !read.bytes) continue
        const fileName = baseName(stored)
        const { error } = await supabase.storage
          .from(RECORDINGS_BUCKET)
          .upload(cloudAudioKey(interview.ownerId || userId, interview.id, fileName), new Blob([read.bytes], { type: audioMime(fileName) }), { upsert: true, contentType: audioMime(fileName) })
        if (error) throw new Error(error.message)
        subidos++
      }
      if (subidos === 0) throw new Error('no se encontró ningún archivo de audio en este equipo')
      // Se persiste también el nombre de la pista de sistema: en grabaciones
      // antiguas solo estaba en el localStorage de este equipo, y sin él el otro
      // PC no sabría qué archivo bajar para separar hablantes.
      updateInterview(interview.id, { audioUploaded: true, systemAudioFilePath: interview.systemAudioFilePath })
      setAudioSync(s => { const rest = { ...s }; delete rest[interview.id]; return rest })
      if (!opts?.silent) toast('Audio subido a la nube', 'success', 'Ya se puede transcribir desde el otro equipo')
      return true
    } catch (err) {
      setAudioSync(s => ({ ...s, [interview.id]: 'error' }))
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      // El fallo más habitual es el límite de tamaño por archivo del plan (50 MB).
      if (!opts?.silent) toast('No se pudo subir el audio', 'error', msg)
      return false
    }
  }

  // Devuelve rutas locales utilizables, bajando de la nube lo que falte en este PC.
  // null = no hay forma de conseguir el audio (ni aquí ni subido).
  const ensureLocalAudio = async (interview: Interview): Promise<{ filePath: string; systemFilePath: string | null } | null> => {
    if (!interview.recordingFilePath) return null
    const userId = session?.user.id

    const ensureOne = async (stored: string): Promise<string | null> => {
      const local = resolveAudioPath(stored)
      if (local && (await window.desktopApp?.recordingExists?.({ filePath: local }))?.exists) return local
      // No está en este equipo: intentar bajarlo.
      if (!userId || !interview.audioUploaded || !window.desktopApp?.writeRecordingBytes) return null
      const fileName = baseName(stored)
      const { data, error } = await supabase.storage
        .from(RECORDINGS_BUCKET)
        .download(cloudAudioKey(interview.ownerId || userId, interview.id, fileName))
      if (error || !data) return null
      const written = await window.desktopApp.writeRecordingBytes({ fileName, bytes: new Uint8Array(await data.arrayBuffer()) })
      return written.ok ? (written.filePath ?? null) : null
    }

    // Solo se anuncia "descargando" si de verdad falta el archivo principal aquí:
    // en el PC que grabó esto no debe parpadear nada.
    const mainLocal = resolveAudioPath(interview.recordingFilePath)
    const yaEstaAqui = !!mainLocal && !!(await window.desktopApp?.recordingExists?.({ filePath: mainLocal }))?.exists
    if (!yaEstaAqui) setAudioSync(s => ({ ...s, [interview.id]: 'downloading' }))
    try {
      const filePath = await ensureOne(interview.recordingFilePath)
      if (!filePath) return null
      // La pista de sistema es opcional: sin ella la transcripción sigue, solo
      // pierde la separación determinista de hablantes.
      const systemFilePath = interview.systemAudioFilePath ? await ensureOne(interview.systemAudioFilePath) : null
      return { filePath, systemFilePath }
    } finally {
      setAudioSync(s => { const rest = { ...s }; delete rest[interview.id]; return rest })
    }
  }

  // Al borrar una entrevista hay que vaciar también su carpeta del Storage: con
  // 1 GB en el plan gratuito, dejar audios huérfanos se come el espacio deprisa.
  const deleteCloudAudio = async (interview: Interview) => {
    const userId = session?.user.id
    if (!userId || !isSupabaseConfigured || !interview.audioUploaded) return
    const keys = [interview.recordingFilePath, interview.systemAudioFilePath]
      .filter((n): n is string => !!n)
      .map(n => cloudAudioKey(interview.ownerId || userId, interview.id, baseName(n)))
    if (keys.length === 0) return
    const { error } = await supabase.storage.from(RECORDINGS_BUCKET).remove(keys)
    if (error) console.error('Error borrando audio de la nube:', error.message)
  }

  // Distintivo de "¿dónde vive este audio?" en la lista de grabaciones. Sin esto
  // no había forma de saber por qué una entrevista se podía transcribir en un
  // equipo y en el otro no.
  const renderAudioCloudBadge = (iv: Interview) => {
    if (!iv.recordingFilePath || !isSupabaseConfigured || !session) return null
    const estado = audioSync[iv.id]
    if (estado === 'uploading' || estado === 'downloading') {
      return (
        <span className="audio-cloud audio-cloud--busy">
          <span className="spinner" style={{ width: 8, height: 8, display: 'inline-block', verticalAlign: 'middle' }} />
          {estado === 'uploading' ? 'Subiendo audio…' : 'Bajando audio…'}
        </span>
      )
    }
    if (iv.audioUploaded) {
      return <span className="audio-cloud audio-cloud--ok" title="El audio está en la nube: se puede escuchar y transcribir desde cualquiera de tus equipos."><CloudIcon size={12} /> En la nube</span>
    }
    return (
      <button
        type="button"
        className={`audio-cloud audio-cloud--local${estado === 'error' ? ' audio-cloud--error' : ''}`}
        title={estado === 'error'
          ? 'La última subida falló. Pulsa para reintentar.'
          : 'El audio vive solo en este equipo. Pulsa para subirlo y poder usarlo desde el otro PC.'}
        onClick={e => { e.stopPropagation(); void uploadInterviewAudio(iv) }}
      >
        {estado === 'error' ? <><WarnTriangle /> No se pudo subir · Reintentar</> : <><CloudUploadIcon size={12} /> Solo en este PC · Subir</>}
      </button>
    )
  }

  // El vídeo de la pestaña de transcripción se muestra solo, sin desplegar nada, así
  // que la reparación de la cabecera se lanza al seleccionar la entrevista.
  const selectedVideoPath = selectedInterview?.videoFilePath ?? null
  useEffect(() => {
    if (!selectedVideoPath || !window.desktopApp?.ensureRecordingDuration) return
    const filePath = resolveAudioPath(selectedVideoPath)
    if (!filePath) return
    void window.desktopApp.ensureRecordingDuration({ filePath })
      .then(r => { if (r.repaired) setVideoReloadKey(k => k + 1) })
  }, [selectedVideoPath, resolveAudioPath])

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
            {globalSearchQuery && <button type="button" className="gs-clear" onClick={() => setGlobalSearchQuery('')}><CloseIcon size={13} /></button>}
          </div>
          {q.length >= 2 && <p className="gs-count">{results.length} {results.length === 1 ? 'resultado' : 'resultados'}</p>}
        </div>

        {q.length < 2 ? (
          <EmptyState icon={<SearchIcon />} title="Busca en tus entrevistas" sub="Escribe al menos 2 caracteres para buscar en todas las transcripciones y resúmenes." />
        ) : results.length === 0 ? (
          <EmptyState title="Sin resultados" sub={`No se encontró «${globalSearchQuery}» en ninguna transcripción.`} />
        ) : (
          <div className="gs-results">
            {results.map(({ interview: iv, cand, proj, excerpt, matchCount, idx }) => (
              <div key={iv.id} className="gs-result-card" onClick={() => { if (cand) { goToCandidate(cand.id, proj?.id ?? cand.projectId, 'all'); setSelectedInterviewId(iv.id); setActiveTab(iv.summaryText?.toLowerCase().includes(q) && !iv.transcriptEdited?.toLowerCase().includes(q) ? 'resumen' : 'transcripcion') } }}>
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
                placeholder="Buscar por proyecto o empresa…"
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
                ? <EmptyState icon={<FolderIcon />} title="No tienes proyectos todavía" sub="Crea tu primer proyecto para empezar a gestionar perfiles." btnLabel="Nuevo proyecto" onBtn={() => setShowNewProject(true)} />
                : <EmptyState title="Sin resultados" sub="Prueba otro filtro o búsqueda." />
            ) : filteredProjects.map(p => {
              const cCnt = candidates.filter(c => c.projectId === p.id).length
              const iCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id).length
              const tCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id && i.transcriptionStatus === 'done').length
              const pCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id && i.transcriptionStatus === 'pending').length
              const isClosed = p.status === 'closed'
              return (
                <div key={p.id} className={`plc plc--clickable${isClosed ? ' plc--closed' : ''}`} onClick={() => goToProject(p.id)}>
                  <div className="plc-accent" />
                  <div className="plc-body">
                    <div className="plc-top">
                      <div className="plc-info">
                        <h3 className="plc-title">{p.name}</h3>
                        <p className="plc-meta">{p.company} · Creado {fs(p.createdAt)}</p>
                        {renderSharedBadge(p)}
                      </div>
                      <div className="plc-top-right" onClick={e => e.stopPropagation()}>
                        {esMiProyecto(p) && <button type="button" className="plc-edit-btn" onClick={e => { e.stopPropagation(); setProjectDraft({ name: p.name, company: p.company, status: p.status, evaluationCriteria: p.evaluationCriteria, interviewers: p.interviewers }); setEditingProjectId(p.id); setShowEditProject(true); limpiarBuscadorCompartir() }}><PencilIcon /> Editar</button>}
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
                      <div className="plc-actions" onClick={e => e.stopPropagation()}>
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
            <input type="text" placeholder="Buscar proyectos…" value={projectSearchQuery} onChange={e => setProjectSearchQuery(e.target.value)} />
            {projectSearchQuery && <button type="button" className="proj-search-clear" onClick={() => setProjectSearchQuery('')}><CloseIcon size={13} /></button>}
          </div>
          <div className="proj-filter-group">
            <button type="button" className={`proj-filter-btn${projectStatusFilter === 'active' ? ' is-active' : ''}`} onClick={() => setProjectStatusFilter(f => f === 'active' ? 'all' : 'active')}>Activos</button>
            <button type="button" className={`proj-filter-btn${projectStatusFilter === 'closed' ? ' is-active' : ''}`} onClick={() => setProjectStatusFilter(f => f === 'closed' ? 'all' : 'closed')}>Cerrados</button>
          </div>
          <ViewToggle mode={projectsViewMode} onChange={setProjectsViewMode} />
        </div>
        {isFiltered && <p className="proj-results-label">{filteredProjects.length} resultado{filteredProjects.length !== 1 ? 's' : ''}{projectSearchQuery.trim() ? ` para «${projectSearchQuery}»` : ''}</p>}
        {filteredProjects.length === 0 ? (
          isFiltered
            ? <EmptyState title="Sin resultados" sub="No hay proyectos que coincidan con los filtros aplicados." />
            : <EmptyState icon={<FolderIcon />} title="No tienes proyectos todavía" sub="Crea tu primer proyecto para empezar a gestionar perfiles." btnLabel="Nuevo proyecto" onBtn={() => setShowNewProject(true)} />
        ) : (
          <div className={`proj-list${projectsViewMode === 'grid' ? ' proj-list--grid' : ''}`} style={projectsViewMode === 'grid' ? { '--cols': Math.min(3, filteredProjects.length) } as React.CSSProperties : undefined}>
            {filteredProjects.map(p => {
              const cCnt = candidates.filter(c => c.projectId === p.id).length
              const iCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id).length
              const tCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id && i.transcriptionStatus === 'done').length
              const pCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id && i.transcriptionStatus === 'pending').length
              const isClosed = p.status === 'closed'
              return (
                <div key={p.id} className={`plc plc--clickable${isClosed ? ' plc--closed' : ''}`} onClick={() => goToProject(p.id)}>
                  <div className="plc-accent" />
                  <div className="plc-body">
                    <div className="plc-top">
                      <div className="plc-info">
                        <h3 className="plc-title">{p.name}</h3>
                        <p className="plc-meta">{p.company} · Creado {fs(p.createdAt)}</p>
                        {renderSharedBadge(p)}
                      </div>
                      <div className="plc-top-right" onClick={e => e.stopPropagation()}>
                        {esMiProyecto(p) && <button type="button" className="plc-edit-btn" onClick={e => { e.stopPropagation(); setProjectDraft({ name: p.name, company: p.company, status: p.status, evaluationCriteria: p.evaluationCriteria, interviewers: p.interviewers }); setEditingProjectId(p.id); setShowEditProject(true); limpiarBuscadorCompartir() }}><PencilIcon /> Editar</button>}
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
                      <div className="plc-actions" onClick={e => e.stopPropagation()}>
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
              {esMiProyecto(activeProject) && <button
                type="button"
                className={`btn-trash${pendingDeleteId === activeProject.id ? ' confirming' : ''}`}
                title={pendingDeleteId === activeProject.id ? '¿Confirmar?' : 'Eliminar proyecto'}
                onClick={() => void handleDeleteProject(activeProject.id)}
              >
                {pendingDeleteId === activeProject.id
                  ? <><CheckIcon /><span className="confirming-label">Eliminar ({projectCandidates.length} perfiles)</span></>
                  : <TrashIcon />}
              </button>}
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
              : <span className="criteria-chip criteria-chip--empty">Sin criterios. El resumen saldrá con la estructura por defecto.</span>
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
            <SortSelect value={profilesSort} onChange={changeProfilesSort} />
            <ViewToggle mode={profilesViewMode} onChange={setProfilesViewMode} />
            <button type="button" className="primary-btn pill-btn" onClick={() => { setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft(''); setCandidateStatusDraft('pendiente'); setCandidateConsentDraft(false); setShowNewCandidate(true) }}>Nuevo perfil</button>
          </div>
        </div>

        {/* Search */}
        <div className="search-bar">
          <span className="search-icon"><SearchIcon /></span>
          <input type="text" placeholder="Buscar por nombre, email o puesto..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && <button type="button" className="search-clear" onClick={() => setSearchQuery('')}><CloseIcon size={13} /></button>}
        </div>

        {filteredCandidates.length === 0 ? (
          searchQuery
            ? <EmptyState title="Sin resultados" sub={`No hay perfiles que coincidan con «${searchQuery}».`} />
            : <EmptyState icon={<UsersIcon />} title="No hay perfiles en este proyecto" sub="Añade tu primer perfil para empezar a grabar y transcribir entrevistas." btnLabel="Nuevo perfil" onBtn={() => { setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft(''); setCandidateStatusDraft('pendiente'); setCandidateConsentDraft(false); setShowNewCandidate(true) }} />
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
                    {c.candidateStatus !== 'pendiente' && <CandidateStatusPill status={c.candidateStatus} />}
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
    const allCandidates = sortByPref(candidates.filter(c => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.role.toLowerCase().includes(q)
    }))
    return (
      <div className="screen-content">
        <div className="content-header">
          <div><h2>Perfiles</h2><p className="screen-sub">{candidates.length} perfil{candidates.length !== 1 ? 'es' : ''}</p></div>
          <div className="content-header-actions">
            <SortSelect value={profilesSort} onChange={changeProfilesSort} />
            <ViewToggle mode={profilesViewMode} onChange={setProfilesViewMode} />
          </div>
        </div>
        <div className="search-bar">
          <span className="search-icon"><SearchIcon /></span>
          <input type="text" placeholder="Buscar por nombre, email o puesto…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && <button type="button" className="search-clear" onClick={() => setSearchQuery('')}><CloseIcon size={13} /></button>}
        </div>
        {allCandidates.length === 0 ? (
          searchQuery
            ? <EmptyState title="Sin resultados" sub={`No hay perfiles que coincidan con «${searchQuery}».`} />
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
                <div key={c.id} className="ctr" onClick={() => goToCandidate(c.id, c.projectId, 'all')}>
                  <div className="ctr-avatar">{initials(c.name)}</div>
                  <div className="ctr-info">
                    <span className="ctr-name">{c.name}</span>
                    <span className="ctr-meta">{project ? `${project.name}` : ''}{c.role ? ` · ${c.role}` : ''}{last ? ` · Última: ${fs(last.createdAt)}` : ''}</span>
                  </div>
                  <span className={`ctr-status ${statusCls}`}>{statusLabel}</span>
                  {c.candidateStatus !== 'pendiente' && <CandidateStatusPill status={c.candidateStatus} />}
                  <div className="ctr-actions" onClick={e => e.stopPropagation()}>
                    <button type="button" className="btn-icon" title="Exportar" onClick={() => { setExportCandidateId(c.id); setShowExport(true) }}><DownloadIcon /></button>
                    <button type="button" className="btn-icon" title="Editar" onClick={() => { setCandidateDraft({ name: c.name, email: c.email, phone: c.phone, role: c.role }); setCandidateNotesDraft(c.notes ?? ''); setCandidateStatusDraft(c.candidateStatus ?? 'pendiente'); setCandidateConsentDraft(c.consentGiven ?? false); setEditingCandidateId(c.id); setShowNewCandidate(true) }}><PencilIcon /></button>
                    <button type="button" className={`btn-trash${pendingDeleteId === c.id ? ' confirming' : ''}`} title={pendingDeleteId === c.id ? '¿Confirmar eliminación?' : 'Eliminar perfil'} onClick={() => handleDeleteCandidate(c.id)}>{pendingDeleteId === c.id ? <><CheckIcon /><span className="confirming-label">Eliminar ({interviews.filter(i => i.candidateId === c.id).length} entrevistas)</span></> : <TrashIcon />}</button>
                  </div>
                  <button type="button" className="ctr-open">Ver entrevistas <ArrowRightIcon size={12} /></button>
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
                {activeCandidate.consentGiven ? <><LockIcon size={12} /> Consentimiento</> : <><WarnTriangle /> Sin consentimiento</>}
              </span>
              {activeCandidate.candidateStatus !== 'pendiente' && <CandidateStatusPill status={activeCandidate.candidateStatus} />}
              <div className="cand-header-actions">
                <button type="button" className="btn-icon" title="Exportar" onClick={() => { setExportCandidateId(activeCandidate.id); setShowExport(true) }}><DownloadIcon /></button>
                <button type="button" className="btn-icon" title="Editar" onClick={() => { setCandidateDraft({ name: activeCandidate.name, email: activeCandidate.email, phone: activeCandidate.phone, role: activeCandidate.role }); setCandidateNotesDraft(activeCandidate.notes ?? ''); setCandidateStatusDraft(activeCandidate.candidateStatus ?? 'pendiente'); setCandidateConsentDraft(activeCandidate.consentGiven ?? false); setEditingCandidateId(activeCandidate.id); setShowNewCandidate(true) }}><PencilIcon /></button>
              </div>
            </div>
          </div>
        </div>
        <div className="profile-tabs-pill">
          {([['entrevistas', <><MicIcon /> Entrevistas</>], ['transcripcion', <><DocIcon /> Transcripción</>], ['resumen', <><StarIcon /> Resumen IA</>]] as [ProfileTab, ReactNode][]).map(([tab, label]) => (
            <button key={tab} type="button" className={`pill-tab${activeTab === tab ? ' pill-tab--active' : ''}`} onClick={() => {
              setActiveTab(tab)
              const iv = tab === 'resumen' ? interviews.find(i => i.id === selectedInterviewId) : null
              if (iv?.transcriptionStatus === 'done') {
                void prepareSummaryNotes(iv.id, iv.transcriptEdited, iv.summaryContext ?? 'entrevista')
              }
            }}>
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

  const renderInterviewsTab = () => {
    const ivProject = activeCandidate ? projects.find(p => p.id === activeCandidate.projectId) ?? null : null
    return (
    <div className="interviews-tab">
      {!sttReady && (
        <div className="warning-note" style={{ marginBottom: 12 }}>
          <WarnTriangle /> Todavía no has configurado un motor de transcripción, así que no se puede transcribir. <button type="button" className="link-btn" onClick={() => openSettings('api-keys')}>Configurar ahora <ArrowRightIcon size={12} /></button>
        </div>
      )}
      <div className="rec-section-header">
        <h3 className="rec-section-title">Grabaciones</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {playingInterviewId && (
            <Select
              className="cfg-select cfg-select--mini"
              value={String(playbackRate)}
              onChange={v => setPlaybackRate(parseFloat(v))}
              title="Velocidad de reproducción"
              options={[{ value: '0.5', label: '0.5x' }, { value: '0.75', label: '0.75x' }, { value: '1', label: '1x' }, { value: '1.25', label: '1.25x' }, { value: '1.5', label: '1.5x' }, { value: '2', label: '2x' }]}
            />
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
              <input type="text" placeholder="Buscar grabación…" value={ivSearchQuery} onChange={e => setIvSearchQuery(e.target.value)} />
              {ivSearchQuery && <button type="button" className="search-clear" onClick={() => setIvSearchQuery('')}><CloseIcon size={13} /></button>}
            </div>
          )}
        <div className="rec-rows">
          {candidateInterviews.filter(iv => !ivSearchQuery.trim() || iv.sessionName.toLowerCase().includes(ivSearchQuery.toLowerCase()) || fd(iv.createdAt).includes(ivSearchQuery)).map(iv => {
            const isDone = iv.transcriptionStatus === 'done'
            const isError = iv.transcriptionStatus === 'error'
            const isTranscribing = iv.transcriptionStatus === 'transcribing'
            return (
              <div key={iv.id}>
              <div className="rec-row">
                <div className="rec-row-accent" />
                <div className="rec-row-info">
                  <div className="rec-row-top">
                    {editingInterviewId === iv.id ? (
                      <div className="rec-row-edit-wrap" onClick={e => e.stopPropagation()}>
                        <input type="text" className="rec-row-edit-input" value={editingNameDraft} onChange={e => setEditingNameDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { if (editingNameDraft.trim()) updateInterview(iv.id, { sessionName: editingNameDraft.trim() }); setEditingInterviewId(null) } if (e.key === 'Escape') setEditingInterviewId(null) }} autoFocus />
                        <button type="button" className="btn-icon btn-icon--confirm" onClick={() => { if (editingNameDraft.trim()) updateInterview(iv.id, { sessionName: editingNameDraft.trim() }); setEditingInterviewId(null) }}><CheckIcon /></button>
                        <button type="button" className="btn-icon" onClick={() => setEditingInterviewId(null)}><CloseIcon size={13} /></button>
                      </div>
                    ) : (
                      <span className="rec-row-name">{iv.sessionName || fd(iv.createdAt)}</span>
                    )}
                  </div>
                  <span className="rec-row-meta">
                    {fs(iv.createdAt)}{iv.durationSec > 0 ? ` · ${fmt(iv.durationSec)}` : ''}
                    {iv.videoFilePath ? <> · <VideoIcon size={13} /> vídeo</> : ''}
                  </span>
                  {/* Aquí SOLO se elige entre los entrevistadores del proyecto. Darlos
                      de alta es cosa del proyecto (Nuevo/Editar proyecto), para que la
                      lista no se llene de nombres sueltos escritos sobre la marcha. */}
                  <span className="rec-row-interviewer" onClick={e => e.stopPropagation()}>
                    {(ivProject?.interviewers.length ?? 0) > 0 ? (
                      <Select
                        className={`rec-row-interviewer-select${iv.interviewerName ? '' : ' rec-row-interviewer-select--empty'}`}
                        title="Entrevistador de esta llamada"
                        value={iv.interviewerName || ''}
                        onChange={v => updateInterview(iv.id, { interviewerName: v })}
                        options={[{ value: '', label: 'Sin entrevistador' }, ...(ivProject?.interviewers ?? []).map(name => ({ value: name, label: name }))]}
                      />
                    ) : (
                      <button
                        type="button"
                        className="rec-row-interviewer-select rec-row-interviewer-select--empty rec-row-interviewer-link"
                        title="Este proyecto no tiene entrevistadores. Se dan de alta en el proyecto."
                        onClick={() => { if (ivProject) { setProjectDraft({ name: ivProject.name, company: ivProject.company, status: ivProject.status, evaluationCriteria: ivProject.evaluationCriteria, interviewers: ivProject.interviewers }); setEditingProjectId(ivProject.id); setShowEditProject(true); limpiarBuscadorCompartir() } }}
                      >
                        Añádelos en el proyecto
                      </button>
                    )}
                  </span>
                  {iv.captureSource === 'mic' && (
                    <span className="rec-row-warning" title="No se capturó el audio del sistema: la transcripción solo incluirá tu micrófono, no la otra voz de la llamada.">
                      <WarnTriangle /> Sin audio del interlocutor
                    </span>
                  )}
                  {renderAudioCloudBadge(iv)}
                </div>
                <span className={`rec-row-badge${isDone ? ' rec-row-badge--done' : isError ? ' rec-row-badge--error' : isTranscribing ? ' rec-row-badge--transcribing' : ' rec-row-badge--pending'}`}>
                  {isDone ? <><DotFilled /> Transcrita</> : isError ? <><WarnTriangle /> Error</> : isTranscribing ? <><span className="spinner" style={{width:8,height:8,display:'inline-block',verticalAlign:'middle',marginRight:2}}/> Transcribiendo</> : <><DotRing /> Pendiente</>}
                </span>
                <div className="rec-row-actions" onClick={e => e.stopPropagation()}>
                  {(iv.recordingUrl ?? iv.recordingFilePath) && (
                    <button type="button" className="btn-icon" title="Reproducir" onClick={() => void handleTogglePlayback(iv)}>{playingInterviewId === iv.id ? <PauseIconSm /> : <PlayIcon />}</button>
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
                  <button type="button" className="rec-row-btn rec-row-btn--primary" onClick={e => { e.stopPropagation(); void handleTranscribe(iv.id) }}>{isError ? <><RefreshIcon size={12} /> Reintentar</> : <><PlayIcon size={11} /> Transcribir</>}</button>
                ) : isTranscribing ? (
                  <div className="rec-row-spinner"><span className="spinner" /></div>
                ) : null}
              </div>
              </div>
            )
          })}
        </div>
        </>
      )}
    </div>
    )
  }

  const renderTranscriptTab = () => {
    const wordCount = transcriptDraft.trim() ? transcriptDraft.trim().split(/\s+/).length : 0
    const readingMin = Math.ceil(wordCount / 150)
    // Si la entrevista seleccionada es un vídeo, se muestra el vídeo en el centro y la
    // transcripción en una columna estrecha a la derecha (scrollable), para verlo y leer a la vez.
    const hasVideo = !!selectedInterview?.videoFilePath
    return (
      <div className={`transcript-layout-v2${hasVideo ? ' transcript-layout-v2--with-video' : ''}`}>
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
                      <button type="button" className="trx-transcribe-btn" title="Reproducir" onClick={e => { e.stopPropagation(); void handleTogglePlayback(iv) }}>{playingInterviewId === iv.id ? <PauseIconSm /> : <PlayIcon />}</button>
                    )}
                    {iv.recordingFilePath && iv.transcriptionStatus !== 'transcribing' && (
                      <button type="button" className="trx-transcribe-btn" onClick={e => { e.stopPropagation(); void handleTranscribe(iv.id) }}>{hasDone ? <RefreshIcon size={11} /> : 'Transcribir'}</button>
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
        {hasVideo && selectedInterview && (
          <>
            <div className="trx-video-panel">
              <video
                key={videoReloadKey}
                className="trx-video-el"
                controls
                src={resolveVideoUrl(selectedInterview.videoFilePath) ?? undefined}
                ref={el => {
                  videoElRef.current = el
                  videoElInterviewRef.current = el ? selectedInterview.id : null
                  if (el) { el.playbackRate = videoPlaybackRate; el.volume = videoVolume; fixVideoDuration(el) }
                }}
                onTimeUpdate={e => {
                  const el = e.currentTarget
                  const d = el.duration
                  setVideoTime({ current: el.currentTime, total: isFinite(d) && d > 0 ? d : 0 })
                }}
              />
              <div className="video-player-time">
                <span className="video-player-time-now">{fmt(Math.floor(videoTime.current))}</span>
                <span className="video-player-time-sep">/</span>
                <span>{videoTime.total > 0 ? fmt(Math.floor(videoTime.total)) : fmt(selectedInterview.durationSec)}</span>
                {repairingVideoId === selectedInterview.id && <span className="video-player-time-note">calibrando la barra…</span>}
              </div>
              <div className="video-player-controls">
                <label className="video-player-ctrl">Velocidad
                  <Select
                    className="cfg-select cfg-select--mini"
                    value={String(videoPlaybackRate)}
                    onChange={v => setVideoPlaybackRate(parseFloat(v))}
                    options={[{ value: '0.5', label: '0.5x' }, { value: '0.75', label: '0.75x' }, { value: '1', label: '1x' }, { value: '1.25', label: '1.25x' }, { value: '1.5', label: '1.5x' }, { value: '2', label: '2x' }]}
                  />
                </label>
                <label className="video-player-ctrl">Volumen
                  <input type="range" min="0" max="1" step="0.05" value={videoVolume} onChange={e => setVideoVolume(parseFloat(e.target.value))} />
                </label>
              </div>
            </div>
            <div className="trx-separator" />
          </>
        )}
        <div className="trx-editor-panel">
          {selectedInterview ? (
            <>
              <div className="trx-toolbar">
                <div className="trx-search">
                  <SearchIcon />
                  <input type="text" placeholder="Buscar en transcripción…" value={txSearchQuery} onChange={e => setTxSearchQuery(e.target.value)} />
                  {txSearchQuery.trim() && (() => {
                    const count = transcriptDraft ? (transcriptDraft.toLowerCase().split(txSearchQuery.toLowerCase()).length - 1) : 0
                    return <span style={{ fontSize: 11, color: count > 0 ? 'var(--primary)' : 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 4 }}>{count} {count === 1 ? 'resultado' : 'resultados'}</span>
                  })()}
                </div>
                <Select
                  className="trx-lang-select"
                  value={txLang}
                  onChange={setTxLang}
                  title="Idioma para transcripción"
                  options={[
                    { value: 'auto', label: 'Auto-detectar' },
                    { value: 'es', label: 'Español' },
                    { value: 'en', label: 'English' },
                    { value: 'fr', label: 'Français' },
                    { value: 'de', label: 'Deutsch' },
                    { value: 'pt', label: 'Português' },
                    { value: 'it', label: 'Italiano' },
                  ]}
                />
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
                      ? <><span className="spinner" /> Transcribiendo…</>
                      : retranscribeConfirmId === selectedInterview.id
                        ? <><WarnTriangle /> ¿Confirmar?</>
                        : selectedInterview.transcriptEdited ? <><RefreshIcon size={12} /> Re-transcribir</> : <><PlayIcon size={11} /> Transcribir</>}
                  </button>
                )}
                <button type="button" className="trx-tool-btn trx-tool-btn--outline" onClick={async () => { try { await navigator.clipboard.writeText(transcriptDraft); toast('Copiada') } catch { toast('No se pudo copiar', 'error') } }}><ClipboardIcon /> Copiar todo</button>
                <button type="button" className="trx-tool-btn trx-tool-btn--primary" onClick={() => { const blob = new Blob([transcriptDraft], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${selectedInterview.sessionName || 'transcripcion'}.txt`; a.click(); URL.revokeObjectURL(url) }}><DownloadIcon /> Descargar .txt</button>
              </div>
              {selectedInterview.transcriptionStatus === 'transcribing' && <div className="spinner-row"><span className="spinner" /><span>Transcripción en curso…</span><button type="button" className="secondary-btn" style={{ marginLeft: 12 }} onClick={() => updateInterview(selectedInterview.id, { transcriptionStatus: 'pending' })}>Cancelar</button></div>}
              {selectedInterview.transcriptionStatus === 'error' && (
                <div className="trx-error-card">
                  <div className="trx-error-accent" />
                  <div className="trx-error-body">
                    <div className="trx-error-icon-wrap"><span className="trx-error-icon"><WarnTriangle size={36} /></span></div>
                    <h3 className="trx-error-title">Error al transcribir</h3>
                    <p className="trx-error-sub1">No se pudo completar la transcripción.</p>
                    <p className="trx-error-sub2">Verifica tu clave de {sttPreset?.label ?? 'transcripción'} o inténtalo de nuevo.</p>
                    <button type="button" className="primary-btn pill-btn trx-error-btn" onClick={() => void handleTranscribe(selectedInterview.id)}><RefreshIcon /> Reintentar</button>
                    <button type="button" className="link-btn trx-error-back" onClick={() => setActiveTab('entrevistas')}><ArrowLeftIcon /> Volver a grabaciones</button>
                  </div>
                </div>
              )}
              {selectedInterview.transcriptionStatus !== 'transcribing' && (
                !selectedInterview.transcriptEdited ? (
                  <div className="trx-pending-state">
                    <div className="trx-pending-icon">⊙</div>
                    <p className="trx-pending-title">Esta grabación aún no ha sido transcrita</p>
                    <p className="trx-pending-sub">Pulsa «Transcribir» en el panel izquierdo para procesarla con {sttPreset?.label ?? 'el motor configurado'}.</p>
                  </div>
                ) : (
                  <textarea
                    className="trx-textarea"
                    value={transcriptDraft}
                    onChange={e => setTranscriptDraft(e.target.value)}
                    onDoubleClick={e => handleTranscriptSeek(e.currentTarget, selectedInterview)}
                    placeholder="La transcripción aparecerá aquí…"
                  />
                )
              )}
              <div className="trx-footer">
                <span className="trx-footer-info"><PencilIcon size={12} /> Haz clic para editar · Doble clic en un turno para escucharlo · {wordCount} palabras · {readingMin} min</span>
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
                      <button type="button" className="trx-transcribe-btn" title="Reproducir" onClick={e => { e.stopPropagation(); void handleTogglePlayback(iv) }}>{playingInterviewId === iv.id ? <PauseIconSm /> : <PlayIcon />}</button>
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
                {/* Enfoque: cambia de quién habla el informe y qué apartados cubre. */}
                <Select
                  className="sum-type-select"
                  value={selectedInterview.summaryContext ?? 'entrevista'}
                  onChange={v => {
                    const ctx = v as SummaryContext
                    updateInterview(selectedInterview.id, { summaryContext: ctx })
                    if (selectedInterview.transcriptionStatus === 'done') {
                      void prepareSummaryNotes(selectedInterview.id, selectedInterview.transcriptEdited, ctx)
                    }
                  }}
                  options={[
                    { value: 'entrevista', label: 'Entrevista de selección' },
                    { value: 'reunion', label: 'Reunión de negocio' },
                  ]}
                />
                <Select
                  className={`sum-type-select${selectedInterview.summaryType === 'resumen' ? ' sum-type-select--active' : ''}`}
                  value={selectedInterview.summaryType}
                  onChange={v => updateInterview(selectedInterview.id, { summaryType: v as 'resumen' | 'listado' })}
                  options={[
                    { value: 'resumen', label: 'Resumen descriptivo' },
                    { value: 'listado', label: 'Listado por puntos' },
                  ]}
                />
                <button type="button" className="trx-tool-btn trx-tool-btn--copy" disabled={!selectedInterview.summaryText} onClick={async () => { try { await navigator.clipboard.writeText(selectedInterview.summaryText); toast('Resumen copiado') } catch { toast('No se pudo copiar', 'error') } }}><ClipboardIcon /> Copiar</button>
                <button type="button" className="trx-tool-btn trx-tool-btn--primary" onClick={() => void handleGenerateSummary(selectedInterview.id)} disabled={!llmReady || selectedInterview.transcriptionStatus !== 'done' || selectedInterview.summaryStatus === 'generating' || preparingIds.includes(selectedInterview.id)}>{preparingIds.includes(selectedInterview.id) ? <><span className="spinner" /> Leyendo…</> : selectedInterview.summaryText ? <><RefreshIcon size={12} /> Regenerar</> : <><StarIcon size={12} /> Generar</>}</button>
              </div>
              {!llmReady && <p className="warning-note">Configura un motor de resumen en <button type="button" className="link-btn" onClick={() => openSettings()}>Configuración</button></p>}
              {selectedInterview.transcriptionStatus !== 'done' && <p className="warning-note">Primero transcribe la entrevista</p>}
              {(preparingIds.includes(selectedInterview.id) || selectedInterview.summaryStatus === 'generating') && (() => {
                const preparando = preparingIds.includes(selectedInterview.id)
                // El progreso llega del proceso principal. Hasta el primer aviso
                // (o si la entrevista que se está resumiendo no es la que se mira)
                // se cae al spinner de siempre.
                const p = summaryProgress?.interviewId === selectedInterview.id ? summaryProgress : null
                if (!p) return <div className="spinner-row"><span className="spinner" /><span>{preparando ? 'Leyendo la conversación…' : 'Generando resumen…'}</span></div>
                const pct = p.total > 0 ? Math.min(99, Math.round((p.hechas / p.total) * 100)) : 0
                const espera = p.esperaHasta ? Math.max(0, Math.ceil((p.esperaHasta - Date.now()) / 1000)) : 0
                return (
                  <div className="sum-progress">
                    <div className="sum-progress-head">
                      <span className="spinner" />
                      <span className="sum-progress-label">{p.etiqueta}</span>
                      <span className="sum-progress-pct">{pct}%</span>
                    </div>
                    <div className="sum-progress-track">
                      <div className="sum-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="sum-progress-eta">
                      {espera > 0
                        ? <>Esperando cuota del proveedor · se reanuda en {espera}s</>
                        : p.total > 1
                          ? <>Paso {Math.min(p.hechas + 1, p.total)} de {p.total}{p.etaSec > 0 && <> · quedan {formatEta(p.etaSec)} aprox.</>}</>
                          : <>La transcripción cabe en una sola petición: esto es cuestión de segundos</>}
                    </p>
                    {p.total > 4 && (
                      <p className="sum-progress-note">
                        {preparando
                          ? <>Puedes cerrar esta pestaña o seguir a lo tuyo: esto corre por detrás. Cuando termine,
                              el resumen se generará en segundos — y regenerarlo también.</>
                          : <>Tarda porque el plan gratuito del motor de resumen limita cuánto texto admite por minuto,
                              y una llamada larga no cabe de una vez. Se puede quitar cambiando de motor en Ajustes.</>}
                      </p>
                    )}
                  </div>
                )
              })()}
              {(() => {
                // Notas listas y nada en marcha: merece la pena decirlo, porque
                // cambia lo que el usuario espera al pulsar Generar.
                if (preparingIds.includes(selectedInterview.id) || selectedInterview.summaryStatus === 'generating') return null
                void notesReadyTick   // repinta cuando se guardan notas nuevas
                const guardadas = getNotesCache()[selectedInterview.id]
                const huella = huellaTranscripcion(selectedInterview.transcriptEdited, selectedInterview.summaryContext ?? 'entrevista')
                if (guardadas?.huella !== huella) return null
                return <p className="sum-ready-hint"><CheckIcon size={12} /> La conversación ya está leída, así que el resumen tarda unos segundos{guardadas.recortado ? <>. Fue tan larga que falta el tramo final.</> : <>.</>}</p>
              })()}
              {selectedInterview.summaryStatus === 'error' && <p className="error-note">Error. Inténtalo de nuevo.</p>}
              {(() => {
                // En modo reunión los apartados son fijos (acuerdos, necesidades, objeciones,
                // presupuesto) y los criterios del proyecto se ignoran a propósito: son de
                // selección de personal. Pedirlos aquí solo confunde.
                if ((selectedInterview.summaryContext ?? 'entrevista') === 'reunion') {
                  return <p className="sum-criteria-hint">En una reunión de negocio los apartados son siempre estos: <strong>acuerdos y próximos pasos, necesidades del cliente, objeciones y riesgos, presupuesto y plazos</strong>. No hacen falta criterios.</p>
                }
                const cand = candidates.find(c => c.id === selectedInterview.candidateId)
                const proj = cand ? projects.find(p => p.id === cand.projectId) : null
                const crit = proj?.evaluationCriteria ?? []
                const labels = crit.map(id => EVALUATION_CRITERIA.find(c => c.id === id)?.label).filter(Boolean)
                return labels.length > 0
                  ? <p className="sum-criteria-hint">Criterios del proyecto: <strong>{labels.join(', ')}</strong></p>
                  : <p className="sum-criteria-hint sum-criteria-hint--empty">Este proyecto no tiene criterios. Si los defines, el resumen se centra en ellos.</p>
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
                  <button type="button" className="gen-summary-btn" onClick={() => void handleGenerateSummary(selectedInterview.id)} disabled={!llmReady}>
                    <StarIcon /> Generar resumen con IA
                  </button>
                )
              )}
            </>
          ) : <p className="tab-note">Selecciona una entrevista para generar su resumen.</p>}
        </div>
      </div>
    )
  }

  // ── Bloque de configuración de un motor de IA ──────────────────────────
  // Se usa dos veces: una para transcripción y otra para resumen. Ambos son
  // independientes — se puede transcribir con uno y resumir con otro.
  const renderEngineSection = (kind: 'stt' | 'llm') => {
    const isStt = kind === 'stt'
    const presets = (isStt ? providerCatalog?.stt : providerCatalog?.llm) ?? []
    const draft = isStt ? sttDraft : llmDraft
    const setDraft = isStt ? setSttDraft : setLlmDraft
    const preset = findPreset(presets, draft.provider)
    const test = isStt ? sttTest : llmTest
    const listId = `models-${kind}`
    const keyLocked = !isStt && sameKeyForLlm
    // Cualquier edición invalida el resultado de la última prueba de conexión.
    const clearTest = () => (isStt ? setSttTest : setLlmTest)(null)

    return (
      <div className="settings-section">
        <div className="settings-section-title">{isStt ? 'Transcripción' : 'Resumen IA'}</div>
        <div className="settings-section-divider" />
        <p className="cfg-field-desc">{isStt ? 'Convierte el audio de la llamada en texto' : 'Redacta el informe a partir de la transcripción'}</p>

        <label className="modal-label">Servicio
          <Select
            className="modal-input modal-select"
            value={draft.provider}
            onChange={v => changeProvider(kind, v)}
            options={presets.map(p => ({ value: p.id, label: `${p.label}${p.note ? ` · ${p.note}` : ''}${p.unverified ? ' · sin probar' : ''}` }))}
          />
        </label>

        {preset?.unverified && (
          <p className="warning-note cfg-unverified">
            <strong><WarnTriangle /> Sin probar.</strong> Este servicio está integrado pero todavía no se ha
            usado con {isStt ? 'audio' : 'una transcripción'} de verdad, así que puede fallar.
            Dale a <strong>Probar conexión</strong> aquí abajo y haz una prueba corta antes de
            usarlo en una entrevista importante.
          </p>
        )}

        {preset?.consoleUrl && (
          <p className="modal-link-note">
            ¿De dónde saco la clave? — <a href={preset.consoleUrl} target="_blank" rel="noreferrer">{preset.consoleUrl.replace(/^https?:\/\//, '')}</a>
          </p>
        )}

        {draft.provider === 'custom' && (
          <>
            <label className="modal-label">URL base
              <input type="text" className="modal-input" value={draft.baseUrl ?? ''} placeholder="https://mi-servicio.com/v1"
                onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} />
            </label>
            <label className="modal-label">Formato que habla
              <Select
                className="modal-input modal-select"
                value={draft.dialect ?? 'openai'}
                onChange={v => setDraft({ ...draft, dialect: v })}
                options={[
                  { value: 'openai', label: 'Compatible con OpenAI (lo más habitual)' },
                  ...(isStt
                    ? [{ value: 'deepgram', label: 'Deepgram' }, { value: 'elevenlabs', label: 'ElevenLabs' }]
                    : [{ value: 'anthropic', label: 'Anthropic' }]),
                ]}
              />
            </label>
          </>
        )}

        {!isStt && (
          <label className="modal-checkbox">
            <input type="checkbox" checked={sameKeyForLlm} onChange={e => { setSameKeyForLlm(e.target.checked); setLlmTest(null) }} />
            <span>Usar la misma clave que en transcripción</span>
          </label>
        )}

        {!preset?.noKey && !keyLocked && (
          <label className="modal-label">API Key
            <input type="password" className="modal-input" value={draft.apiKey} placeholder={preset?.keyHint ?? '···'}
              onChange={e => { setDraft({ ...draft, apiKey: e.target.value }); clearTest() }} />
          </label>
        )}

        {/* Editable a propósito: si mañana sale un modelo nuevo, se escribe y ya.
            Las sugerencias del catálogo son un atajo, no una lista cerrada. */}
        <label className="modal-label">Modelo
          <input type="text" className="modal-input" list={listId} value={draft.model} placeholder="nombre del modelo"
            onChange={e => { setDraft({ ...draft, model: e.target.value }); clearTest() }} />
          <datalist id={listId}>
            {(preset?.models ?? []).map(m => <option key={m} value={m} />)}
          </datalist>
        </label>

        <div className="cfg-test-row">
          <button type="button" className="pill-btn" onClick={() => void testProvider(kind)} disabled={test === 'testing'}>
            {test === 'testing' ? 'Probando…' : 'Probar conexión'}
          </button>
          {test && test !== 'testing' && (
            <span className={test.ok ? 'cfg-test-ok' : 'cfg-test-fail'}>{test.ok ? <CheckIcon size={12} /> : <CloseIcon size={12} />} {test.detail}</span>
          )}
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
            ['api-keys', <KeyIcon />, 'Motores de IA'],
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
              {renderEngineSection('stt')}
              {renderEngineSection('llm')}
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
                  <Select
                    className="cfg-select"
                    value={settingsRecordingQualityDraft}
                    onChange={setSettingsRecordingQualityDraft}
                    options={[
                      { value: 'high', label: 'Alta (128 kbps)' },
                      { value: 'medium', label: 'Media (64 kbps)' },
                      { value: 'low', label: 'Baja (32 kbps)' },
                    ]}
                  />
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">VÍDEO</div>
                  <div className="settings-section-divider" />
                  <div className="toggle-row">
                    <div><span className="toggle-label">Grabar vídeo de la reunión</span><span className="notif-sub">El vídeo se guarda en tu equipo, no en la nube (ocupa más espacio).</span></div>
                    <button type="button" className={`toggle-btn${settingsRecordVideoDraft ? ' on' : ''}`} onClick={() => setSettingsRecordVideoDraft(t => !t)}><span className="toggle-circle" /></button>
                  </div>
                  <label className="modal-label" style={{ marginTop: 12 }}>Calidad de vídeo
                    <Select
                      className="modal-input modal-select"
                      value={settingsVideoQualityDraft}
                      onChange={v => setSettingsVideoQualityDraft(v as '720p' | '1080p')}
                      options={[
                        { value: '1080p', label: '1080p (Full HD)' },
                        { value: '720p', label: '720p (HD)' },
                      ]}
                    />
                  </label>
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">DISPOSITIVOS PREDETERMINADOS</div>
                  <div className="settings-section-divider" />
                  <p className="cfg-field-desc">Se usarán automáticamente al iniciar una grabación</p>
                  <label className="modal-label">Micrófono predeterminado (entrada)
                    <Select
                      className="modal-input modal-select"
                      value={settingsDefaultMicDraft}
                      onChange={setSettingsDefaultMicDraft}
                      options={micDevices.length === 0
                        ? [{ value: '', label: 'Sin dispositivos detectados', disabled: true }]
                        : micDevices.map(d => ({ value: d.id, label: d.name }))}
                    />
                  </label>
                  <label className="modal-label" style={{ marginTop: 12 }}>Dispositivo de salida predeterminado
                    <Select
                      className="modal-input modal-select"
                      value={settingsDefaultOutputDraft}
                      onChange={setSettingsDefaultOutputDraft}
                      options={outputDevices.length === 0
                        ? [{ value: '', label: 'Sin dispositivos detectados', disabled: true }]
                        : outputDevices.map(d => ({ value: d.id, label: d.name }))}
                    />
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
                  <Select
                    className="cfg-select"
                    value={settingsLanguageDraft}
                    onChange={setSettingsLanguageDraft}
                    options={[
                      { value: 'es', label: 'Español' },
                      { value: 'en', label: 'English' },
                      { value: 'fr', label: 'Français' },
                    ]}
                  />
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
                  <Select
                    className="cfg-select"
                    value={settingsDateFormatDraft}
                    onChange={setSettingsDateFormatDraft}
                    options={[
                      { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
                      { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
                      { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
                    ]}
                  />
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
                    <div className="prof-avatar-actions">
                      <button type="button" className="secondary-btn pill-btn prof-photo-btn" onClick={() => photoInputRef.current?.click()}><CameraIcon /> Cambiar foto</button>
                      {userPhoto && <button type="button" className="secondary-btn pill-btn prof-photo-btn prof-photo-btn--danger" onClick={() => { setUserPhoto(''); localStorage.removeItem('ct-user-photo') }}><TrashIcon /> Eliminar</button>}
                    </div>
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
                <h2 className="panel-title">Plan y uso</h2>
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
            placeholder="Describe el criterio personalizado…"
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

  // ── Caja "Compartir con" del modal de proyecto ─────────────────────────
  // Solo el dueño reparte accesos. Al invitado se le enseña un aviso en vez de
  // esconderle la sección sin explicación: así entiende por qué no puede tocar
  // el nombre ni los criterios de una carpeta que sí ve.
  const renderShareEditor = () => {
    const proyecto = projects.find(p => p.id === editingProjectId)
    if (!proyecto) return null

    if (!esMiProyecto(proyecto)) {
      const mia = comparticionesDe(proyecto.id).find(sh => sh.sharedWithId === session?.user.id)
      return (
        <div className="modal-field">
          <div className="readonly-note">
            Esta carpeta te la ha compartido {mia?.ownerName || 'un compañero'}. Puedes ver y trabajar
            dentro (transcribir, resumir, editar textos), pero el nombre, los criterios y los accesos
            solo los cambia quien la creó.
          </div>
        </div>
      )
    }

    // Sin cuenta no hay a quién compartir: los datos viven solo en este equipo.
    if (!session || !isSupabaseConfigured) {
      return (
        <div className="modal-field">
          <span className="modal-field-label">Compartir con</span>
          <div className="readonly-note">
            Para compartir una carpeta hay que entrar con una cuenta: es lo que permite que los datos
            viajen a la nube y tu compañero pueda verlos desde su equipo.
          </div>
        </div>
      )
    }

    const lista = comparticionesDe(proyecto.id)
    return (
      <div className="modal-field">
        <span className="modal-field-label">Compartir con</span>
        <p className="modal-field-hint">
          Escribe el correo de tu compañero. Tiene que tener ya una cuenta de Call Transcriber
          creada con ese mismo correo.
        </p>
        <div className="share-box">
          <div className="share-search">
            <input
              type="email"
              className="modal-input modal-input--figma share-search-input"
              placeholder="correo@empresa.com"
              value={shareEmailDraft}
              onChange={e => { setShareEmailDraft(e.target.value); setShareError(''); setShareEncontrado(null) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleBuscarCompanero() } }}
            />
            <button
              type="button"
              className="share-search-btn"
              onClick={() => void handleBuscarCompanero()}
              disabled={shareBuscando || !shareEmailDraft.trim()}
            >
              {shareBuscando ? 'Buscando…' : 'Buscar'}
            </button>
          </div>

          {shareError && <p className="share-error">{shareError}</p>}

          {shareEncontrado && (
            <div className="share-found">
              <div className="share-found-info">
                <span className="share-found-name">{shareEncontrado.name}</span>
                <span className="share-found-email">{shareEncontrado.email}</span>
              </div>
              <button type="button" className="share-found-add" onClick={() => void handleDarAcceso()}>Dar acceso</button>
            </div>
          )}

          <div className="share-list">
            {lista.length === 0
              ? <span className="share-empty">Todavía no lo has compartido con nadie</span>
              : lista.map(sh => (
                  <div key={sh.id} className="share-chip">
                    <span className="share-chip-avatar" style={{ background: avatarColor(sh.sharedWithId) }}>
                      {(sh.sharedWithName[0] ?? '?').toUpperCase()}
                    </span>
                    <div className="share-chip-info">
                      <span className="share-chip-name">{sh.sharedWithName}</span>
                      <span className="share-chip-email">{sh.sharedWithEmail}</span>
                    </div>
                    <button
                      type="button"
                      className="share-chip-remove"
                      title={`Quitar el acceso a ${sh.sharedWithName}`}
                      onClick={() => void handleQuitarAcceso(sh)}
                    ><CloseIcon size={13} /></button>
                  </div>
                ))
            }
          </div>
          <p className="share-hint">
            Verán las transcripciones y los resúmenes al instante. El audio solo si está subido a la
            nube (el distintivo <CloudIcon size={12} /> de cada grabación); el vídeo nunca sale de este equipo.
          </p>
        </div>
      </div>
    )
  }

  const renderInterviewerEditor = (
    interviewersList: string[],
    onChange: (updated: string[]) => void
  ) => {
    const addInterviewer = () => {
      const name = newInterviewerDraft.trim()
      if (!name || interviewersList.includes(name)) { setNewInterviewerDraft(''); return }
      onChange([...interviewersList, name])
      setNewInterviewerDraft('')
    }
    return (
      <>
        <div className="proj-criteria-chips">
          {interviewersList.length > 0
            ? interviewersList.map(name => (
                <span key={name} className="interviewer-chip">
                  {name}
                  <button type="button" className="chip-remove-btn" title="Quitar" onClick={() => onChange(interviewersList.filter(n => n !== name))}><CloseIcon size={13} /></button>
                </span>
              ))
            : <span className="interviewer-chip interviewer-chip--empty">Sin entrevistadores todavía</span>
          }
        </div>
        <div className="interviewer-add-row">
          <input
            type="text"
            className="modal-input modal-input--figma"
            placeholder="Nombre del entrevistador…"
            value={newInterviewerDraft}
            onChange={e => setNewInterviewerDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInterviewer() } }}
          />
          <button type="button" className="secondary-btn" onClick={addInterviewer} disabled={!newInterviewerDraft.trim()}>Añadir</button>
        </div>
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
              <span className="rec-pip-live-badge"><DotFilled /> EN VIVO</span>
            </div>
            <span className="rec-pip-caption"><VideoIcon size={13} /> Grabando ventana: {captureWindowLabel}</span>
          </div>
        )}
        <div className="rec-screen-content">
          <div className={`rec-badge${isRecording ? '' : ' rec-badge--paused'}`}>
            {isRecording ? <><DotFilled /> EN GRABACIÓN</> : <><PauseIconSm size={11} /> EN PAUSA</>}
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
                <button type="button" className="rec-pause-btn" onClick={handlePauseRecording}><PauseIconSm size={13} /></button>
              ) : (
                <button type="button" className="rec-pause-btn" onClick={handleResumeRecording}><PlayIcon size={13} /></button>
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
        <span className="proc-step-icon">{done ? <CheckIcon size={13} /> : active ? <span className="spinner" /> : <CircleIcon size={13} />}</span>
        <span>{label}</span>
      </div>
    )
    return (
      <div className="modal-overlay">
        <div className="modal-box proc-modal">
          <h2>Procesando grabación…</h2>
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

    const options: { key: 'pdf' | 'txt' | 'clipboard'; icon: ReactNode; title: string; desc: string }[] = [
      { key: 'pdf', icon: <DocIcon />, title: 'PDF', desc: 'Documento con diseño y formato' },
      { key: 'txt', icon: <PencilIcon />, title: 'Texto plano (.txt)', desc: 'Sin formato, solo texto' },
      { key: 'clipboard', icon: <ClipboardIcon />, title: 'Copiar al portapapeles', desc: 'Copia el texto al clipboard' },
    ]

    return (
      <div className="modal-overlay" onClick={() => setShowExport(false)}>
        <div className="modal-box modal-box--figma exp-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <h2 className="modal-title">Exportar transcripción</h2>
              <p className="modal-subtitle">Selecciona el formato de exportación</p>
            </div>
            <button type="button" className="modal-close" onClick={() => setShowExport(false)}><CloseIcon size={13} /></button>
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
            <button type="button" className="modal-action-btn" onClick={() => void handleExport()}>Exportar <ArrowRightIcon /></button>
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
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>Iniciando…</p>
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
      {updateStatus && updateStatus.status === 'available' && (
        <div className="update-banner">
          <span>Hay una nueva versión{updateStatus.version ? ` (${updateStatus.version})` : ''}. La app no se actualiza sola: hay que descargar e instalar el archivo.</span>
          <button type="button" className="update-banner__btn" onClick={() => void window.desktopApp?.openReleasesPage?.()}>
            Descargar
          </button>
          <button type="button" className="update-banner__dismiss" onClick={() => setUpdateStatus(null)} aria-label="Cerrar"><CloseIcon size={13} /></button>
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
              <button type="button" className="csb-back" onClick={() => setScreen(candidateFrom === 'all' ? 'candidates' : 'project-detail')}><ChevronLeft /></button>
              <span className="csb-project-name">{candidateFrom === 'all' ? 'Perfiles' : activeProject.name}</span>
            </div>
            <div className="csb-list">
              {(candidateFrom === 'all' ? sidebarAllCandidates : projectCandidates).map(c => (
                <button key={c.id} type="button" className={`csb-item${c.id === activeCandidateId ? ' is-active' : ''}`} onClick={() => goToCandidate(c.id, c.projectId, candidateFrom)}>
                  <div className="csb-avatar" style={{ background: avatarColor(c.id) }}>{initials(c.name)}</div>
                  <div className="csb-info">
                    <span className="csb-name">{c.name}</span>
                    {c.role && <span className="csb-role">{c.role}</span>}
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
          <button type="button" className="pp-item" onClick={() => { setSettingsNameDraft(userName); setSettingsEmailDraft(userEmail); setSettingsCompanyDraft(userCompany); setScreen('profile'); setProfileScreenTab('perfil'); setShowProfilePopup(false) }}><UserIcon /> Mi Perfil</button>
          <button type="button" className="pp-item" onClick={() => { openSettings('general'); setShowProfilePopup(false) }}><SettingsIcon /> Configuración</button>
          <div className="pp-divider" />
          <button type="button" className="pp-item pp-item--danger" onClick={() => { setShowProfilePopup(false); void handleSignOut() }}><LogoutIcon /> Cerrar sesión</button>
        </div>
      )}

      {/* Onboarding */}
      {showOnboarding && (
        <div className="modal-overlay">
          <div className="modal-box onboarding-box" onClick={e => e.stopPropagation()}>
            <div className="onboarding-logo"><div className="sidebar-logo-badge" style={{ width: 48, height: 48, fontSize: 18 }}>CT</div></div>
            <h2 style={{ textAlign: 'center', margin: 0 }}>Bienvenido a Call Transcriber</h2>
            <p style={{ textAlign: 'center', margin: 0 }}>Para transcribir hace falta conectar un servicio de IA. Groq es gratis y no pide tarjeta, pero puedes usar el que quieras.</p>
            <label className="modal-label">Tu API Key de Groq
              <input type="password" className="modal-input" value={onboardingKeyDraft} onChange={e => setOnboardingKeyDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && onboardingKeyDraft.trim()) void handleOnboardingSave() }} placeholder="gsk_..." autoFocus />
            </label>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>¿Cómo obtengo mi clave? → <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>console.groq.com</a></p>
            <div className="modal-actions" style={{ justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="primary-btn" style={{ width: '100%', padding: '12px' }} onClick={() => void handleOnboardingSave()} disabled={!onboardingKeyDraft.trim()}>Empezar a grabar <ArrowRightIcon /></button>
              <button type="button" style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 13 }} onClick={skipOnboardingToSettings}>Ya uso otro servicio → configurarlo</button>
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
            {/* Quién ha llevado la llamada, en caliente y recién terminada. Se puede
                cambiar luego desde la lista de grabaciones. */}
            {sessionModalProject && sessionModalProject.interviewers.length > 0 && (
              <label className="modal-label">Entrevistador
                <Select
                  className="modal-input"
                  value={sessionInterviewerDraft}
                  onChange={setSessionInterviewerDraft}
                  options={[{ value: '', label: 'Sin asignar' }, ...sessionModalProject.interviewers.map(name => ({ value: name, label: name }))]}
                />
              </label>
            )}
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
              <button type="button" className="modal-close" onClick={() => { setShowNewCandidate(false); setEditingCandidateId(null); setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft(''); setCandidateStatusDraft('pendiente'); setCandidateConsentDraft(false) }}><CloseIcon size={13} /></button>
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
              <textarea className="modal-input modal-input--figma modal-textarea" value={candidateNotesDraft} onChange={e => setCandidateNotesDraft(e.target.value)} placeholder="Puntos a tratar, perfil del CV, observaciones…" rows={3} />
            </div>
            <div className="modal-field">
              <span className="modal-field-label">Estado</span>
              <Select
                className="modal-input modal-input--figma modal-select"
                value={candidateStatusDraft}
                onChange={v => setCandidateStatusDraft(v as Candidate['candidateStatus'])}
                options={[
                  { value: 'pendiente', label: 'Pendiente' },
                  { value: 'apto', label: 'Apto' },
                  { value: 'finalista', label: 'Finalista' },
                  { value: 'descartado', label: 'Descartado' },
                ]}
              />
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
              <button type="button" className="modal-close" onClick={() => setShowAudioSetupModal(false)}><CloseIcon size={13} /></button>
            </div>
            <div className="modal-header-divider" />
            <div className="rec-option-cards">
              <button
                type="button"
                className={`rec-option-card${!pendingRecordVideo ? ' rec-option-card--active' : ''}`}
                onClick={() => setPendingRecordVideo(false)}
              >
                <span className="rec-option-icon"><MicIcon size={22} /></span>
                <span className="rec-option-title">Solo audio</span>
                <span className="rec-option-desc">Graba solo el sonido: tu micro + el audio de la llamada.</span>
              </button>
              <button
                type="button"
                className={`rec-option-card${pendingRecordVideo ? ' rec-option-card--active' : ''}`}
                onClick={() => setPendingRecordVideo(true)}
              >
                <span className="rec-option-icon"><VideoIcon size={22} /></span>
                <span className="rec-option-title">Llamada entera (vídeo + audio)</span>
                <span className="rec-option-desc">Graba también la pantalla. Al empezar eliges qué ventana.</span>
              </button>
            </div>
            {pendingRecordVideo && (
              <div className="rec-video-banner"><VideoIcon size={14} /> Al empezar se te pedirá elegir qué pantalla o ventana grabar.</div>
            )}
            <div className="modal-field" style={{ marginTop: 16 }}>
              <span className="modal-field-label">Micrófono</span>
              <Select
                className="modal-input modal-input--figma modal-select"
                value={pendingMicId}
                onChange={setPendingMicId}
                options={micDevices.length === 0
                  ? [{ value: '', label: 'Sin dispositivos detectados', disabled: true }]
                  : micDevices.map(d => ({ value: d.id, label: d.name }))}
              />
            </div>
            <div className="modal-field" style={{ marginTop: 12 }}>
              <span className="modal-field-label">Altavoces / audio de la llamada</span>
              <Select
                className="modal-input modal-input--figma modal-select"
                value={pendingOutputId}
                onChange={setPendingOutputId}
                options={outputDevices.length === 0
                  ? [{ value: '', label: 'Sin dispositivos detectados', disabled: true }]
                  : outputDevices.map(d => ({ value: d.id, label: d.name }))}
              />
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
              <button type="button" className="modal-close" onClick={() => pickCaptureSource(null)}><CloseIcon size={13} /></button>
            </div>
            <div className="modal-header-divider" />
            <div className="source-picker-tabs">
              <button type="button" className={`source-picker-tab${sourcePickerTab === 'screen' ? ' source-picker-tab--active' : ''}`} onClick={() => setSourcePickerTab('screen')}>Pantalla</button>
              <button type="button" className={`source-picker-tab${sourcePickerTab === 'window' ? ' source-picker-tab--active' : ''}`} onClick={() => setSourcePickerTab('window')}>Ventana</button>
            </div>
            {(() => {
              const filtered = captureSources.filter(s => s.type === sourcePickerTab)
              return filtered.length === 0 ? (
                <p className="tab-note">{sourcePickerTab === 'screen' ? 'No se encontraron pantallas disponibles.' : 'No se encontraron ventanas disponibles.'}</p>
              ) : (
                <div className="source-picker-grid">
                  {filtered.map(s => (
                    <button key={s.id} type="button" className="source-picker-item" onClick={() => pickCaptureSource(s.id)}>
                      <span className="source-picker-thumb">
                        {s.thumbnail ? <img src={s.thumbnail} alt={s.name} /> : <span className="source-picker-thumb-fallback"><MonitorIcon size={28} /></span>}
                      </span>
                      <span className="source-picker-name">{s.name || 'Sin nombre'}</span>
                    </button>
                  ))}
                </div>
              )
            })()}
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
              <button type="button" className="modal-close" onClick={() => { setShowNewProject(false); setProjectDraft(EMPTY_PROJECT);  }}><CloseIcon size={13} /></button>
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
                <Select
                  className="modal-input modal-input--figma modal-select"
                  value={projectTypeDraft}
                  onChange={setProjectTypeDraft}
                  placeholder="Seleccionar tipo…"
                  options={[
                    { value: 'directa', label: 'Selección directa' },
                    { value: 'ett', label: 'ETT' },
                    { value: 'headhunting', label: 'Headhunting' },
                  ]}
                />
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
            <div className="modal-field">
              <span className="modal-field-label">Entrevistadores</span>
              <p className="modal-field-hint">Personas de tu equipo que pueden llevar una llamada de este proyecto</p>
              {renderInterviewerEditor(
                projectDraft.interviewers,
                updated => setProjectDraft(d => ({ ...d, interviewers: updated }))
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
        <div className="modal-overlay" onClick={() => { setShowEditProject(false); setEditingProjectId(null); setProjectDraft(EMPTY_PROJECT); limpiarBuscadorCompartir() }}>
          <div className="modal-box modal-box--figma" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Editar proyecto</h2>
                <p className="modal-subtitle">Modifica los datos y criterios del proyecto</p>
              </div>
              <button type="button" className="modal-close" onClick={() => { setShowEditProject(false); setEditingProjectId(null); setProjectDraft(EMPTY_PROJECT); limpiarBuscadorCompartir() }}><CloseIcon size={13} /></button>
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
                <Select
                  className="modal-input modal-input--figma modal-select"
                  value={projectDraft.status}
                  onChange={v => setProjectDraft(d => ({ ...d, status: v as 'active' | 'closed' }))}
                  options={[
                    { value: 'active', label: 'Activo' },
                    { value: 'closed', label: 'Cerrado' },
                  ]}
                />
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
            <div className="modal-field">
              <span className="modal-field-label">Entrevistadores</span>
              <p className="modal-field-hint">Personas de tu equipo que pueden llevar una llamada de este proyecto</p>
              {renderInterviewerEditor(
                projectDraft.interviewers,
                updated => setProjectDraft(d => ({ ...d, interviewers: updated }))
              )}
            </div>
            {renderShareEditor()}
            <div className="modal-footer-divider" />
            <div className="modal-actions modal-actions--figma">
              <button type="button" className="modal-cancel-btn" onClick={() => { setShowEditProject(false); setEditingProjectId(null); setProjectDraft(EMPTY_PROJECT); limpiarBuscadorCompartir() }}>Cancelar</button>
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
          const icons: Record<Toast['type'], ReactNode> = { success: <CheckIcon size={16} />, error: <CloseIcon size={16} />, info: <InfoIcon size={16} />, warning: <WarnTriangle size={16} /> }
          return (
            <div key={t.id} className={`toast toast--${t.type}`}>
              <div className="toast-accent" />
              <span className="toast-icon">{icons[t.type]}</span>
              <div className="toast-body">
                <span className="toast-title">{t.message}</span>
                {t.sub && <span className="toast-sub">{t.sub}</span>}
              </div>
              <button type="button" className="toast-close" onClick={() => setToasts(x => x.filter(x2 => x2.id !== t.id))}><CloseIcon size={13} /></button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default App
