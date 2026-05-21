import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

// ── Types ──────────────────────────────────────────────────────────────────
type Project = { id: string; name: string; company: string; createdAt: string; status: 'active' | 'closed' }
type Candidate = { id: string; projectId: string; name: string; email: string; phone: string; role: string }
type ProfileTab = 'entrevistas' | 'transcripcion' | 'resumen'
type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped'
type Interview = {
  id: string; candidateId: string; createdAt: string; sessionName: string
  status: RecordingStatus; durationSec: number; micDeviceId: string; outputDeviceId: string
  transcriptOriginal: string; transcriptEdited: string; transcriptUpdatedAt: string | null
  recordingUrl: string | null; recordingFilePath: string | null
  captureSource: 'none' | 'mic' | 'mic+system'
  transcriptionStatus: 'pending' | 'transcribing' | 'done' | 'error'
  summaryInstructions: string; summaryText: string
  summaryStatus: 'idle' | 'generating' | 'done' | 'error'
  summaryType: 'resumen' | 'listado'
}
type AudioDeviceOption = { id: string; name: string }
type Toast = { id: string; message: string; sub?: string; type: 'success' | 'error' | 'info' | 'warning' }
type Screen = 'dashboard' | 'projects' | 'project-detail' | 'candidate-detail' | 'candidates' | 'settings' | 'profile'
type ProfileScreenTab = 'perfil' | 'plan' | 'seguridad' | 'notif'
type SettingsTab = 'api-keys' | 'grabacion' | 'general'

// ── Storage ────────────────────────────────────────────────────────────────
const V1_KEY = 'call-transcriber-hito1'
const V2_KEY = 'call-transcriber-v2'
const ONBOARDING_KEY = 'ct-onboarding-done'

// ── Helpers ────────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID()
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
const fmtDate = (iso: string) => new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
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
const UsersIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
const KeyIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="15" r="5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>
const MicIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
const LockIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
const BellIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
const StarIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>

const EMPTY_PROJECT = { name: '', company: '', status: 'active' as const }
const EMPTY_CANDIDATE = { name: '', email: '', phone: '', role: '' }

function normalizeInterviews(arr: Interview[]): Interview[] {
  return arr.map(i => ({
    ...i,
    sessionName: i.sessionName ?? '',
    recordingUrl: null,
    recordingFilePath: i.recordingFilePath ?? null,
    captureSource: i.captureSource ?? 'none',
    transcriptionStatus: i.transcriptionStatus === 'transcribing' ? 'error'
      : i.transcriptionStatus ?? (i.transcriptOriginal && !i.transcriptOriginal.startsWith('Transcripcion pendiente') ? 'done' : 'pending'),
    summaryInstructions: i.summaryInstructions ?? '',
    summaryText: i.summaryText ?? '',
    summaryStatus: i.summaryStatus ?? 'idle',
    summaryType: i.summaryType ?? 'resumen',
  }))
}

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

  // ── Interview selection ────────────────────────────────────────────────
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null)
  const [selectedTranscriptInterviewId, setSelectedTranscriptInterviewId] = useState<string | null>(null)
  const [selectedSummaryInterviewId, setSelectedSummaryInterviewId] = useState<string | null>(null)
  const [transcriptDraft, setTranscriptDraft] = useState('')

  // ── Audio devices ──────────────────────────────────────────────────────
  const [micDevices, setMicDevices] = useState<AudioDeviceOption[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([])
  const [_recordingMessage, setRecordingMessage] = useState('')

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
  const [settingsChunkDurationDraft, setSettingsChunkDurationDraft] = useState(30)
  const [settingsRecordingQualityDraft, setSettingsRecordingQualityDraft] = useState('high')
  const [settingsLanguageDraft, setSettingsLanguageDraft] = useState('es')
  const [settingsAutoSaveDraft, setSettingsAutoSaveDraft] = useState(true)
  const [settingsDateFormatDraft, setSettingsDateFormatDraft] = useState('DD/MM/YYYY')
  const [exportFormat, setExportFormat] = useState<'pdf' | 'txt' | 'clipboard'>('clipboard')
  const [userPhoto, setUserPhoto] = useState('')
  const [projDescDraft, setProjDescDraft] = useState('')
  const [candidateNotesDraft, setCandidateNotesDraft] = useState('')

  // ── Modals & overlays ──────────────────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingKeyDraft, setOnboardingKeyDraft] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [showNewCandidate, setShowNewCandidate] = useState(false)
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null)
  const [projectDraft, setProjectDraft] = useState(EMPTY_PROJECT)
  const [candidateDraft, setCandidateDraft] = useState(EMPTY_CANDIDATE)
  const [showSessionNameModal, setShowSessionNameModal] = useState(false)
  const [sessionNameDraft, setSessionNameDraft] = useState('')
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
  const [_playbackProgress, setPlaybackProgress] = useState(0)
  const [_playbackCurrentTime, setPlaybackCurrentTime] = useState(0)
  const [playbackRate, _setPlaybackRate] = useState(1)

  // ── Toasts ─────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([])

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
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)

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
  const selectedTranscriptInterview = candidateInterviews.find(i => i.id === selectedTranscriptInterviewId)
  const selectedSummaryInterview = candidateInterviews.find(i => i.id === selectedSummaryInterviewId)
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

  // ── Init: load config ──────────────────────────────────────────────────
  useEffect(() => {
    if (!window.desktopApp?.getConfig) { setConfigLoaded(true); return }
    void window.desktopApp.getConfig().then(cfg => {
      setGroqApiKey(cfg.groqApiKey ?? '')
      setTranscriptionModel(cfg.transcriptionModel ?? 'whisper-large-v3')
      setSummaryModel(cfg.summaryModel ?? 'llama-3.3-70b-versatile')
      setUserName(cfg.userName ?? '')
      setUserEmail(cfg.userEmail ?? '')
      setUserCompany(cfg.userCompany ?? '')
      setConfigLoaded(true)
    })
  }, [])

  // ── Show onboarding if no API key ──────────────────────────────────────
  useEffect(() => {
    if (!configLoaded) return
    const done = localStorage.getItem(ONBOARDING_KEY)
    if (!done && !groqApiKey) setShowOnboarding(true)
  }, [configLoaded, groqApiKey])

  // ── Init: load data + migration ────────────────────────────────────────
  useEffect(() => {
    const rawV2 = localStorage.getItem(V2_KEY)
    if (rawV2) {
      try {
        const d = JSON.parse(rawV2) as { projects: Project[]; candidates: Candidate[]; interviews: Interview[] }
        if (Array.isArray(d.projects)) setProjects(d.projects)
        if (Array.isArray(d.candidates)) setCandidates(d.candidates)
        if (Array.isArray(d.interviews)) setInterviews(normalizeInterviews(d.interviews))
      } catch { /* ignore */ }
      return
    }
    const rawV1 = localStorage.getItem(V1_KEY)
    if (!rawV1) return
    try {
      const v1 = JSON.parse(rawV1) as {
        candidates?: Array<{ id: string; name: string; email: string; phone: string; process: string }>
        interviews?: Interview[]
      }
      const cosmobrok: Project = { id: uid(), name: 'Cosmobrok', company: 'Cosmobrok', createdAt: new Date().toISOString(), status: 'active' }
      const migrated: Candidate[] = (v1.candidates ?? []).map(c => ({ id: c.id, projectId: cosmobrok.id, name: c.name, email: c.email, phone: c.phone, role: c.process }))
      setProjects([cosmobrok]); setCandidates(migrated); setInterviews(normalizeInterviews(v1.interviews ?? []))
    } catch { /* ignore */ }
  }, [])

  // ── Persist ────────────────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem(V2_KEY, JSON.stringify({ projects, candidates, interviews })) }, [projects, candidates, interviews])

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
    if (!activeCandidateId) { setSelectedInterviewId(null); setSelectedTranscriptInterviewId(null); setSelectedSummaryInterviewId(null); return }
    if (selectedInterviewId && candidateInterviews.some(i => i.id === selectedInterviewId)) return
    const first = candidateInterviews[0]?.id ?? null
    setSelectedInterviewId(first); setSelectedTranscriptInterviewId(first); setSelectedSummaryInterviewId(first)
  }, [candidateInterviews, activeCandidateId, selectedInterviewId])

  // ── Sync transcript draft ──────────────────────────────────────────────
  useEffect(() => { setTranscriptDraft(selectedTranscriptInterview?.transcriptEdited ?? '') }, [selectedTranscriptInterviewId, selectedTranscriptInterview])

  // ── Recording timer ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedInterview || selectedInterview.status !== 'recording') return
    const id = window.setInterval(() => setInterviews(c => c.map(i => i.id === selectedInterview.id ? { ...i, durationSec: i.durationSec + 1 } : i)), 1000)
    return () => window.clearInterval(id)
  }, [selectedInterview])

  // ── Audio devices ──────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        probe.getTracks().forEach(t => t.stop())
        const devs = await navigator.mediaDevices.enumerateDevices()
        setMicDevices(devs.filter(d => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, name: d.label || `Micrófono ${i + 1}` })))
        setOutputDevices(devs.filter(d => d.kind === 'audiooutput').map((d, i) => ({ id: d.deviceId, name: d.label || `Salida ${i + 1}` })))
      } catch { setRecordingMessage('No se pudieron cargar dispositivos de audio.') }
    }
    void load()
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────
  const updateInterview = (id: string, patch: Partial<Interview>) =>
    setInterviews(c => c.map(i => i.id === id ? { ...i, ...patch } : i))

  const cleanupRecording = () => {
    mediaRecorderRef.current = null
    micStreamRef.current?.getTracks().forEach(t => t.stop())
    systemStreamRef.current?.getTracks().forEach(t => t.stop())
    mixedStreamRef.current?.getTracks().forEach(t => t.stop())
    micStreamRef.current = systemStreamRef.current = mixedStreamRef.current = null
    if (audioContextRef.current) { void audioContextRef.current.close(); audioContextRef.current = null }
  }

  // ── Recording ──────────────────────────────────────────────────────────
  const handleStartRecording = async (interviewOverride?: Interview) => {
    const iv = interviewOverride ?? selectedInterview
    if (!iv?.micDeviceId) { setRecordingMessage('Selecciona un micrófono antes de grabar.'); return }
    try {
      setRecordingMessage('Solicitando permisos...')
      chunkRef.current = []
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: iv.micDeviceId } } })
      micStreamRef.current = micStream
      let sysStream: MediaStream | null = null
      try { sysStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true }); systemStreamRef.current = sysStream } catch { /* silent */ }
      const ctx = new AudioContext(); audioContextRef.current = ctx
      const dest = ctx.createMediaStreamDestination()
      ctx.createMediaStreamSource(micStream).connect(dest)
      if (sysStream?.getAudioTracks().length) ctx.createMediaStreamSource(sysStream).connect(dest)
      mixedStreamRef.current = dest.stream
      const recorder = new MediaRecorder(dest.stream)
      mediaRecorderRef.current = recorder
      activeInterviewIdRef.current = iv.id
      recorder.ondataavailable = e => { if (e.data.size > 0) chunkRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunkRef.current, { type: recorder.mimeType })
        const src = sysStream?.getAudioTracks().length ? 'mic+system' : 'mic'
        pendingBlobRef.current = blob; pendingMimeTypeRef.current = recorder.mimeType
        if (activeInterviewIdRef.current) updateInterview(activeInterviewIdRef.current, { status: 'stopped', captureSource: src })
        setSessionNameDraft(''); setShowSessionNameModal(true); cleanupRecording()
      }
      recorder.start(1000)
      updateInterview(iv.id, { status: 'recording', captureSource: sysStream?.getAudioTracks().length ? 'mic+system' : 'mic' })
      setRecordingMessage(sysStream ? 'Grabando micrófono + sistema.' : 'Grabando solo micrófono.')
    } catch { setRecordingMessage('No se pudo iniciar la grabación.'); cleanupRecording() }
  }

  const handleNewRecording = () => {
    if (!activeCandidateId) return
    const n: Interview = { id: uid(), candidateId: activeCandidateId, createdAt: new Date().toISOString(), sessionName: '', status: 'idle', durationSec: 0, micDeviceId: micDevices[0]?.id ?? '', outputDeviceId: outputDevices[0]?.id ?? '', transcriptOriginal: '', transcriptEdited: '', transcriptUpdatedAt: null, recordingUrl: null, recordingFilePath: null, captureSource: 'none', transcriptionStatus: 'pending', summaryInstructions: '', summaryText: '', summaryStatus: 'idle', summaryType: 'resumen' }
    setInterviews(c => [n, ...c])
    setSelectedInterviewId(n.id)
    setSelectedTranscriptInterviewId(n.id)
    setSelectedSummaryInterviewId(n.id)
    void handleStartRecording(n)
  }

  const handlePauseRecording = () => {
    if (!activeRecordingInterview) return
    mediaRecorderRef.current?.pause()
    updateInterview(activeRecordingInterview.id, { status: 'paused' })
  }

  const handleResumeRecording = () => {
    if (!activeRecordingInterview) return
    mediaRecorderRef.current?.resume()
    updateInterview(activeRecordingInterview.id, { status: 'recording' })
  }

  const handleStopRecording = () => {
    if (!activeRecordingInterview) return
    const r = mediaRecorderRef.current; if (!r) return
    if (r.state === 'paused') r.resume()
    r.stop()
  }

  const handleConfirmSessionName = async () => {
    if (!sessionNameDraft.trim()) return
    const blob = pendingBlobRef.current; const iId = activeInterviewIdRef.current
    if (!blob || !iId) return
    const iData = interviews.find(i => i.id === iId)
    const url = URL.createObjectURL(blob)
    setShowSessionNameModal(false); updateInterview(iId, { sessionName: sessionNameDraft.trim() })
    let filePath: string | null = null
    if (iData && window.desktopApp?.saveRecording) {
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const cand = candidates.find(c => c.id === iData.candidateId)
        const r = await window.desktopApp.saveRecording({ interviewId: iId, candidateName: cand?.name ?? 'candidata', createdAt: iData.createdAt, extension: getExt(pendingMimeTypeRef.current), audioBytes: bytes })
        filePath = r.filePath
      } catch { /* ignore */ }
    }
    updateInterview(iId, { recordingUrl: url, recordingFilePath: filePath })
    pendingBlobRef.current = null; toast('Grabación guardada')
    if (autoTranscribe && filePath) void handleTranscribe(iId)
  }

  // ── Transcription / Summary ────────────────────────────────────────────
  const handleTranscribe = async (interviewId: string) => {
    const interview = interviews.find(i => i.id === interviewId)
    if (!interview?.recordingFilePath || !window.desktopApp?.transcribeAudio) return
    updateInterview(interviewId, { transcriptionStatus: 'transcribing' })
    try {
      const result = await window.desktopApp.transcribeAudio({ filePath: interview.recordingFilePath })
      updateInterview(interviewId, { transcriptOriginal: result.text, transcriptEdited: result.text, transcriptionStatus: 'done' })
      if (selectedTranscriptInterviewId === interviewId) setTranscriptDraft(result.text)
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
    updateInterview(interviewId, { summaryStatus: 'generating' })
    try {
      const result = await window.desktopApp.generateSummary({ transcript: interview.transcriptEdited, instructions: interview.summaryInstructions, summaryType: interview.summaryType })
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
    setPlayingInterviewId(null); setPlaybackProgress(0); setPlaybackCurrentTime(0)
  }

  const handleTogglePlayback = (interview: Interview) => {
    const src = interview.recordingUrl ?? (interview.recordingFilePath ? 'file:///' + interview.recordingFilePath.replace(/\\/g, '/') : null)
    if (!src) return
    if (playingInterviewId === interview.id) { stopAudio(); return }
    stopAudio()
    const audio = new Audio(src); audio.playbackRate = playbackRate; audioRef.current = audio
    audio.ontimeupdate = () => {
      const total = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : interview.durationSec
      if (total > 0) { setPlaybackProgress(Math.min(audio.currentTime / total, 1)); setPlaybackCurrentTime(audio.currentTime) }
    }
    audio.onended = audio.onerror = () => { setPlayingInterviewId(null); setPlaybackProgress(0); setPlaybackCurrentTime(0) }
    void audio.play(); setPlayingInterviewId(interview.id)
  }

  // ── CRUD ───────────────────────────────────────────────────────────────
  const handleDeleteInterview = (interviewId: string) => {
    if (pendingDeleteId !== interviewId) { setPendingDeleteId(interviewId); return }
    setPendingDeleteId(null); if (playingInterviewId === interviewId) stopAudio()
    const interview = interviews.find(i => i.id === interviewId)
    if (interview?.recordingFilePath && window.desktopApp?.deleteRecording) void window.desktopApp.deleteRecording({ filePath: interview.recordingFilePath })
    setInterviews(c => c.filter(i => i.id !== interviewId)); toast('Entrevista eliminada')
  }

  const handleDeleteCandidate = (candidateId: string) => {
    if (pendingDeleteId !== candidateId) { setPendingDeleteId(candidateId); return }
    setPendingDeleteId(null)
    interviews.filter(i => i.candidateId === candidateId).forEach(i => { if (i.recordingFilePath && window.desktopApp?.deleteRecording) void window.desktopApp.deleteRecording({ filePath: i.recordingFilePath }) })
    setInterviews(c => c.filter(i => i.candidateId !== candidateId)); setCandidates(c => c.filter(x => x.id !== candidateId))
    if (activeCandidateId === candidateId) { setActiveCandidateId(null); setScreen('project-detail') }
    toast('Candidata eliminada')
  }

  const handleCreateCandidate = () => {
    if (!candidateDraft.name.trim() || !activeProjectId) return
    const c: Candidate = { id: uid(), projectId: activeProjectId, name: candidateDraft.name.trim(), email: candidateDraft.email.trim(), phone: candidateDraft.phone.trim(), role: candidateDraft.role.trim() }
    setCandidates(curr => [...curr, c]); setShowNewCandidate(false); setCandidateDraft(EMPTY_CANDIDATE); toast(`Candidata ${c.name} creada`)
  }

  const handleUpdateCandidate = () => {
    if (!editingCandidateId || !candidateDraft.name.trim()) return
    setCandidates(c => c.map(x => x.id === editingCandidateId ? { ...x, name: candidateDraft.name.trim(), email: candidateDraft.email.trim(), phone: candidateDraft.phone.trim(), role: candidateDraft.role.trim() } : x))
    setEditingCandidateId(null); setShowNewCandidate(false); setCandidateDraft(EMPTY_CANDIDATE); toast('Candidata actualizada')
  }

  const updateProject = (id: string, changes: Partial<Project>) => {
    setProjects(c => c.map(p => p.id === id ? { ...p, ...changes } : p))
  }

  const handleCreateProject = () => {
    if (!projectDraft.name.trim()) return
    const p: Project = { id: uid(), name: projectDraft.name.trim(), company: projectDraft.company.trim(), createdAt: new Date().toISOString(), status: projectDraft.status }
    setProjects(c => [...c, p]); setShowNewProject(false); setProjectDraft(EMPTY_PROJECT); toast(`Proyecto ${p.name} creado`)
  }

  const handleSaveSettings = async () => {
    if (window.desktopApp?.saveConfig) await window.desktopApp.saveConfig({ groqApiKey: settingsKeyDraft, transcriptionModel: settingsTxModelDraft, summaryModel: settingsSumModelDraft, userName: settingsNameDraft, userEmail: settingsEmailDraft, userCompany: settingsCompanyDraft })
    setGroqApiKey(settingsKeyDraft); setTranscriptionModel(settingsTxModelDraft); setSummaryModel(settingsSumModelDraft); setUserName(settingsNameDraft); setUserEmail(settingsEmailDraft); setUserCompany(settingsCompanyDraft)
    toast('Configuración guardada')
  }

  const openSettings = (tab: SettingsTab = 'api-keys') => {
    setSettingsKeyDraft(groqApiKey); setSettingsTxModelDraft(transcriptionModel); setSettingsSumModelDraft(summaryModel)
    setSettingsNameDraft(userName); setSettingsEmailDraft(userEmail); setSettingsCompanyDraft(userCompany)
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
    if (screen === 'candidates') return [{ label: 'Inicio', action: () => setScreen('dashboard') }, { label: 'Candidatas' }]
    if (screen === 'settings') return [{ label: 'Inicio', action: () => setScreen('dashboard') }, { label: 'Configuración' }]
    if (screen === 'profile') return [{ label: 'Inicio', action: () => setScreen('dashboard') }, { label: 'Mi Perfil' }]
    return []
  }, [screen, activeProject, activeCandidate])

  const userInitials = initials(userName || userEmail || 'U')

  // ════════════════════════════════════════════════════════ RENDER ══════

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
              <span className="dash-search-icon">🔍</span>
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
          </div>

          <div className="proj-list">
            {filteredProjects.length === 0 ? (
              <div className="empty-state">
                {projects.length === 0 ? (
                  <>
                    <div className="es-circle"><span className="es-icon">≡</span></div>
                    <h3 className="es-title">No tienes proyectos todavía</h3>
                    <p className="es-sub">Crea tu primer proyecto para empezar a gestionar candidatas</p>
                    <button type="button" className="primary-btn pill-btn es-btn" onClick={() => setShowNewProject(true)}>Nuevo proyecto</button>
                  </>
                ) : (
                  <><div className="empty-icon">◎</div><h3>Sin resultados</h3><p>Prueba otro filtro o búsqueda.</p></>
                )}
              </div>
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
                        <p className="plc-meta">{p.company} · Creado {fmtShort(p.createdAt)}</p>
                      </div>
                      <span className={`plc-badge${isClosed ? ' plc-badge--closed' : ' plc-badge--active'}`}>
                        {isClosed ? '■ Cerrado' : '● Activo'}
                      </span>
                    </div>
                    <div className="plc-bottom">
                      <div className="plc-stats">
                        <div className="plc-stat"><span className="plc-stat-num">{cCnt}</span><span className="plc-stat-lbl">candidatas</span></div>
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
            <span className="ap-plan-badge">✦ Pro Plan</span>
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
            <button type="button" className="primary-btn pill-btn ap-action-btn" onClick={() => setShowNewProject(true)}>Nuevo proyecto</button>
            <button type="button" className="outline-btn pill-btn ap-action-btn" onClick={() => { if (projects.length > 0) goToProject(projects[0].id) }}>🎙 Nueva entrevista</button>
            <button type="button" className="outline-btn pill-btn ap-action-btn" onClick={() => { setExportCandidateId(null); setShowExport(true) }}>📤 Exportar informes</button>
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
                    <span>{i.summaryStatus === 'done' ? '📝' : '🎙'} {i.sessionName || 'Entrevista'} — {cand?.name ?? '—'}</span>
                  </div>
                )
              })
            }
          </div>
          <button type="button" className="ap-logout">Cerrar sesión</button>
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
        </div>
        {isFiltered && <p className="proj-results-label">{filteredProjects.length} resultado{filteredProjects.length !== 1 ? 's' : ''}{projectSearchQuery.trim() ? ` para "${projectSearchQuery}"` : ''}</p>}
        {filteredProjects.length === 0 ? (
          isFiltered
            ? <div className="empty-state"><div className="empty-icon">≡</div><h3>Sin resultados</h3><p>No hay proyectos que coincidan con los filtros aplicados.</p></div>
            : <div className="empty-state">
                <div className="es-circle"><span className="es-icon">≡</span></div>
                <h3 className="es-title">No tienes proyectos todavía</h3>
                <p className="es-sub">Crea tu primer proyecto para empezar a gestionar candidatas</p>
                <button type="button" className="primary-btn pill-btn es-btn" onClick={() => setShowNewProject(true)}>Nuevo proyecto</button>
              </div>
        ) : (
          <div className="proj-list">
            {filteredProjects.map(p => {
              const cCnt = candidates.filter(c => c.projectId === p.id).length
              const iCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id).length
              const tCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id && i.transcriptionStatus === 'done').length
              return (
                <div key={p.id} className="proj-list-card" onClick={() => goToProject(p.id)}>
                  <div className="proj-list-card-accent" />
                  <div className="proj-list-card-body">
                    <div className="proj-list-card-info">
                      <span className="proj-list-card-title">{p.name}</span>
                      <span className="proj-list-card-meta">{p.company}  ·  {p.status === 'active' ? 'Activo' : 'Cerrado'}  ·  {cCnt} candidata{cCnt !== 1 ? 's' : ''}</span>
                      <span className="proj-list-card-stats">{tCnt} transcrita{tCnt !== 1 ? 's' : ''}  ·  {iCnt} grabacion{iCnt !== 1 ? 'es' : ''}</span>
                    </div>
                    <span className={`proj-list-card-badge${p.status === 'active' ? ' proj-list-card-badge--active' : ' proj-list-card-badge--closed'}`}>
                      {p.status === 'active' ? '● Activo' : '■ Cerrado'}
                    </span>
                    <div className="proj-list-card-actions">
                      <button type="button" className="proj-list-card-btn" onClick={e => { e.stopPropagation(); goToProject(p.id) }}>Abrir →</button>
                      <button
                        type="button"
                        className={`plc-status-btn${p.status === 'closed' ? ' plc-status-btn--reopen' : ' plc-status-btn--close'}`}
                        onClick={e => { e.stopPropagation(); updateProject(p.id, { status: p.status === 'closed' ? 'active' : 'closed' }) }}
                      >{p.status === 'closed' ? 'Reabrir' : 'Cerrar'}</button>
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
              <p className="proj-header-sub">{activeProject.company} · Creado {fmtShort(activeProject.createdAt)}</p>
            </div>
            <div className="proj-header-stats">
              <div className="proj-stat"><span className="proj-stat-n">{projectCandidates.length}</span><span className="proj-stat-l">candidatas</span></div>
              <div className="proj-stat"><span className="proj-stat-n">{iCount}</span><span className="proj-stat-l">entrevistas</span></div>
              <div className="proj-stat"><span className="proj-stat-n">{tCount}</span><span className="proj-stat-l">transcritas</span></div>
            </div>
            <div className="proj-header-actions">
              <button type="button" className="btn-icon" title="Exportar" onClick={() => { setExportCandidateId(null); setShowExport(true) }}><DownloadIcon /></button>
            </div>
          </div>
        </div>

        {/* Section header */}
        <div className="proj-section-header">
          <h3 className="proj-section-title">Candidatas del proceso</h3>
          <button type="button" className="primary-btn pill-btn" onClick={() => { setCandidateDraft(EMPTY_CANDIDATE); setShowNewCandidate(true) }}>Nueva candidata</button>
        </div>

        {/* Search */}
        <div className="search-bar">
          <span className="search-icon"><SearchIcon /></span>
          <input type="text" placeholder="Buscar por nombre, email o puesto..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && <button type="button" className="search-clear" onClick={() => setSearchQuery('')}>✕</button>}
        </div>

        {filteredCandidates.length === 0 ? (
          searchQuery
            ? <div className="empty-state"><div className="empty-icon">◎</div><h3>Sin resultados</h3><p>No hay candidatas que coincidan con "{searchQuery}"</p></div>
            : <div className="empty-state">
                <div className="es-circle"><span className="es-icon">◎</span></div>
                <h3 className="es-title">No hay candidatas en este proyecto</h3>
                <p className="es-sub">Añade tu primera candidata para empezar a grabar y transcribir entrevistas</p>
                <button type="button" className="primary-btn pill-btn es-btn" onClick={() => { setCandidateDraft(EMPTY_CANDIDATE); setShowNewCandidate(true) }}>Nueva candidata</button>
              </div>
        ) : (
          <div className="pdc-list">
            {filteredCandidates.map(c => {
              const ci = interviews.filter(i => i.candidateId === c.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              const last = ci[0]
              const hasDone = ci.some(i => i.transcriptionStatus === 'done')
              const hasPending = ci.some(i => i.transcriptionStatus === 'pending')
              const statusInfo: [string, string] = last
                ? hasDone ? ['● Transcrita', 'pdc-badge--done'] : hasPending ? ['● Pendiente', 'pdc-badge--pending'] : ['● Sin transcripción', 'pdc-badge--pending']
                : ['○ Sin entrevista', 'pdc-badge--none']
              return (
                <div key={c.id} className="pdc-row" onClick={() => goToCandidate(c.id, activeProject.id)}>
                  <div className="pdc-row-accent" />
                  <div className="pdc-row-body">
                    <div className="pdc-row-info">
                      <span className="pdc-row-name">{c.name}</span>
                      <span className="pdc-row-meta">{c.email}{last ? ` · Última entrevista: ${fmtShort(last.createdAt)}` : c.role ? ` · ${c.role}` : ''}</span>
                    </div>
                    <span className={`pdc-badge ${statusInfo[1]}`}>{statusInfo[0]}</span>
                    <div className="pdc-row-actions" onClick={e => e.stopPropagation()}>
                      <button type="button" className="btn-icon" title="Editar" onClick={() => { setCandidateDraft({ name: c.name, email: c.email, phone: c.phone, role: c.role }); setEditingCandidateId(c.id); setShowNewCandidate(true) }}><PencilIcon /></button>
                      <button type="button" className={`btn-trash${pendingDeleteId === c.id ? ' confirming' : ''}`} onClick={() => handleDeleteCandidate(c.id)}>{pendingDeleteId === c.id ? <><CheckIcon /><span className="confirming-label">Confirmar</span></> : <TrashIcon />}</button>
                      <button type="button" className="pdc-open-btn" onClick={() => goToCandidate(c.id, activeProject.id)}>Ver entrevistas</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
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
          <div><h2>Candidatas</h2><p className="screen-sub">{candidates.length} candidata{candidates.length !== 1 ? 's' : ''}</p></div>
        </div>
        <div className="search-bar">
          <span className="search-icon"><SearchIcon /></span>
          <input type="text" placeholder="Buscar por nombre, email o puesto..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && <button type="button" className="search-clear" onClick={() => setSearchQuery('')}>✕</button>}
        </div>
        {allCandidates.length === 0 ? (
          searchQuery
            ? <div className="empty-state"><div className="empty-icon">◎</div><h3>Sin resultados</h3><p>No hay candidatas que coincidan con "{searchQuery}"</p></div>
            : <div className="empty-state"><div className="empty-icon">◎</div><h3>Sin candidatas</h3><p>Las candidatas aparecerán aquí cuando las añadas a un proyecto.</p></div>
        ) : (
          <div className="candidates-table">
            {allCandidates.map(c => {
              const project = projects.find(p => p.id === c.projectId)
              const ci = interviews.filter(i => i.candidateId === c.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              const last = ci[0]
              const hasDone = ci.some(i => i.transcriptionStatus === 'done')
              const hasPending = ci.some(i => i.transcriptionStatus === 'pending')
              const [statusLabel, statusCls] = last
                ? hasDone ? ['● Transcrita', 'status-done'] : hasPending ? ['● Pendiente', 'status-pending'] : ['● Sin transcripción', 'status-pending']
                : ['○ Sin entrevista', 'status-none']
              return (
                <div key={c.id} className="ctr" onClick={() => goToCandidate(c.id, c.projectId)}>
                  <div className="ctr-avatar">{initials(c.name)}</div>
                  <div className="ctr-info">
                    <span className="ctr-name">{c.name}</span>
                    <span className="ctr-meta">{project ? `${project.name}` : ''}{c.role ? ` · ${c.role}` : ''}{last ? ` · Última: ${fmtShort(last.createdAt)}` : ''}</span>
                  </div>
                  <span className={`ctr-status ${statusCls}`}>{statusLabel}</span>
                  <div className="ctr-actions" onClick={e => e.stopPropagation()}>
                    <button type="button" className="btn-icon" title="Exportar" onClick={() => { setExportCandidateId(c.id); setShowExport(true) }}><DownloadIcon /></button>
                    <button type="button" className="btn-icon" title="Editar" onClick={() => { setCandidateDraft({ name: c.name, email: c.email, phone: c.phone, role: c.role }); setEditingCandidateId(c.id); setShowNewCandidate(true) }}><PencilIcon /></button>
                    <button type="button" className={`btn-trash${pendingDeleteId === c.id ? ' confirming' : ''}`} title={pendingDeleteId === c.id ? '¿Confirmar eliminación?' : 'Eliminar candidata'} onClick={() => handleDeleteCandidate(c.id)}>{pendingDeleteId === c.id ? <><CheckIcon /><span className="confirming-label">Confirmar</span></> : <TrashIcon />}</button>
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
                {hasError ? '● Error' : transcribedCount > 0 ? '● Transcrita' : '○ Pendiente'}
              </span>
              <div className="cand-header-actions">
                <button type="button" className="btn-icon" title="Exportar" onClick={() => { setExportCandidateId(activeCandidate.id); setShowExport(true) }}><DownloadIcon /></button>
                <button type="button" className="btn-icon" title="Editar" onClick={() => { setCandidateDraft({ name: activeCandidate.name, email: activeCandidate.email, phone: activeCandidate.phone, role: activeCandidate.role }); setEditingCandidateId(activeCandidate.id); setShowNewCandidate(true) }}><PencilIcon /></button>
              </div>
            </div>
          </div>
        </div>
        <div className="profile-tabs-pill">
          {([['entrevistas', '🎙 Entrevistas'], ['transcripcion', '📝 Transcripción'], ['resumen', '✨ Resumen IA']] as [ProfileTab, string][]).map(([tab, label]) => (
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
        <button type="button" className="primary-btn pill-btn" onClick={handleNewRecording}>🎙 Nueva grabación</button>
      </div>
      {candidateInterviews.length === 0 ? (
        <div className="rec-empty-card">
          <div className="rec-empty-icon-wrap"><span className="rec-empty-icon">🎙</span></div>
          <h3 className="rec-empty-title">No hay grabaciones todavía</h3>
          <p className="rec-empty-sub">Graba la primera entrevista con {activeCandidate?.name ?? 'la candidata'} para empezar</p>
          <button type="button" className="primary-btn pill-btn" onClick={handleNewRecording}>🎙 Nueva grabación</button>
        </div>
      ) : (
        <div className="rec-rows">
          {candidateInterviews.map(iv => {
            const isDone = iv.transcriptionStatus === 'done'
            const isError = iv.transcriptionStatus === 'error'
            const isTranscribing = iv.transcriptionStatus === 'transcribing'
            return (
              <div key={iv.id} className="rec-row">
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
                      <span className="rec-row-name">{iv.sessionName || fmtDate(iv.createdAt)}</span>
                    )}
                  </div>
                  <span className="rec-row-meta">{fmtShort(iv.createdAt)}{iv.durationSec > 0 ? `  ·  ${fmt(iv.durationSec)}` : ''}</span>
                </div>
                <span className={`rec-row-badge${isDone ? ' rec-row-badge--done' : isError ? ' rec-row-badge--error' : isTranscribing ? ' rec-row-badge--transcribing' : ' rec-row-badge--pending'}`}>
                  {isDone ? '✓ Transcrita' : isError ? '⚠ Error' : isTranscribing ? '↻ Transcribiendo' : '⏳ Pendiente'}
                </span>
                <div className="rec-row-actions" onClick={e => e.stopPropagation()}>
                  {(iv.recordingUrl ?? iv.recordingFilePath) && (
                    <button type="button" className="btn-icon" title="Reproducir" onClick={() => handleTogglePlayback(iv)}>{playingInterviewId === iv.id ? <PauseIconSm /> : <PlayIcon />}</button>
                  )}
                  <button type="button" className="btn-icon" title="Renombrar" onClick={() => { setEditingInterviewId(iv.id); setEditingNameDraft(iv.sessionName || fmtDate(iv.createdAt)) }}><PencilIcon /></button>
                  <button type="button" className={`btn-trash${pendingDeleteId === iv.id ? ' confirming' : ''}`} title={pendingDeleteId === iv.id ? '¿Confirmar?' : 'Eliminar'} onClick={() => handleDeleteInterview(iv.id)}>
                    {pendingDeleteId === iv.id ? <><CheckIcon /><span className="confirming-label">Confirmar</span></> : <TrashIcon />}
                  </button>
                </div>
                {isDone ? (
                  <button type="button" className="rec-row-btn rec-row-btn--outline" onClick={() => { setSelectedTranscriptInterviewId(iv.id); setActiveTab('transcripcion') }}>Ver transcripción</button>
                ) : iv.recordingFilePath && !isTranscribing ? (
                  <button type="button" className="rec-row-btn rec-row-btn--primary" onClick={() => void handleTranscribe(iv.id)}>{isError ? '↺ Reintentar' : '▶ Transcribir'}</button>
                ) : isTranscribing ? (
                  <div className="rec-row-spinner"><span className="spinner" /></div>
                ) : null}
              </div>
            )
          })}
        </div>
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
            const isSelected = iv.id === selectedTranscriptInterviewId
            return (
              <div key={iv.id} className={`trx-list-item${isSelected ? ' is-selected' : ''}`} onClick={() => setSelectedTranscriptInterviewId(iv.id)}>
                <div className="trx-list-item-info">
                  <span className="trx-list-item-name">{iv.sessionName || fmtDate(iv.createdAt)}</span>
                  <span className="trx-list-item-date">{fmtShort(iv.createdAt)}</span>
                </div>
                <div className="trx-list-item-bottom">
                  <span className={`trx-status-badge${hasDone ? ' trx-status-badge--done' : ''}`}>{hasDone ? '● Transcrita' : '○ Pendiente'}</span>
                  {iv.recordingFilePath && !hasDone && (
                    <button type="button" className="trx-transcribe-btn" onClick={e => { e.stopPropagation(); void handleTranscribe(iv.id) }}>Transcribir</button>
                  )}
                </div>
              </div>
            )
          })}
        </aside>
        <div className="trx-separator" />
        <div className="trx-editor-panel">
          {selectedTranscriptInterview ? (
            <>
              <div className="trx-toolbar">
                <div className="trx-search"><SearchIcon /><input type="text" placeholder="Buscar en transcripción..." /></div>
                <button type="button" className="trx-tool-btn trx-tool-btn--outline" onClick={async () => { try { await navigator.clipboard.writeText(transcriptDraft); toast('Copiada') } catch { toast('No se pudo copiar', 'error') } }}>📋 Copiar todo</button>
                <button type="button" className="trx-tool-btn trx-tool-btn--primary" onClick={() => { const blob = new Blob([transcriptDraft], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${selectedTranscriptInterview.sessionName || 'transcripcion'}.txt`; a.click(); URL.revokeObjectURL(url) }}>📤 Descargar .txt</button>
              </div>
              {selectedTranscriptInterview.transcriptionStatus === 'transcribing' && <div className="spinner-row"><span className="spinner" /><span>Transcripción en curso...</span><button type="button" className="secondary-btn" style={{ marginLeft: 12 }} onClick={() => updateInterview(selectedTranscriptInterview.id, { transcriptionStatus: 'pending' })}>Cancelar</button></div>}
              {selectedTranscriptInterview.transcriptionStatus === 'error' && (
                <div className="trx-error-card">
                  <div className="trx-error-accent" />
                  <div className="trx-error-body">
                    <div className="trx-error-icon-wrap"><span className="trx-error-icon">⚠</span></div>
                    <h3 className="trx-error-title">Error al transcribir</h3>
                    <p className="trx-error-sub1">No se pudo completar la transcripción.</p>
                    <p className="trx-error-sub2">Verifica tu clave API de Groq o inténtalo de nuevo.</p>
                    <button type="button" className="primary-btn pill-btn trx-error-btn" onClick={() => void handleTranscribe(selectedTranscriptInterview.id)}>↺  Reintentar</button>
                    <button type="button" className="link-btn trx-error-back" onClick={() => setActiveTab('entrevistas')}>← Volver a grabaciones</button>
                  </div>
                </div>
              )}
              {selectedTranscriptInterview.transcriptionStatus !== 'transcribing' && (
                !selectedTranscriptInterview.transcriptEdited ? (
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
                <span className="trx-footer-info">✏️ Haz clic para editar · {wordCount} palabras · {readingMin} min</span>
                <div className="trx-footer-actions">
                  <button type="button" className="trx-footer-btn" onClick={() => { updateInterview(selectedTranscriptInterview.id, { transcriptEdited: transcriptDraft, transcriptUpdatedAt: new Date().toISOString() }); toast('Transcripción guardada') }}>Guardar</button>
                  <button type="button" className="trx-footer-btn" onClick={() => setTranscriptDraft(selectedTranscriptInterview.transcriptOriginal)}>Restaurar original</button>
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
    const summarySections = selectedSummaryInterview?.summaryText ? parseSections(selectedSummaryInterview.summaryText) : []
    return (
      <div className="transcript-layout-v2">
        <aside className="trx-list-panel">
          {candidateInterviews.length === 0 ? <p className="tab-note">No hay entrevistas todavía.</p> : candidateInterviews.map(iv => {
            const hasSummary = iv.summaryStatus === 'done' || !!iv.summaryText
            const isSelected = iv.id === selectedSummaryInterviewId
            return (
              <div key={iv.id} className={`trx-list-item${isSelected ? ' is-selected' : ''}`} onClick={() => setSelectedSummaryInterviewId(iv.id)}>
                <div className="trx-list-item-info">
                  <span className="trx-list-item-name">{iv.sessionName || fmtDate(iv.createdAt)}</span>
                  <span className="trx-list-item-date">{fmtShort(iv.createdAt)}</span>
                </div>
                <div className="trx-list-item-bottom">
                  <span className={`trx-status-badge${hasSummary ? ' trx-status-badge--done' : ''}`}>{hasSummary ? '✨ Con resumen' : '○ Sin resumen'}</span>
                </div>
              </div>
            )
          })}
        </aside>
        <div className="trx-separator" />
        <div className="trx-editor-panel">
          {selectedSummaryInterview ? (
            <>
              <div className="trx-toolbar">
                <select className={`sum-type-select${selectedSummaryInterview.summaryType === 'resumen' ? ' sum-type-select--active' : ''}`} value={selectedSummaryInterview.summaryType} onChange={e => updateInterview(selectedSummaryInterview.id, { summaryType: e.target.value as 'resumen' | 'listado' })}>
                  <option value="resumen">Resumen descriptivo ⌄</option>
                  <option value="listado">Listado por puntos ⌄</option>
                </select>
                <button type="button" className="trx-tool-btn trx-tool-btn--copy" disabled={!selectedSummaryInterview.summaryText} onClick={async () => { try { await navigator.clipboard.writeText(selectedSummaryInterview.summaryText); toast('Resumen copiado') } catch { toast('No se pudo copiar', 'error') } }}>⎘ Copiar</button>
                <button type="button" className="trx-tool-btn trx-tool-btn--primary" onClick={() => void handleGenerateSummary(selectedSummaryInterview.id)} disabled={!groqApiKey || selectedSummaryInterview.transcriptionStatus !== 'done' || selectedSummaryInterview.summaryStatus === 'generating'}>✦ Regenerar</button>
              </div>
              {!groqApiKey && <p className="warning-note">Configura tu API key de Groq en <button type="button" className="link-btn" onClick={() => openSettings()}>Configuración</button></p>}
              {selectedSummaryInterview.transcriptionStatus !== 'done' && <p className="warning-note">Primero transcribe la entrevista</p>}
              {selectedSummaryInterview.summaryStatus === 'generating' && <div className="spinner-row"><span className="spinner" /><span>Generando resumen...</span></div>}
              {selectedSummaryInterview.summaryStatus === 'error' && <p className="error-note">Error. Inténtalo de nuevo.</p>}
              <div className="sum-instructions">
                <textarea value={selectedSummaryInterview.summaryInstructions} onChange={e => updateInterview(selectedSummaryInterview.id, { summaryInstructions: e.target.value })} rows={2} placeholder={selectedSummaryInterview.summaryType === 'listado' ? 'Ej: Trayectoria, Habilidades, Pretensiones salariales' : 'Ej: Candidata para puesto administrativo'} />
              </div>
              {selectedSummaryInterview.summaryText ? (
                selectedSummaryInterview.summaryType === 'resumen' ? (
                  <div className="sum-prose-card">
                    <p className="sum-prose-text">{selectedSummaryInterview.summaryText}</p>
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
                  <div className="summary-result"><textarea value={selectedSummaryInterview.summaryText} onChange={e => updateInterview(selectedSummaryInterview.id, { summaryText: e.target.value })} rows={10} /></div>
                )
              ) : (
                selectedSummaryInterview.transcriptionStatus === 'done' && selectedSummaryInterview.summaryStatus !== 'generating' && (
                  <button type="button" className="gen-summary-btn" onClick={() => void handleGenerateSummary(selectedSummaryInterview.id)} disabled={!groqApiKey}>
                    ✦ Generar resumen con IA
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
                    <option value="distil-whisper-large-v3-en">distil-whisper-large-v3-en — Solo inglés</option>
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
                  <div className="settings-section-label">COMPORTAMIENTO</div>
                  <div className="settings-section-divider" />
                  <div className="toggle-row">
                    <div><span className="toggle-label">Transcripción automática</span><span className="notif-sub">Transcribir automáticamente al terminar cada grabación</span></div>
                    <button type="button" className={`toggle-btn${autoTranscribe ? ' on' : ''}`} onClick={() => setAutoTranscribe(t => !t)}><span className="toggle-circle" /></button>
                  </div>
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
                    <div className="prof-avatar-overlay">📷</div>
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
                  <label className="modal-label">Cargo<input type="text" className="modal-input" placeholder="Tu cargo" /></label>
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
                    <p className="prof-plan-label">Plan actual</p>
                    <div className="prof-plan-badge">✦ Pro Plan</div>
                    <div className="prof-plan-card-divider" />
                    <p className="prof-plan-email">{userEmail || 'usuario'}</p>
                    <p className="prof-plan-since">Miembro desde mayo 2026</p>
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
                <div className="settings-save"><button type="button" className="primary-btn pill-btn sec-update-btn" onClick={() => { toast('Contraseña actualizada'); setSettingsPasswordDraft(''); setSettingsPasswordNewDraft(''); setSettingsPasswordConfirmDraft('') }}>Actualizar contraseña</button></div>
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
                  <button type="button" className="toggle-btn"><span className="toggle-circle" /></button>
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

  const renderRecordingScreen = () => {
    if (!activeRecordingInterview) return null
    const isRecording = activeRecordingInterview.status === 'recording'
    const contextLabel = [activeRecordingCandidate?.name, activeRecordingProject ? `Proyecto: ${activeRecordingProject.name}` : null].filter(Boolean).join('  ·  ')
    return (
      <div className="rec-screen">
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
          {cand && <p className="proc-candidate">{cand.name} — {transcribingInterview.sessionName || fmtDate(transcribingInterview.createdAt)}</p>}
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
          let out = `## ${i.sessionName || fmtDate(i.createdAt)}\n`
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
        toast('Exportación PDF no disponible en esta versión', 'warning'); setShowExport(false)
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

  return (
    <div className="app-shell">
      {/* Global top bar */}
      <header className="global-top-bar">
        <div className="gtb-accent" />
        <span className="gtb-title">Call Transcriber</span>
      </header>

      {activeRecordingInterview && renderRecordingScreen()}

      <div className="app-body" style={activeRecordingInterview ? { display: 'none' } : undefined}>
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
              <button type="button" className={`nav-item${(screen === 'candidates' || screen === 'candidate-detail') ? ' is-active' : ''}`} onClick={() => setScreen('candidates')}><UsersIcon /><span>Candidatas</span></button>
            </nav>
            <div className="sidebar-bottom">
              <button type="button" className="sidebar-user" onClick={() => setShowProfilePopup(p => !p)}>
                <div className="sidebar-avatar" style={{ background: userPhoto ? 'transparent' : undefined, padding: 0, overflow: 'hidden' }}>
                    {userPhoto ? <img src={userPhoto} alt="U" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : userInitials}
                  </div>
                <div className="sidebar-user-info">
                  <span className="sidebar-user-name">{userName || 'Usuario'}</span>
                  <span className="sidebar-user-email">{userEmail}</span>
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
            {screen === 'dashboard' && renderDashboard()}
            {screen === 'projects' && renderProjects()}
            {screen === 'project-detail' && renderProjectDetail()}
            {screen === 'candidates' && renderCandidates()}
            {screen === 'candidate-detail' && renderCandidateDetail()}
            {screen === 'settings' && renderSettings()}
            {screen === 'profile' && renderProfile()}
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
          <button type="button" className="pp-item pp-item--danger" onClick={() => setShowProfilePopup(false)}>→ Cerrar sesión</button>
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
            <label className="modal-label">Nombre<input type="text" className="modal-input" value={sessionNameDraft} onChange={e => setSessionNameDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && sessionNameDraft.trim()) void handleConfirmSessionName() }} placeholder="Ej: Primera entrevista técnica" autoFocus /></label>
            <div className="modal-actions">
              <button type="button" className="primary-btn" onClick={() => void handleConfirmSessionName()} disabled={!sessionNameDraft.trim()}>Guardar</button>
              <button type="button" onClick={() => { pendingBlobRef.current = null; setShowSessionNameModal(false) }}>Descartar grabación</button>
            </div>
          </div>
        </div>
      )}

      {/* Candidate modal */}
      {(showNewCandidate || editingCandidateId !== null) && (
        <div className="modal-overlay" onClick={() => { setShowNewCandidate(false); setEditingCandidateId(null); setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft('') }}>
          <div className="modal-box modal-box--figma" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">{editingCandidateId ? 'Editar candidata' : 'Nueva candidata'}</h2>
                <p className="modal-subtitle">Añade los datos de la persona a entrevistar</p>
              </div>
              <button type="button" className="modal-close" onClick={() => { setShowNewCandidate(false); setEditingCandidateId(null); setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft('') }}>✕</button>
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
              <span className="modal-field-label">Notas previas (opcional)</span>
              <textarea className="modal-input modal-input--figma modal-textarea" value={candidateNotesDraft} onChange={e => setCandidateNotesDraft(e.target.value)} placeholder="Puntos a tratar, perfil del CV, observaciones..." rows={3} />
            </div>
            <div className="modal-footer-divider" />
            <div className="modal-actions modal-actions--figma">
              <button type="button" className="modal-cancel-btn" onClick={() => { setShowNewCandidate(false); setEditingCandidateId(null); setCandidateDraft(EMPTY_CANDIDATE); setCandidateNotesDraft('') }}>Cancelar</button>
              <button type="button" className="modal-action-btn" onClick={editingCandidateId ? handleUpdateCandidate : handleCreateCandidate} disabled={!candidateDraft.name.trim()}>{editingCandidateId ? '👤 Guardar cambios' : '👤 Añadir candidata'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Project modal */}
      {showNewProject && (
        <div className="modal-overlay" onClick={() => { setShowNewProject(false); setProjectDraft(EMPTY_PROJECT); setProjDescDraft('') }}>
          <div className="modal-box modal-box--figma" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Nuevo proyecto</h2>
                <p className="modal-subtitle">Define el proceso de selección que vas a gestionar</p>
              </div>
              <button type="button" className="modal-close" onClick={() => { setShowNewProject(false); setProjectDraft(EMPTY_PROJECT); setProjDescDraft('') }}>✕</button>
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
              <span className="modal-field-label">Descripción (opcional)</span>
              <textarea className="modal-input modal-input--figma modal-textarea" value={projDescDraft} onChange={e => setProjDescDraft(e.target.value)} placeholder="Añade contexto sobre el proceso de selección..." rows={3} />
            </div>
            <div className="modal-footer-divider" />
            <div className="modal-actions modal-actions--figma">
              <button type="button" className="modal-cancel-btn" onClick={() => { setShowNewProject(false); setProjectDraft(EMPTY_PROJECT); setProjDescDraft('') }}>Cancelar</button>
              <button type="button" className="modal-action-btn" onClick={handleCreateProject} disabled={!projectDraft.name.trim()}>✦ Crear proyecto</button>
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
