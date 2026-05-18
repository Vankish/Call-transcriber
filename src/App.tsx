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
type Toast = { id: string; message: string; type: 'success' | 'error' | 'info' }
type Screen = 'dashboard' | 'projects' | 'project-detail' | 'candidate-detail' | 'settings' | 'profile'
type ProfileScreenTab = 'perfil' | 'plan' | 'seguridad' | 'notif'
type SettingsTab = 'general' | 'grabacion'

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

// ── Icons ──────────────────────────────────────────────────────────────────
const TrashIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
const CheckIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
const PencilIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
const PlayIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
const PauseIconSm = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
const PlusIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
const HomeIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
const FolderIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>

const SettingsIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
const UserIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
const ChevronRight = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
const MicIcon = () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
const SearchIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
const DownloadIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
const BellIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
const LockIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>

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

  // ── Interview selection ────────────────────────────────────────────────
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null)
  const [selectedTranscriptInterviewId, setSelectedTranscriptInterviewId] = useState<string | null>(null)
  const [selectedSummaryInterviewId, setSelectedSummaryInterviewId] = useState<string | null>(null)
  const [transcriptDraft, setTranscriptDraft] = useState('')

  // ── Audio devices ──────────────────────────────────────────────────────
  const [micDevices, setMicDevices] = useState<AudioDeviceOption[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([])
  const [recordingMessage, setRecordingMessage] = useState('')

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

  // ── Playback ───────────────────────────────────────────────────────────
  const [playingInterviewId, setPlayingInterviewId] = useState<string | null>(null)
  const [playbackProgress, setPlaybackProgress] = useState(0)
  const [playbackCurrentTime, setPlaybackCurrentTime] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)

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

  // ── Derived ────────────────────────────────────────────────────────────
  const activeProject = projects.find(p => p.id === activeProjectId) ?? null
  const activeCandidate = candidates.find(c => c.id === activeCandidateId) ?? null
  const projectCandidates = useMemo(() => candidates.filter(c => c.projectId === activeProjectId), [candidates, activeProjectId])
  const filteredCandidates = useMemo(() => {
    if (!searchQuery.trim()) return projectCandidates
    const q = searchQuery.toLowerCase()
    return projectCandidates.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.role.toLowerCase().includes(q))
  }, [projectCandidates, searchQuery])
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
  const exportCandidate = candidates.find(c => c.id === exportCandidateId) ?? null
  const exportInterviews = exportCandidateId ? interviews.filter(i => i.candidateId === exportCandidateId && i.transcriptionStatus === 'done') : []

  const stats = useMemo(() => ({
    projects: projects.length,
    interviews: interviews.length,
    transcribed: interviews.filter(i => i.transcriptionStatus === 'done').length,
    summaries: interviews.filter(i => i.summaryStatus === 'done').length,
  }), [projects, interviews])

  // ── Toast helper ───────────────────────────────────────────────────────
  const toast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = uid()
    setToasts(t => [...t, { id, message, type }])
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
  const handleStartRecording = async () => {
    if (!selectedInterview?.micDeviceId) { setRecordingMessage('Selecciona un micrófono antes de grabar.'); return }
    try {
      setRecordingMessage('Solicitando permisos...')
      chunkRef.current = []
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: selectedInterview.micDeviceId } } })
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
      activeInterviewIdRef.current = selectedInterview.id
      recorder.ondataavailable = e => { if (e.data.size > 0) chunkRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunkRef.current, { type: recorder.mimeType })
        const src = sysStream?.getAudioTracks().length ? 'mic+system' : 'mic'
        pendingBlobRef.current = blob; pendingMimeTypeRef.current = recorder.mimeType
        if (activeInterviewIdRef.current) updateInterview(activeInterviewIdRef.current, { status: 'stopped', captureSource: src })
        setSessionNameDraft(''); setShowSessionNameModal(true); cleanupRecording()
      }
      recorder.start(1000)
      updateInterview(selectedInterview.id, { status: 'recording', captureSource: sysStream?.getAudioTracks().length ? 'mic+system' : 'mic' })
      setRecordingMessage(sysStream ? 'Grabando micrófono + sistema.' : 'Grabando solo micrófono.')
    } catch { setRecordingMessage('No se pudo iniciar la grabación.'); cleanupRecording() }
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
    } catch { updateInterview(interviewId, { transcriptionStatus: 'error' }); if (notifErrors) toast('Error al transcribir', 'error') }
  }

  const handleGenerateSummary = async (interviewId: string) => {
    const interview = interviews.find(i => i.id === interviewId)
    if (!interview || !window.desktopApp?.generateSummary) return
    updateInterview(interviewId, { summaryStatus: 'generating' })
    try {
      const result = await window.desktopApp.generateSummary({ transcript: interview.transcriptEdited, instructions: interview.summaryInstructions, summaryType: interview.summaryType })
      updateInterview(interviewId, { summaryText: result.text, summaryStatus: 'done' })
      if (notifSummary) toast('Resumen generado')
    } catch { updateInterview(interviewId, { summaryStatus: 'error' }); if (notifErrors) toast('Error al generar resumen', 'error') }
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

  const handleCycleSpeed = () => {
    const rates: [number, number, number] = [1, 1.5, 2]
    const next = rates[(rates.indexOf(playbackRate as 1 | 1.5 | 2) + 1) % rates.length]
    setPlaybackRate(next); if (audioRef.current) audioRef.current.playbackRate = next
  }

  const handleBarMouseDown = (e: React.MouseEvent<HTMLDivElement>, interview: Interview) => {
    if (playingInterviewId !== interview.id || !audioRef.current) return
    e.preventDefault()
    const bar = e.currentTarget
    const seek = (x: number) => {
      const rect = bar.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width))
      const total = isFinite(audioRef.current!.duration) && audioRef.current!.duration > 0 ? audioRef.current!.duration : interview.durationSec
      audioRef.current!.currentTime = ratio * total; setPlaybackProgress(ratio); setPlaybackCurrentTime(ratio * total)
    }
    seek(e.clientX)
    const move = (ev: MouseEvent) => seek(ev.clientX)
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  // ── CRUD ───────────────────────────────────────────────────────────────
  const handleCreateInterview = () => {
    if (!activeCandidateId) return
    const n: Interview = { id: uid(), candidateId: activeCandidateId, createdAt: new Date().toISOString(), sessionName: '', status: 'idle', durationSec: 0, micDeviceId: micDevices[0]?.id ?? '', outputDeviceId: outputDevices[0]?.id ?? '', transcriptOriginal: '', transcriptEdited: '', transcriptUpdatedAt: null, recordingUrl: null, recordingFilePath: null, captureSource: 'none', transcriptionStatus: 'pending', summaryInstructions: '', summaryText: '', summaryStatus: 'idle', summaryType: 'resumen' }
    setInterviews(c => [n, ...c]); setSelectedInterviewId(n.id); setSelectedTranscriptInterviewId(n.id); setSelectedSummaryInterviewId(n.id); setActiveTab('entrevistas')
  }

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

  const openSettings = (tab: SettingsTab = 'general') => {
    setSettingsKeyDraft(groqApiKey); setSettingsTxModelDraft(transcriptionModel); setSettingsSumModelDraft(summaryModel)
    setSettingsNameDraft(userName); setSettingsEmailDraft(userEmail); setSettingsCompanyDraft(userCompany)
    setSettingsTab(tab); setScreen('settings')
  }

  const goToProject = (projectId: string) => { setActiveProjectId(projectId); setSearchQuery(''); setScreen('project-detail') }
  const goToCandidate = (candidateId: string, projectId?: string) => {
    if (projectId) setActiveProjectId(projectId)
    setActiveCandidateId(candidateId); setActiveTab('entrevistas'); setScreen('candidate-detail')
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
    if (screen === 'settings') return [{ label: 'Inicio', action: () => setScreen('dashboard') }, { label: 'Configuración' }]
    if (screen === 'profile') return [{ label: 'Inicio', action: () => setScreen('dashboard') }, { label: 'Mi Perfil' }]
    return []
  }, [screen, activeProject, activeCandidate])

  const userInitials = initials(userName || userEmail || 'U')

  // ════════════════════════════════════════════════════════ RENDER ══════

  const renderDashboard = () => {
    const recent = [...interviews].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5)
    return (
      <div className="screen-dashboard">
        <div className="dash-header">
          <div><h2>Inicio</h2><p className="screen-sub">Bienvenido, {userName || 'usuario'}</p></div>
        </div>
        <div className="stats-grid">
          {[['Proyectos', stats.projects], ['Entrevistas', stats.interviews], ['Transcritas', stats.transcribed], ['Resúmenes IA', stats.summaries]].map(([label, val]) => (
            <div key={label as string} className="stat-card"><span className="stat-value">{val}</span><span className="stat-label">{label}</span></div>
          ))}
        </div>
        <div className="dash-body">
          {projects.length > 0 && (
            <div className="dash-section">
              <div className="dash-section-head"><h3>Proyectos recientes</h3><button type="button" className="link-btn" onClick={() => setScreen('projects')}>Ver todos →</button></div>
              <ul className="project-mini-list">
                {projects.slice(0, 4).map(p => {
                  const cnt = candidates.filter(c => c.projectId === p.id).length
                  return (
                    <li key={p.id} className="project-mini-row" onClick={() => goToProject(p.id)}>
                      <div className="pmr-info"><span className="pmr-name">{p.name}</span><span className="pmr-company">{p.company} · Creado {fmtShort(p.createdAt)}</span></div>
                      <div className="pmr-right"><span className="pmr-count">{cnt} candidatas</span><span className={`status-badge status-${p.status}`}>{p.status === 'active' ? '● Activo' : '■ Cerrado'}</span></div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {recent.length > 0 && (
            <div className="dash-section">
              <div className="dash-section-head"><h3>Actividad reciente</h3></div>
              <ul className="activity-list">
                {recent.map(i => {
                  const cand = candidates.find(c => c.id === i.candidateId)
                  const proj = cand ? projects.find(p => p.id === cand.projectId) : null
                  return (
                    <li key={i.id} className="activity-row" onClick={() => cand && goToCandidate(cand.id, cand.projectId)}>
                      <span className="activity-icon">⊙</span>
                      <div className="activity-info"><span className="activity-title">{i.sessionName || 'Entrevista'}</span><span className="activity-sub">{cand?.name ?? '—'} · {proj?.name ?? '—'}</span></div>
                      <span className="activity-date">{fmtShort(i.createdAt)}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {projects.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">≡</div>
              <h3>Empieza creando un proyecto</h3>
              <p>Organiza tus candidatas por procesos de selección.</p>
              <button type="button" className="primary-btn" onClick={() => setShowNewProject(true)}>Crear primer proyecto</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderProjects = () => (
    <div className="screen-content">
      <div className="content-header">
        <div><h2>Proyectos</h2><p className="screen-sub">{projects.length} proyecto{projects.length !== 1 ? 's' : ''}</p></div>
      </div>
      {projects.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">≡</div><h3>Sin proyectos</h3><p>Crea tu primer proyecto para organizar candidatas.</p><button type="button" className="primary-btn" onClick={() => setShowNewProject(true)}>Crear proyecto</button></div>
      ) : (
        <div className="projects-grid">
          {projects.map(p => {
            const cCnt = candidates.filter(c => c.projectId === p.id).length
            const iCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id).length
            const tCnt = interviews.filter(i => candidates.find(c => c.id === i.candidateId)?.projectId === p.id && i.transcriptionStatus === 'done').length
            return (
              <div key={p.id} className="project-card" onClick={() => goToProject(p.id)}>
                <div className="pc-head">
                  <div><h3 className="pc-name">{p.name}</h3><p className="pc-company">{p.company} · {fmtShort(p.createdAt)}</p></div>
                  <span className={`status-badge status-${p.status}`}>{p.status === 'active' ? '● Activo' : '■ Cerrado'}</span>
                </div>
                <div className="pc-stats">
                  {[['candidatas', cCnt], ['entrevistas', iCnt], ['transcritas', tCnt]].map(([l, v]) => (
                    <div key={l as string}><span className="pc-stat-val">{v}</span><span className="pc-stat-lbl">{l}</span></div>
                  ))}
                </div>
                <button type="button" className="pc-open">Abrir proyecto →</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const renderProjectDetail = () => {
    if (!activeProject) return null
    return (
      <div className="screen-content">
        <div className="content-header">
          <div><h2>{activeProject.name}</h2><p className="screen-sub">{activeProject.company} · {projectCandidates.length} candidata{projectCandidates.length !== 1 ? 's' : ''}</p></div>
          <div className="content-header-actions">
            <button type="button" className="btn-icon-only" title="Exportar" onClick={() => { setExportCandidateId(null); setShowExport(true) }}><DownloadIcon /></button>
            <button type="button" className="primary-btn btn-icon-left" onClick={() => { setCandidateDraft(EMPTY_CANDIDATE); setShowNewCandidate(true) }}><PlusIcon /> Nueva candidata</button>
          </div>
        </div>
        <div className="search-bar">
          <span className="search-icon"><SearchIcon /></span>
          <input type="text" placeholder="Buscar por nombre, email o puesto..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && <button type="button" className="search-clear" onClick={() => setSearchQuery('')}>✕</button>}
        </div>
        {filteredCandidates.length === 0 ? (
          searchQuery ? (
            <div className="empty-state"><div className="empty-icon">◎</div><h3>Sin resultados</h3><p>No hay candidatas que coincidan con "{searchQuery}"</p></div>
          ) : (
            <div className="empty-state"><div className="empty-icon">◎</div><h3>Sin candidatas</h3><p>Añade candidatas a este proyecto.</p><button type="button" className="primary-btn" onClick={() => { setCandidateDraft(EMPTY_CANDIDATE); setShowNewCandidate(true) }}>Añadir candidata</button></div>
          )
        ) : (
          <div className="candidates-table">
            {filteredCandidates.map(c => {
              const ci = interviews.filter(i => i.candidateId === c.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              const last = ci[0]
              const hasDone = ci.some(i => i.transcriptionStatus === 'done')
              const hasPending = ci.some(i => i.transcriptionStatus === 'pending')
              const [statusLabel, statusCls] = last
                ? hasDone ? ['● Transcrita', 'status-done'] : hasPending ? ['● Pendiente', 'status-pending'] : ['● Sin transcripción', 'status-pending']
                : ['○ Sin entrevista', 'status-none']
              return (
                <div key={c.id} className="ctr" onClick={() => goToCandidate(c.id, activeProject.id)}>
                  <div className="ctr-avatar">{initials(c.name)}</div>
                  <div className="ctr-info"><span className="ctr-name">{c.name}</span><span className="ctr-meta">{c.email}{last ? ` · Última: ${fmtShort(last.createdAt)}` : ''}</span></div>
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
    return (
      <div className="screen-content screen-candidate">
        <div className="cdh">
          <div className="cdh-avatar">{initials(activeCandidate.name)}</div>
          <div className="cdh-info"><h2>{activeCandidate.name}</h2><p>{activeCandidate.role}{activeCandidate.email ? ` · ${activeCandidate.email}` : ''}</p></div>
          <div className="cdh-actions">
            <button type="button" className="btn-icon" title="Exportar" onClick={() => { setExportCandidateId(activeCandidate.id); setShowExport(true) }}><DownloadIcon /></button>
            <button type="button" className="btn-icon" title="Editar" onClick={() => { setCandidateDraft({ name: activeCandidate.name, email: activeCandidate.email, phone: activeCandidate.phone, role: activeCandidate.role }); setEditingCandidateId(activeCandidate.id); setShowNewCandidate(true) }}><PencilIcon /></button>
          </div>
        </div>
        <div className="profile-tabs">
          {(['entrevistas', 'transcripcion', 'resumen'] as ProfileTab[]).map(tab => (
            <button key={tab} type="button" className={activeTab === tab ? 'is-active' : ''} onClick={() => setActiveTab(tab)}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
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
    <div className="tab-content">
      <div className="tab-section-header">
        <h3>Sesión de entrevista</h3>
        <button type="button" className="primary-btn btn-icon-left" onClick={handleCreateInterview}><PlusIcon /> Nueva entrevista</button>
      </div>
      {selectedInterview ? (
        <div className="recording-panel">
          <p className="interview-time">Creada: {fmtDate(selectedInterview.createdAt)}</p>
          <div className="controls-row">
            <button type="button" className={`btn-record${selectedInterview.status === 'recording' ? ' is-recording' : ''}`} onClick={() => selectedInterview.status === 'paused' ? handleResumeRecording() : void handleStartRecording()} disabled={selectedInterview.status === 'recording'}>
              {selectedInterview.status === 'paused' ? 'Reanudar' : 'Grabar'}
            </button>
            <button type="button" className="btn-control" onClick={handlePauseRecording} disabled={selectedInterview.status !== 'recording'}>Pausar</button>
            <button type="button" className="btn-control" onClick={handleStopRecording} disabled={selectedInterview.status === 'idle' || selectedInterview.status === 'stopped'}>Parar</button>
            <span className="timer">{fmt(selectedInterview.durationSec)}</span>
          </div>
          <div className="device-grid">
            <label>Micrófono<select value={selectedInterview.micDeviceId} onChange={e => updateInterview(selectedInterview.id, { micDeviceId: e.target.value })}>{micDevices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label>Salida<select value={selectedInterview.outputDeviceId} onChange={e => updateInterview(selectedInterview.id, { outputDeviceId: e.target.value })}>{outputDevices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          </div>
          {recordingMessage && <p className="recording-message">{recordingMessage}</p>}
          {selectedInterview.transcriptionStatus === 'transcribing' && <div className="spinner-row"><span className="spinner" /><span>Transcribiendo...</span></div>}
          {selectedInterview.transcriptionStatus === 'error' && <p className="error-note">Error al transcribir. Ve a Transcripción para reintentar.</p>}
        </div>
      ) : <p className="tab-note">Pulsa "Nueva entrevista" para empezar.</p>}
      <div className="interviews-list">
        <p className="section-label">Historial de entrevistas</p>
        {candidateInterviews.length === 0 ? <p className="tab-note">Aún no hay entrevistas.</p> : (
          <ul>
            {candidateInterviews.map(iv => (
              <li key={iv.id} className="history-row">
                {editingInterviewId === iv.id ? (
                  <>
                    <input type="text" className="history-edit-input" value={editingNameDraft} onChange={e => setEditingNameDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { if (editingNameDraft.trim()) updateInterview(iv.id, { sessionName: editingNameDraft.trim() }); setEditingInterviewId(null) } if (e.key === 'Escape') setEditingInterviewId(null) }} autoFocus />
                    <button type="button" className="btn-icon btn-icon--confirm" onClick={() => { if (editingNameDraft.trim()) updateInterview(iv.id, { sessionName: editingNameDraft.trim() }); setEditingInterviewId(null) }}><CheckIcon /></button>
                    <button type="button" className="btn-icon" onClick={() => setEditingInterviewId(null)}>✕</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={`history-item${iv.id === selectedInterviewId ? ' is-selected' : ''}`} onClick={() => setSelectedInterviewId(iv.id)}>
                      <span className="history-item-name">{iv.sessionName || fmtDate(iv.createdAt)}</span>
                      {(iv.recordingFilePath ?? iv.recordingUrl) && (<>
                        <span className="playback-timer">{playingInterviewId === iv.id ? fmt(Math.floor(playbackCurrentTime)) : fmt(iv.durationSec)}</span>
                        <div className="speed-bar-group">
                          <button type="button" className="btn-speed" onClick={handleCycleSpeed}>x{playbackRate}</button>
                          <div className="playback-bar" onMouseDown={e => handleBarMouseDown(e, iv)}>
                            <div className="playback-bar-fill" style={{ width: playingInterviewId === iv.id ? `${playbackProgress * 100}%` : '0%' }} />
                            {playingInterviewId === iv.id && <div className="playback-bar-thumb" style={{ left: `${playbackProgress * 100}%` }} />}
                          </div>
                        </div>
                      </>)}
                    </button>
                    {(iv.recordingUrl ?? iv.recordingFilePath) && <button type="button" className="btn-icon" onClick={() => handleTogglePlayback(iv)}>{playingInterviewId === iv.id ? <PauseIconSm /> : <PlayIcon />}</button>}
                    <button type="button" className="btn-icon" onClick={() => { setEditingInterviewId(iv.id); setEditingNameDraft(iv.sessionName || fmtDate(iv.createdAt)) }}><PencilIcon /></button>
                    <button type="button" className={`btn-trash${pendingDeleteId === iv.id ? ' confirming' : ''}`} title={pendingDeleteId === iv.id ? '¿Confirmar eliminación?' : 'Eliminar entrevista'} onClick={() => handleDeleteInterview(iv.id)}>
                      {pendingDeleteId === iv.id ? <><CheckIcon /><span className="confirming-label">Confirmar</span></> : <TrashIcon />}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )

  const renderTranscriptTab = () => (
    <div className="tab-content">
      <div className="transcript-layout">
        <aside className="transcript-list">
          <p className="section-label">Entrevistas</p>
          {candidateInterviews.length === 0 ? <p className="tab-note">No hay entrevistas todavía.</p> : (
            <ul>{candidateInterviews.map(iv => (
              <li key={iv.id} className="history-row">
                <button type="button" className={`history-item${iv.id === selectedTranscriptInterviewId ? ' is-selected' : ''}`} onClick={() => setSelectedTranscriptInterviewId(iv.id)}><span className="history-item-name">{iv.sessionName || fmtDate(iv.createdAt)}</span></button>
                {(iv.recordingUrl ?? iv.recordingFilePath) && <button type="button" className="btn-icon" onClick={() => handleTogglePlayback(iv)}>{playingInterviewId === iv.id ? <PauseIconSm /> : <PlayIcon />}</button>}
              </li>
            ))}</ul>
          )}
        </aside>
        <div className="transcript-editor">
          <p className="section-label">Transcripción editable</p>
          {selectedTranscriptInterview ? (
            <>
              {selectedTranscriptInterview.transcriptionStatus === 'transcribing' && <div className="spinner-row"><span className="spinner" /><span>Transcripción en curso...</span><button type="button" className="secondary-btn" style={{ marginLeft: 12 }} onClick={() => updateInterview(selectedTranscriptInterview.id, { transcriptionStatus: 'pending' })}>Cancelar</button></div>}
              {selectedTranscriptInterview.transcriptionStatus === 'error' && <div className="error-block"><p className="error-note">Error al transcribir.</p><button type="button" className="secondary-btn" onClick={() => void handleTranscribe(selectedTranscriptInterview.id)}>Reintentar</button></div>}
              {selectedTranscriptInterview.transcriptionStatus !== 'transcribing' && (
                <>
                  {!selectedTranscriptInterview.transcriptEdited && <p className="tab-note empty-transcript">Sin transcripción — graba y transcribe esta entrevista para ver el texto aquí.</p>}
                  <textarea value={transcriptDraft} onChange={e => setTranscriptDraft(e.target.value)} rows={12} placeholder="La transcripción aparecerá aquí..." />
                  <div className="editor-actions">
                    <button type="button" className="primary-btn" onClick={() => { updateInterview(selectedTranscriptInterview.id, { transcriptEdited: transcriptDraft, transcriptUpdatedAt: new Date().toISOString() }); toast('Transcripción guardada') }}>Guardar</button>
                    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(transcriptDraft); toast('Copiada') } catch { toast('No se pudo copiar', 'error') } }}>Copiar</button>
                    <button type="button" onClick={() => setTranscriptDraft(selectedTranscriptInterview.transcriptOriginal)}>Restaurar original</button>
                    {selectedTranscriptInterview.recordingFilePath && <button type="button" className="primary-btn" onClick={() => void handleTranscribe(selectedTranscriptInterview.id)}>Transcribir</button>}
                  </div>
                </>
              )}
            </>
          ) : <p className="tab-note">Selecciona una entrevista para editar su transcripción.</p>}
        </div>
      </div>
    </div>
  )

  const renderSummaryTab = () => (
    <div className="tab-content">
      <div className="transcript-layout">
        <aside className="transcript-list">
          <p className="section-label">Entrevistas</p>
          {candidateInterviews.length === 0 ? <p className="tab-note">No hay entrevistas todavía.</p> : (
            <ul>{candidateInterviews.map(iv => (
              <li key={iv.id} className="history-row">
                <button type="button" className={`history-item${iv.id === selectedSummaryInterviewId ? ' is-selected' : ''}`} onClick={() => setSelectedSummaryInterviewId(iv.id)}><span className="history-item-name">{iv.sessionName || fmtDate(iv.createdAt)}</span></button>
                {(iv.recordingUrl ?? iv.recordingFilePath) && <button type="button" className="btn-icon" onClick={() => handleTogglePlayback(iv)}>{playingInterviewId === iv.id ? <PauseIconSm /> : <PlayIcon />}</button>}
              </li>
            ))}</ul>
          )}
        </aside>
        <div className="transcript-editor">
          <div className="summary-header">
            <p className="section-label">Resumen con IA</p>
            {selectedSummaryInterview && <select className="summary-type-select" value={selectedSummaryInterview.summaryType} onChange={e => updateInterview(selectedSummaryInterview.id, { summaryType: e.target.value as 'resumen' | 'listado' })}><option value="resumen">Resumen explicativo</option><option value="listado">Listado por puntos</option></select>}
          </div>
          {selectedSummaryInterview ? (
            <>
              {!groqApiKey && <p className="warning-note">Configura tu API key de Groq en <button type="button" className="link-btn" onClick={() => openSettings()}>Configuración</button></p>}
              {selectedSummaryInterview.transcriptionStatus !== 'done' && <p className="warning-note">Primero transcribe la entrevista</p>}
              <div className="summary-instructions">
                <label><span>{selectedSummaryInterview.summaryType === 'listado' ? '¿Qué secciones quieres?' : 'Contexto adicional (opcional)'}</span>
                  <textarea value={selectedSummaryInterview.summaryInstructions} onChange={e => updateInterview(selectedSummaryInterview.id, { summaryInstructions: e.target.value })} rows={selectedSummaryInterview.summaryType === 'listado' ? 4 : 2} placeholder={selectedSummaryInterview.summaryType === 'listado' ? 'Ej: Trayectoria, Habilidades, Pretensiones salariales' : 'Ej: Candidata para puesto administrativo'} />
                </label>
              </div>
              <div className="editor-actions">
                <button type="button" className="primary-btn" onClick={() => void handleGenerateSummary(selectedSummaryInterview.id)} disabled={!groqApiKey || selectedSummaryInterview.transcriptionStatus !== 'done' || selectedSummaryInterview.summaryStatus === 'generating'}>Generar resumen</button>
                <button type="button" className={`btn-copy${selectedSummaryInterview.summaryText ? ' btn-copy--filled' : ''}`} disabled={!selectedSummaryInterview.summaryText} onClick={async () => { try { await navigator.clipboard.writeText(selectedSummaryInterview.summaryText); toast('Resumen copiado') } catch { toast('No se pudo copiar', 'error') } }}>Copiar</button>
                {selectedSummaryInterview.summaryStatus === 'generating' && <div className="spinner-row"><span className="spinner" /><span>Generando...</span></div>}
                {selectedSummaryInterview.summaryStatus === 'error' && <p className="error-note">Error. Inténtalo de nuevo.</p>}
              </div>
              {(selectedSummaryInterview.summaryStatus === 'done' || selectedSummaryInterview.summaryText) && <div className="summary-result"><textarea value={selectedSummaryInterview.summaryText} onChange={e => updateInterview(selectedSummaryInterview.id, { summaryText: e.target.value })} rows={10} /></div>}
            </>
          ) : <p className="tab-note">Selecciona una entrevista para generar su resumen.</p>}
        </div>
      </div>
    </div>
  )

  const renderSettings = () => (
    <div className="screen-content">
      <div className="content-header"><h2>Configuración</h2></div>
      <div className="settings-tabs">
        <button type="button" className={settingsTab === 'general' ? 'is-active' : ''} onClick={() => setSettingsTab('general')}>General</button>
        <button type="button" className={settingsTab === 'grabacion' ? 'is-active' : ''} onClick={() => setSettingsTab('grabacion')}>Grabación</button>
      </div>
      {settingsTab === 'general' && (
        <div className="settings-sections">
          <div className="settings-section">
            <div className="settings-section-title">API Key</div>
            <p className="modal-link-note">Groq es gratuita — <a href="https://console.groq.com" target="_blank" rel="noreferrer">console.groq.com</a></p>
            <label className="modal-label">API Key de Groq<input type="password" className="modal-input" value={settingsKeyDraft} onChange={e => setSettingsKeyDraft(e.target.value)} placeholder="gsk_..." /></label>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Cuenta</div>
            <label className="modal-label">Nombre<input type="text" className="modal-input" value={settingsNameDraft} onChange={e => setSettingsNameDraft(e.target.value)} placeholder="Tu nombre" /></label>
            <label className="modal-label">Email<input type="email" className="modal-input" value={settingsEmailDraft} onChange={e => setSettingsEmailDraft(e.target.value)} placeholder="tu@email.com" /></label>
            <label className="modal-label">Empresa<input type="text" className="modal-input" value={settingsCompanyDraft} onChange={e => setSettingsCompanyDraft(e.target.value)} placeholder="Nombre de la empresa" /></label>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Modelos IA</div>
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
          <div className="settings-save"><button type="button" className="primary-btn" onClick={() => void handleSaveSettings()}>Guardar configuración</button></div>
        </div>
      )}
      {settingsTab === 'grabacion' && (
        <div className="settings-sections">
          <div className="settings-section">
            <div className="settings-section-title">Comportamiento</div>
            <div className="toggle-row">
              <div><span className="toggle-label">Transcripción automática</span><span className="toggle-desc">Transcribir automáticamente al terminar cada grabación</span></div>
              <button type="button" className={`toggle-btn${autoTranscribe ? ' on' : ''}`} onClick={() => setAutoTranscribe(t => !t)}><span className="toggle-circle" /></button>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Notificaciones</div>
            <div className="toggle-row">
              <div><span className="toggle-label">Transcripción completada</span></div>
              <button type="button" className={`toggle-btn${notifTranscription ? ' on' : ''}`} onClick={() => setNotifTranscription(t => !t)}><span className="toggle-circle" /></button>
            </div>
            <div className="toggle-row">
              <div><span className="toggle-label">Resumen generado</span></div>
              <button type="button" className={`toggle-btn${notifSummary ? ' on' : ''}`} onClick={() => setNotifSummary(t => !t)}><span className="toggle-circle" /></button>
            </div>
            <div className="toggle-row">
              <div><span className="toggle-label">Errores</span></div>
              <button type="button" className={`toggle-btn${notifErrors ? ' on' : ''}`} onClick={() => setNotifErrors(t => !t)}><span className="toggle-circle" /></button>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Dispositivos</div>
            <label className="modal-label">Micrófono preferido
              <select className="modal-input">{micDevices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            </label>
            <p className="device-help">La app intentará capturar audio del sistema (loopback). Si no está disponible, grabará solo el micrófono.</p>
          </div>
        </div>
      )}
    </div>
  )

  const renderProfile = () => (
    <div className="screen-content">
      <div className="content-header"><h2>Mi Perfil</h2></div>
      <div className="profile-screen-tabs">
        {(['perfil', 'plan', 'seguridad', 'notif'] as ProfileScreenTab[]).map(t => (
          <button key={t} type="button" className={profileScreenTab === t ? 'is-active' : ''} onClick={() => setProfileScreenTab(t)}>
            {t === 'perfil' ? 'Perfil' : t === 'plan' ? 'Plan & Uso' : t === 'seguridad' ? 'Seguridad' : 'Notificaciones'}
          </button>
        ))}
      </div>
      {profileScreenTab === 'perfil' && (
        <div className="settings-sections">
          <div className="settings-section">
            <div className="profile-avatar-block">
              <div className="profile-avatar-lg">{userInitials}</div>
              <div><p className="profile-avatar-name">{userName || 'Sin nombre'}</p><p className="profile-avatar-email">{userEmail || 'Sin email'}</p></div>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Información personal</div>
            <label className="modal-label">Nombre<input type="text" className="modal-input" value={settingsNameDraft} onChange={e => setSettingsNameDraft(e.target.value)} placeholder="Tu nombre" /></label>
            <label className="modal-label">Email<input type="email" className="modal-input" value={settingsEmailDraft} onChange={e => setSettingsEmailDraft(e.target.value)} placeholder="tu@email.com" /></label>
            <label className="modal-label">Empresa<input type="text" className="modal-input" value={settingsCompanyDraft} onChange={e => setSettingsCompanyDraft(e.target.value)} placeholder="Nombre de la empresa" /></label>
          </div>
          <div className="settings-save"><button type="button" className="primary-btn" onClick={() => void handleSaveSettings()}>Guardar cambios</button></div>
        </div>
      )}
      {profileScreenTab === 'plan' && (
        <div className="settings-sections">
          <div className="settings-section">
            <div className="settings-section-title">Plan actual</div>
            <div className="plan-badge">✦ Plan gratuito</div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Usa tu propia API Key de Groq — sin límites impuestos por la app.</p>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Estadísticas de uso</div>
            <div className="stats-grid" style={{ marginBottom: 0 }}>
              {[['Proyectos', stats.projects], ['Entrevistas', stats.interviews], ['Transcritas', stats.transcribed], ['Resúmenes IA', stats.summaries]].map(([label, val]) => (
                <div key={label as string} className="stat-card"><span className="stat-value">{val}</span><span className="stat-label">{label}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}
      {profileScreenTab === 'seguridad' && (
        <div className="settings-sections">
          <div className="settings-section">
            <div className="settings-section-title">Cambiar contraseña</div>
            <label className="modal-label">Contraseña actual<input type="password" className="modal-input" value={settingsPasswordDraft} onChange={e => setSettingsPasswordDraft(e.target.value)} placeholder="••••••••" /></label>
            <label className="modal-label">Nueva contraseña<input type="password" className="modal-input" value={settingsPasswordNewDraft} onChange={e => setSettingsPasswordNewDraft(e.target.value)} placeholder="••••••••" /></label>
            <label className="modal-label">Confirmar nueva contraseña<input type="password" className="modal-input" value={settingsPasswordConfirmDraft} onChange={e => setSettingsPasswordConfirmDraft(e.target.value)} placeholder="••••••••" /></label>
            <button type="button" className="primary-btn" style={{ alignSelf: 'flex-start' }} onClick={() => { toast('Contraseña actualizada'); setSettingsPasswordDraft(''); setSettingsPasswordNewDraft(''); setSettingsPasswordConfirmDraft('') }}>Actualizar contraseña</button>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">Sesión</div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Actualmente conectado como: {userEmail || 'usuario'}</p>
          </div>
        </div>
      )}
      {profileScreenTab === 'notif' && (
        <div className="settings-sections">
          <div className="settings-section">
            <div className="settings-section-title">Preferencias</div>
            <div className="toggle-row">
              <div><span className="toggle-label">Transcripción completada</span><span className="toggle-desc">Notificar cuando una transcripción finaliza</span></div>
              <button type="button" className={`toggle-btn${notifTranscription ? ' on' : ''}`} onClick={() => setNotifTranscription(t => !t)}><span className="toggle-circle" /></button>
            </div>
            <div className="toggle-row">
              <div><span className="toggle-label">Resumen generado</span><span className="toggle-desc">Notificar cuando la IA genera un resumen</span></div>
              <button type="button" className={`toggle-btn${notifSummary ? ' on' : ''}`} onClick={() => setNotifSummary(t => !t)}><span className="toggle-circle" /></button>
            </div>
            <div className="toggle-row">
              <div><span className="toggle-label">Errores</span><span className="toggle-desc">Notificar cuando hay un error en el proceso</span></div>
              <button type="button" className={`toggle-btn${notifErrors ? ' on' : ''}`} onClick={() => setNotifErrors(t => !t)}><span className="toggle-circle" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // ── Overlays ───────────────────────────────────────────────────────────

  const renderRecordingOverlay = () => {
    if (!activeRecordingInterview) return null
    const isRecording = activeRecordingInterview.status === 'recording'
    return (
      <div className="recording-overlay">
        <div className="rec-overlay-content">
          <div className="rec-overlay-meta">
            {activeRecordingProject && <span className="rec-overlay-project">{activeRecordingProject.name}</span>}
            {activeRecordingCandidate && <span className="rec-overlay-candidate">{activeRecordingCandidate.name}</span>}
          </div>
          <div className={`rec-circle${isRecording ? '' : ' paused'}`}>
            <MicIcon />
          </div>
          <div className="rec-timer">{fmt(activeRecordingInterview.durationSec)}</div>
          <div className="rec-status">{isRecording ? '● Grabando' : '‖ En pausa'}</div>
          <div className="rec-controls">
            {isRecording ? (
              <button type="button" className="rec-btn rec-btn--secondary" onClick={handlePauseRecording}>‖ Pausar</button>
            ) : (
              <button type="button" className="rec-btn rec-btn--primary" onClick={handleResumeRecording}>▶ Reanudar</button>
            )}
            <button type="button" className="rec-btn rec-btn--stop" onClick={handleStopRecording}>■ Parar</button>
          </div>
          <p className="rec-note">{activeRecordingInterview.captureSource === 'mic+system' ? 'Grabando micrófono + sistema' : 'Grabando micrófono'}</p>
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

    return (
      <div className="modal-overlay" onClick={() => setShowExport(false)}>
        <div className="modal-box export-modal" onClick={e => e.stopPropagation()}>
          <h2>Exportar informe</h2>
          <p>{exportCandidateId ? `Candidata: ${exportCandidate?.name}` : `Proyecto: ${activeProject?.name} · ${allCandidatesToExport.length} candidatas`}</p>
          {exportInterviews.length === 0 && !exportCandidateId && allCandidatesToExport.every(c => interviews.filter(i => i.candidateId === c.id && i.transcriptionStatus === 'done').length === 0) ? (
            <p className="warning-note">No hay entrevistas transcritas para exportar.</p>
          ) : (
            <textarea className="export-preview" readOnly value={exportText} rows={10} />
          )}
          <div className="modal-actions">
            <button type="button" className="primary-btn" onClick={async () => { try { await navigator.clipboard.writeText(exportText); toast('Informe copiado al portapapeles'); setShowExport(false) } catch { toast('No se pudo copiar', 'error') } }}>Copiar al portapapeles</button>
            <button type="button" onClick={() => setShowExport(false)}>Cerrar</button>
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════ MAIN JSX ════

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="sidebar-logo-badge">CT</span>
          <span className="sidebar-logo-text">Call Transcriber</span>
        </div>
        <nav className="sidebar-nav">
          <button type="button" className={`nav-item${screen === 'dashboard' ? ' is-active' : ''}`} onClick={() => setScreen('dashboard')}><HomeIcon /><span>Inicio</span></button>
          <button type="button" className={`nav-item${(screen === 'projects' || screen === 'project-detail') ? ' is-active' : ''}`} onClick={() => setScreen('projects')}><FolderIcon /><span>Proyectos</span></button>
        </nav>
        <div className="sidebar-bottom">
          <button type="button" className="sidebar-user" onClick={() => setShowProfilePopup(p => !p)}>
            <div className="sidebar-avatar">{userInitials}</div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{userName || 'Usuario'}</span>
              <span className="sidebar-user-email">{userEmail}</span>
            </div>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="main-area">
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
        <main className="content-area">
          {screen === 'dashboard' && renderDashboard()}
          {screen === 'projects' && renderProjects()}
          {screen === 'project-detail' && renderProjectDetail()}
          {screen === 'candidate-detail' && renderCandidateDetail()}
          {screen === 'settings' && renderSettings()}
          {screen === 'profile' && renderProfile()}
        </main>
      </div>

      {/* Profile popup */}
      {showProfilePopup && (
        <div className="profile-popup" onMouseLeave={() => setShowProfilePopup(false)}>
          <div className="pp-user">
            <div className="pp-avatar">{userInitials}</div>
            <div><p className="pp-name">{userName || 'Usuario'}</p><p className="pp-email">{userEmail}</p></div>
          </div>
          <div className="pp-divider" />
          <button type="button" className="pp-item" onClick={() => { setSettingsNameDraft(userName); setSettingsEmailDraft(userEmail); setSettingsCompanyDraft(userCompany); setScreen('profile'); setProfileScreenTab('perfil'); setShowProfilePopup(false) }}><UserIcon /> Mi perfil</button>
          <button type="button" className="pp-item" onClick={() => { openSettings('general'); setShowProfilePopup(false) }}><SettingsIcon /> Configuración</button>
          <button type="button" className="pp-item" onClick={() => { openSettings('grabacion'); setShowProfilePopup(false) }}><BellIcon /> Notificaciones</button>
          <div className="pp-divider" />
          <button type="button" className="pp-item" onClick={() => { setScreen('profile'); setProfileScreenTab('seguridad'); setShowProfilePopup(false) }}><LockIcon /> Seguridad</button>
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
        <div className="modal-overlay" onClick={() => { setShowNewCandidate(false); setEditingCandidateId(null); setCandidateDraft(EMPTY_CANDIDATE) }}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h2>{editingCandidateId ? 'Editar candidata' : 'Nueva candidata'}</h2>
            <label className="modal-label">Nombre *<input type="text" className="modal-input" value={candidateDraft.name} onChange={e => setCandidateDraft(d => ({ ...d, name: e.target.value }))} placeholder="Nombre completo" autoFocus /></label>
            <label className="modal-label">Email<input type="email" className="modal-input" value={candidateDraft.email} onChange={e => setCandidateDraft(d => ({ ...d, email: e.target.value }))} placeholder="correo@ejemplo.com" /></label>
            <label className="modal-label">Teléfono<input type="text" className="modal-input" value={candidateDraft.phone} onChange={e => setCandidateDraft(d => ({ ...d, phone: e.target.value }))} placeholder="+34 600 000 000" /></label>
            <label className="modal-label">Puesto<input type="text" className="modal-input" value={candidateDraft.role} onChange={e => setCandidateDraft(d => ({ ...d, role: e.target.value }))} placeholder="Ej: Frontend Developer" /></label>
            <div className="modal-actions">
              <button type="button" className="primary-btn" onClick={editingCandidateId ? handleUpdateCandidate : handleCreateCandidate} disabled={!candidateDraft.name.trim()}>{editingCandidateId ? 'Guardar' : 'Crear'}</button>
              <button type="button" onClick={() => { setShowNewCandidate(false); setEditingCandidateId(null); setCandidateDraft(EMPTY_CANDIDATE) }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Project modal */}
      {showNewProject && (
        <div className="modal-overlay" onClick={() => { setShowNewProject(false); setProjectDraft(EMPTY_PROJECT) }}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h2>Nuevo proyecto</h2>
            <label className="modal-label">Nombre del proceso *<input type="text" className="modal-input" value={projectDraft.name} onChange={e => setProjectDraft(d => ({ ...d, name: e.target.value }))} placeholder="Ej: Administrativo/a Seguros" autoFocus /></label>
            <label className="modal-label">Empresa<input type="text" className="modal-input" value={projectDraft.company} onChange={e => setProjectDraft(d => ({ ...d, company: e.target.value }))} placeholder="Nombre de la empresa" /></label>
            <div className="modal-actions">
              <button type="button" className="primary-btn" onClick={handleCreateProject} disabled={!projectDraft.name.trim()}>Crear</button>
              <button type="button" onClick={() => { setShowNewProject(false); setProjectDraft(EMPTY_PROJECT) }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Recording fullscreen overlay */}
      {renderRecordingOverlay()}

      {/* Transcribing modal */}
      {renderTranscribingModal()}

      {/* Export modal */}
      {renderExportModal()}

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(t => <div key={t.id} className={`toast toast--${t.type}`}>{t.message}</div>)}
      </div>
    </div>
  )
}

export default App
