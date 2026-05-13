import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Candidate = {
  id: string
  name: string
  email: string
  phone: string
  process: string
}

type ProfileTab = 'entrevistas' | 'transcripcion' | 'resumen'
type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped'

type Interview = {
  id: string
  candidateId: string
  createdAt: string
  sessionName: string
  status: RecordingStatus
  durationSec: number
  micDeviceId: string
  outputDeviceId: string
  transcriptOriginal: string
  transcriptEdited: string
  transcriptUpdatedAt: string | null
  recordingUrl: string | null
  recordingFilePath: string | null
  captureSource: 'none' | 'mic' | 'mic+system'
  transcriptionStatus: 'pending' | 'transcribing' | 'done' | 'error'
  summaryInstructions: string
  summaryText: string
  summaryStatus: 'idle' | 'generating' | 'done' | 'error'
  summaryType: 'resumen' | 'listado'
}

type AudioDeviceOption = {
  id: string
  name: string
}

const STORAGE_KEY = 'call-transcriber-hito1'

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
)

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const PencilIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)

const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
)

const PauseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
)

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

const formatDateTime = (isoDate: string) =>
  new Date(isoDate).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const getExtensionFromMimeType = (mimeType: string) => {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4')) return 'mp4'
  return 'bin'
}

const EMPTY_CANDIDATE_DRAFT = { name: '', email: '', phone: '', process: '' }

function App() {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [showNewCandidate, setShowNewCandidate] = useState(false)
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null)
  const [candidateDraft, setCandidateDraft] = useState(EMPTY_CANDIDATE_DRAFT)
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ProfileTab>('entrevistas')
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null)
  const [selectedTranscriptInterviewId, setSelectedTranscriptInterviewId] =
    useState<string | null>(null)
  const [selectedSummaryInterviewId, setSelectedSummaryInterviewId] =
    useState<string | null>(null)
  const [transcriptDraft, setTranscriptDraft] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [micDevices, setMicDevices] = useState<AudioDeviceOption[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([])
  const [recordingMessage, setRecordingMessage] = useState('')
  const [groqApiKey, setGroqApiKey] = useState('')
  const [transcriptionModel, setTranscriptionModel] = useState('whisper-large-v3')
  const [summaryModel, setSummaryModel] = useState('llama-3.3-70b-versatile')
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [userCompany, setUserCompany] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsKeyDraft, setSettingsKeyDraft] = useState('')
  const [settingsTranscriptionModelDraft, setSettingsTranscriptionModelDraft] = useState('whisper-large-v3')
  const [settingsSummaryModelDraft, setSettingsSummaryModelDraft] = useState('llama-3.3-70b-versatile')
  const [settingsUserNameDraft, setSettingsUserNameDraft] = useState('')
  const [settingsUserEmailDraft, setSettingsUserEmailDraft] = useState('')
  const [settingsUserCompanyDraft, setSettingsUserCompanyDraft] = useState('')

  const [showSessionNameModal, setShowSessionNameModal] = useState(false)
  const [sessionNameDraft, setSessionNameDraft] = useState('')
  const [playingInterviewId, setPlayingInterviewId] = useState<string | null>(null)
  const [playbackProgress, setPlaybackProgress] = useState(0)
  const [playbackCurrentTime, setPlaybackCurrentTime] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [editingInterviewId, setEditingInterviewId] = useState<string | null>(null)
  const [editingNameDraft, setEditingNameDraft] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const systemStreamRef = useRef<MediaStream | null>(null)
  const mixedStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const chunkRef = useRef<Blob[]>([])
  const activeInterviewIdRef = useRef<string | null>(null)
  const pendingBlobRef = useRef<Blob | null>(null)
  const pendingMimeTypeRef = useRef<string>('')
  const pendingCaptureSourceRef = useRef<'mic' | 'mic+system'>('mic')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const selectedCandidate =
    candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null

  const candidateInterviews = useMemo(() => {
    if (!selectedCandidateId) return []
    return interviews
      .filter((interview) => interview.candidateId === selectedCandidateId)
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
  }, [interviews, selectedCandidateId])

  const selectedInterview = candidateInterviews.find(
    (interview) => interview.id === selectedInterviewId,
  )
  const selectedTranscriptInterview = candidateInterviews.find(
    (interview) => interview.id === selectedTranscriptInterviewId,
  )
  const selectedSummaryInterview = candidateInterviews.find(
    (interview) => interview.id === selectedSummaryInterviewId,
  )

  // Load Groq API key from electron config on startup
  useEffect(() => {
    if (!window.desktopApp?.getConfig) return
    void window.desktopApp.getConfig().then((config) => {
      setGroqApiKey(config.groqApiKey ?? '')
      setTranscriptionModel(config.transcriptionModel ?? 'whisper-large-v3')
      setSummaryModel(config.summaryModel ?? 'llama-3.3-70b-versatile')
      setUserName(config.userName ?? '')
      setUserEmail(config.userEmail ?? '')
      setUserCompany(config.userCompany ?? '')
    })
  }, [])

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { interviews: Interview[]; candidates?: Candidate[] }
      if (Array.isArray(parsed.candidates)) {
        setCandidates(parsed.candidates)
      }
      if (Array.isArray(parsed.interviews)) {
        setInterviews(
          parsed.interviews.map((interview) => ({
            ...interview,
            sessionName: interview.sessionName ?? '',
            recordingUrl: null,
            recordingFilePath: interview.recordingFilePath ?? null,
            captureSource: interview.captureSource ?? 'none',
            transcriptionStatus:
              interview.transcriptionStatus === 'transcribing'
                ? 'error'
                : interview.transcriptionStatus ??
                  (interview.transcriptOriginal &&
                  !interview.transcriptOriginal.startsWith('Transcripcion pendiente')
                    ? 'done'
                    : 'pending'),
            summaryInstructions: interview.summaryInstructions ?? '',
            summaryText: interview.summaryText ?? '',
            summaryStatus: interview.summaryStatus ?? 'idle',
            summaryType: interview.summaryType ?? 'resumen',
          })),
        )
      }
    } catch (error) {
      console.error('No se pudo leer la persistencia local', error)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ interviews, candidates }))
  }, [interviews, candidates])

  useEffect(() => {
    if (!pendingDeleteId) return
    const t = setTimeout(() => setPendingDeleteId(null), 3000)
    return () => clearTimeout(t)
  }, [pendingDeleteId])

  useEffect(() => {
    if (!selectedCandidateId) {
      setSelectedInterviewId(null)
      setSelectedTranscriptInterviewId(null)
      setSelectedSummaryInterviewId(null)
      return
    }

    const firstInterviewId = candidateInterviews[0]?.id ?? null
    if (
      selectedInterviewId &&
      candidateInterviews.some((interview) => interview.id === selectedInterviewId)
    ) {
      return
    }
    setSelectedInterviewId(firstInterviewId)
    setSelectedTranscriptInterviewId(firstInterviewId)
    setSelectedSummaryInterviewId(firstInterviewId)
  }, [candidateInterviews, selectedCandidateId, selectedInterviewId])

  useEffect(() => {
    if (!selectedTranscriptInterview) {
      setTranscriptDraft('')
      return
    }
    setTranscriptDraft(selectedTranscriptInterview.transcriptEdited)
  }, [selectedTranscriptInterviewId, selectedTranscriptInterview])

  useEffect(() => {
    if (!selectedInterview || selectedInterview.status !== 'recording') return

    const intervalId = window.setInterval(() => {
      setInterviews((current) =>
        current.map((interview) =>
          interview.id === selectedInterview.id
            ? { ...interview, durationSec: interview.durationSec + 1 }
            : interview,
        ),
      )
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [selectedInterview])

  useEffect(() => {
    const syncDevices = async () => {
      try {
        const permissionProbe = await navigator.mediaDevices.getUserMedia({
          audio: true,
        })
        permissionProbe.getTracks().forEach((track) => track.stop())
        const devices = await navigator.mediaDevices.enumerateDevices()

        const micOptions = devices
          .filter((device) => device.kind === 'audioinput')
          .map((device, index) => ({
            id: device.deviceId,
            name: device.label || `Microfono ${index + 1}`,
          }))

        const outputOptions = devices
          .filter((device) => device.kind === 'audiooutput')
          .map((device, index) => ({
            id: device.deviceId,
            name: device.label || `Salida ${index + 1}`,
          }))

        setMicDevices(micOptions)
        setOutputDevices(outputOptions)
      } catch (error) {
        console.error('No se pudieron cargar dispositivos de audio', error)
        setRecordingMessage(
          'No se pudieron cargar dispositivos reales. Revisa permisos de microfono.',
        )
      }
    }

    void syncDevices()
  }, [])

  const updateInterview = (interviewId: string, patch: Partial<Interview>) => {
    setInterviews((current) =>
      current.map((interview) =>
        interview.id === interviewId ? { ...interview, ...patch } : interview,
      ),
    )
  }

  const saveRecordingToDisk = async ({
    blob,
    interviewId,
    candidateName,
    createdAt,
    mimeType,
  }: {
    blob: Blob
    interviewId: string
    candidateName: string
    createdAt: string
    mimeType: string
  }) => {
    if (!window.desktopApp?.saveRecording) return null

    const arrayBuffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    const result = await window.desktopApp.saveRecording({
      interviewId,
      candidateName,
      createdAt,
      extension: getExtensionFromMimeType(mimeType),
      audioBytes: bytes,
    })

    return result.filePath
  }

  const handleCloseCandidateModal = () => {
    setShowNewCandidate(false)
    setEditingCandidateId(null)
    setCandidateDraft(EMPTY_CANDIDATE_DRAFT)
  }

  const handleCreateCandidate = () => {
    if (!candidateDraft.name.trim()) return
    const newCandidate: Candidate = {
      id: crypto.randomUUID(),
      name: candidateDraft.name.trim(),
      email: candidateDraft.email.trim(),
      phone: candidateDraft.phone.trim(),
      process: candidateDraft.process.trim(),
    }
    setCandidates((current) => [...current, newCandidate])
    setSelectedCandidateId(newCandidate.id)
    handleCloseCandidateModal()
  }

  const handleUpdateCandidate = () => {
    if (!editingCandidateId || !candidateDraft.name.trim()) return
    setCandidates((current) =>
      current.map((c) =>
        c.id === editingCandidateId
          ? { ...c, name: candidateDraft.name.trim(), email: candidateDraft.email.trim(), phone: candidateDraft.phone.trim(), process: candidateDraft.process.trim() }
          : c
      )
    )
    handleCloseCandidateModal()
  }

  const handleCreateInterview = () => {
    if (!selectedCandidateId) return
    const newInterview: Interview = {
      id: crypto.randomUUID(),
      candidateId: selectedCandidateId,
      createdAt: new Date().toISOString(),
      sessionName: '',
      status: 'idle',
      durationSec: 0,
      micDeviceId: micDevices[0]?.id ?? '',
      outputDeviceId: outputDevices[0]?.id ?? '',
      transcriptOriginal: '',
      transcriptEdited: '',
      transcriptUpdatedAt: null,
      recordingUrl: null,
      recordingFilePath: null,
      captureSource: 'none',
      transcriptionStatus: 'pending',
      summaryInstructions: '',
      summaryText: '',
      summaryStatus: 'idle',
      summaryType: 'resumen',
    }

    setInterviews((current) => [newInterview, ...current])
    setSelectedInterviewId(newInterview.id)
    setSelectedTranscriptInterviewId(newInterview.id)
    setSelectedSummaryInterviewId(newInterview.id)
    setActiveTab('entrevistas')
  }

  const cleanupRecordingResources = () => {
    mediaRecorderRef.current = null
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    systemStreamRef.current?.getTracks().forEach((track) => track.stop())
    mixedStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current = null
    systemStreamRef.current = null
    mixedStreamRef.current = null
    if (audioContextRef.current) {
      void audioContextRef.current.close()
      audioContextRef.current = null
    }
  }

  const handleStartRecording = async () => {
    if (!selectedInterview) return

    if (!selectedInterview.micDeviceId) {
      setRecordingMessage('Selecciona un microfono antes de grabar.')
      return
    }

    try {
      setRecordingMessage('Solicitando permisos...')
      chunkRef.current = []

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedInterview.micDeviceId
            ? { exact: selectedInterview.micDeviceId }
            : undefined,
        },
      })
      micStreamRef.current = micStream

      let systemStream: MediaStream | null = null
      try {
        systemStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        })
        systemStreamRef.current = systemStream
      } catch (error) {
        console.warn('Captura de sistema no concedida, se graba solo microfono.', error)
      }

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const destination = audioContext.createMediaStreamDestination()

      const micSource = audioContext.createMediaStreamSource(micStream)
      micSource.connect(destination)

      if (systemStream && systemStream.getAudioTracks().length > 0) {
        const systemSource = audioContext.createMediaStreamSource(systemStream)
        systemSource.connect(destination)
      }

      const mixedStream = destination.stream
      mixedStreamRef.current = mixedStream

      const recorder = new MediaRecorder(mixedStream)
      mediaRecorderRef.current = recorder
      activeInterviewIdRef.current = selectedInterview.id

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunkRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(chunkRef.current, { type: recorder.mimeType })
        const captureSource =
          systemStream && systemStream.getAudioTracks().length > 0 ? 'mic+system' : 'mic'

        pendingBlobRef.current = blob
        pendingMimeTypeRef.current = recorder.mimeType
        pendingCaptureSourceRef.current = captureSource

        if (activeInterviewIdRef.current) {
          updateInterview(activeInterviewIdRef.current, { status: 'stopped', captureSource })
        }

        setSessionNameDraft('')
        setShowSessionNameModal(true)
        cleanupRecordingResources()
      }

      recorder.start(1000)
      updateInterview(selectedInterview.id, {
        status: 'recording',
        captureSource:
          systemStream && systemStream.getAudioTracks().length > 0 ? 'mic+system' : 'mic',
      })
      setRecordingMessage(
        systemStream ? 'Grabando microfono + sistema.' : 'Grabando solo microfono.',
      )
    } catch (error) {
      console.error('Error iniciando grabacion', error)
      setRecordingMessage('No se pudo iniciar la grabacion. Revisa permisos.')
      cleanupRecordingResources()
    }
  }

  const handlePauseRecording = () => {
    if (!selectedInterview) return
    mediaRecorderRef.current?.pause()
    updateInterview(selectedInterview.id, { status: 'paused' })
    setRecordingMessage('Grabacion en pausa.')
  }

  const handleResumeRecording = () => {
    if (!selectedInterview) return
    mediaRecorderRef.current?.resume()
    updateInterview(selectedInterview.id, { status: 'recording' })
    setRecordingMessage('Grabacion reanudada.')
  }

  const handleStopRecording = () => {
    if (!selectedInterview) return
    const recorder = mediaRecorderRef.current
    if (!recorder) return
    if (recorder.state === 'paused') recorder.resume()
    recorder.stop()
    setRecordingMessage('Procesando audio...')
  }

  const handleSaveTranscript = () => {
    if (!selectedTranscriptInterview) return
    updateInterview(selectedTranscriptInterview.id, {
      transcriptEdited: transcriptDraft,
      transcriptUpdatedAt: new Date().toISOString(),
    })
    setSaveMessage('Cambios guardados')
    window.setTimeout(() => setSaveMessage(''), 1800)
  }

  const handleCopyTranscript = async () => {
    if (!transcriptDraft) return
    try {
      await navigator.clipboard.writeText(transcriptDraft)
      setSaveMessage('Transcripcion copiada')
      window.setTimeout(() => setSaveMessage(''), 1800)
    } catch (error) {
      console.error('No se pudo copiar la transcripcion', error)
      setSaveMessage('No se pudo copiar')
      window.setTimeout(() => setSaveMessage(''), 1800)
    }
  }

  const handleRestoreTranscript = () => {
    if (!selectedTranscriptInterview) return
    setTranscriptDraft(selectedTranscriptInterview.transcriptOriginal)
  }

  const handleTranscribe = async (interviewId: string) => {
    const interview = interviews.find((i) => i.id === interviewId)
    if (!interview?.recordingFilePath || !window.desktopApp?.transcribeAudio) return

    updateInterview(interviewId, { transcriptionStatus: 'transcribing' })

    try {
      const result = await window.desktopApp.transcribeAudio({
        filePath: interview.recordingFilePath,
      })
      updateInterview(interviewId, {
        transcriptOriginal: result.text,
        transcriptEdited: result.text,
        transcriptionStatus: 'done',
      })
      if (selectedTranscriptInterviewId === interviewId) {
        setTranscriptDraft(result.text)
      }
    } catch (error) {
      console.error('Error transcribiendo', error)
      updateInterview(interviewId, { transcriptionStatus: 'error' })
    }
  }

  const handleGenerateSummary = async (interviewId: string) => {
    const interview = interviews.find((i) => i.id === interviewId)
    if (!interview || !window.desktopApp?.generateSummary) return

    updateInterview(interviewId, { summaryStatus: 'generating' })

    try {
      const result = await window.desktopApp.generateSummary({
        transcript: interview.transcriptEdited,
        instructions: interview.summaryInstructions,
        summaryType: interview.summaryType,
      })
      updateInterview(interviewId, {
        summaryText: result.text,
        summaryStatus: 'done',
      })
    } catch (error) {
      console.error('Error generando resumen', error)
      updateInterview(interviewId, { summaryStatus: 'error' })
    }
  }

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    setPlayingInterviewId(null)
    setPlaybackProgress(0)
    setPlaybackCurrentTime(0)
  }

  const handleTogglePlayback = (interview: Interview) => {
    const src =
      interview.recordingUrl ??
      (interview.recordingFilePath
        ? 'file:///' + interview.recordingFilePath.replace(/\\/g, '/')
        : null)
    if (!src) return

    if (playingInterviewId === interview.id) {
      stopAudio()
      return
    }

    stopAudio()
    const audio = new Audio(src)
    audio.playbackRate = playbackRate
    audioRef.current = audio
    audio.ontimeupdate = () => {
      const total = isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : interview.durationSec
      if (total > 0) {
        setPlaybackProgress(Math.min(audio.currentTime / total, 1))
        setPlaybackCurrentTime(audio.currentTime)
      }
    }
    audio.onended = () => { setPlayingInterviewId(null); setPlaybackProgress(0); setPlaybackCurrentTime(0) }
    audio.onerror = () => { setPlayingInterviewId(null); setPlaybackProgress(0); setPlaybackCurrentTime(0) }
    void audio.play()
    setPlayingInterviewId(interview.id)
  }

  const handleCycleSpeed = () => {
    const rates: [number, number, number] = [1, 1.5, 2]
    const next = rates[(rates.indexOf(playbackRate as 1 | 1.5 | 2) + 1) % rates.length]
    setPlaybackRate(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  const handleBarMouseDown = (e: React.MouseEvent<HTMLDivElement>, interview: Interview) => {
    if (playingInterviewId !== interview.id || !audioRef.current) return
    e.preventDefault()
    const bar = e.currentTarget

    const seek = (clientX: number) => {
      const rect = bar.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const total =
        isFinite(audioRef.current!.duration) && audioRef.current!.duration > 0
          ? audioRef.current!.duration
          : interview.durationSec
      audioRef.current!.currentTime = ratio * total
      setPlaybackProgress(ratio)
      setPlaybackCurrentTime(ratio * total)
    }

    seek(e.clientX)

    const onMouseMove = (evt: MouseEvent) => seek(evt.clientX)
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const handleStartEditName = (interview: Interview) => {
    setEditingInterviewId(interview.id)
    setEditingNameDraft(interview.sessionName || formatDateTime(interview.createdAt))
  }

  const handleSaveEditName = (interviewId: string) => {
    if (editingNameDraft.trim()) {
      updateInterview(interviewId, { sessionName: editingNameDraft.trim() })
    }
    setEditingInterviewId(null)
  }

  const handleCancelEditName = () => setEditingInterviewId(null)

  const handleConfirmSessionName = async () => {
    if (!sessionNameDraft.trim()) return
    const blob = pendingBlobRef.current
    const interviewId = activeInterviewIdRef.current
    if (!blob || !interviewId) return

    const interviewData = interviews.find((i) => i.id === interviewId)
    const mimeType = pendingMimeTypeRef.current
    const recordingUrl = URL.createObjectURL(blob)

    setShowSessionNameModal(false)
    updateInterview(interviewId, { sessionName: sessionNameDraft.trim() })

    let recordingFilePath: string | null = null
    if (interviewData) {
      try {
        recordingFilePath = await saveRecordingToDisk({
          blob,
          interviewId,
          candidateName:
            candidates.find((c) => c.id === interviewData.candidateId)?.name ?? 'candidata',
          createdAt: interviewData.createdAt,
          mimeType,
        })
      } catch (error) {
        console.error('No se pudo guardar el audio en disco', error)
      }
    }

    updateInterview(interviewId, { recordingUrl, recordingFilePath })

    pendingBlobRef.current = null
  }

  const handleDiscardSession = () => {
    pendingBlobRef.current = null
    setShowSessionNameModal(false)
  }

  const handleDeleteCandidate = (candidateId: string) => {
    if (pendingDeleteId !== candidateId) {
      setPendingDeleteId(candidateId)
      return
    }
    setPendingDeleteId(null)
    const toDelete = interviews.filter((i) => i.candidateId === candidateId)
    toDelete.forEach((interview) => {
      if (interview.recordingFilePath && window.desktopApp?.deleteRecording) {
        void window.desktopApp.deleteRecording({ filePath: interview.recordingFilePath })
      }
    })
    setInterviews((current) => current.filter((i) => i.candidateId !== candidateId))
    setCandidates((current) => current.filter((c) => c.id !== candidateId))
    if (selectedCandidateId === candidateId) setSelectedCandidateId(null)
  }

  const handleDeleteInterview = (interviewId: string) => {
    if (pendingDeleteId !== interviewId) {
      setPendingDeleteId(interviewId)
      return
    }
    setPendingDeleteId(null)
    if (playingInterviewId === interviewId) stopAudio()
    const interview = interviews.find((i) => i.id === interviewId)
    if (interview?.recordingFilePath && window.desktopApp?.deleteRecording) {
      void window.desktopApp.deleteRecording({ filePath: interview.recordingFilePath })
    }
    setInterviews((current) => current.filter((i) => i.id !== interviewId))
  }

  const handleSaveSettings = async () => {
    if (window.desktopApp?.saveConfig) {
      await window.desktopApp.saveConfig({
        groqApiKey: settingsKeyDraft,
        transcriptionModel: settingsTranscriptionModelDraft,
        summaryModel: settingsSummaryModelDraft,
        userName: settingsUserNameDraft,
        userEmail: settingsUserEmailDraft,
        userCompany: settingsUserCompanyDraft,
      })
    }
    setGroqApiKey(settingsKeyDraft)
    setTranscriptionModel(settingsTranscriptionModelDraft)
    setSummaryModel(settingsSummaryModelDraft)
    setUserName(settingsUserNameDraft)
    setUserEmail(settingsUserEmailDraft)
    setUserCompany(settingsUserCompanyDraft)
    setShowSettings(false)
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <h1>Entrevistas</h1>
        <div className="top-bar-actions">
          <button
            type="button"
            className="settings-btn"
            title="Configuracion"
            onClick={() => {
              setSettingsKeyDraft(groqApiKey)
              setSettingsTranscriptionModelDraft(transcriptionModel)
              setSettingsSummaryModelDraft(summaryModel)
              setSettingsUserNameDraft(userName)
              setSettingsUserEmailDraft(userEmail)
              setSettingsUserCompanyDraft(userCompany)
              setShowSettings(true)
            }}
          >
            ⚙
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-box settings-modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>Configuracion</h2>

            <div className="settings-section">
              <div className="settings-section-title">API Key</div>
              <p className="modal-link-note">
                Groq es gratuita &mdash;{' '}
                <a href="https://console.groq.com" target="_blank" rel="noreferrer">
                  consigue tu key en console.groq.com
                </a>
              </p>
              <label className="modal-label">
                API Key de Groq
                <input
                  type="password"
                  className="modal-input"
                  value={settingsKeyDraft}
                  onChange={(e) => setSettingsKeyDraft(e.target.value)}
                  placeholder="gsk_..."
                />
              </label>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">Cuenta</div>
              <label className="modal-label">
                Nombre
                <input
                  type="text"
                  className="modal-input"
                  value={settingsUserNameDraft}
                  onChange={(e) => setSettingsUserNameDraft(e.target.value)}
                  placeholder="Tu nombre"
                />
              </label>
              <label className="modal-label">
                Email
                <input
                  type="email"
                  className="modal-input"
                  value={settingsUserEmailDraft}
                  onChange={(e) => setSettingsUserEmailDraft(e.target.value)}
                  placeholder="tu@email.com"
                />
              </label>
              <label className="modal-label">
                Empresa
                <input
                  type="text"
                  className="modal-input"
                  value={settingsUserCompanyDraft}
                  onChange={(e) => setSettingsUserCompanyDraft(e.target.value)}
                  placeholder="Nombre de la empresa"
                />
              </label>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">Transcripcion</div>
              <label className="modal-label">
                Modelo Whisper
                <select
                  className="modal-input modal-select"
                  value={settingsTranscriptionModelDraft}
                  onChange={(e) => setSettingsTranscriptionModelDraft(e.target.value)}
                >
                  <option value="whisper-large-v3">whisper-large-v3 — Mayor precision</option>
                  <option value="whisper-large-v3-turbo">whisper-large-v3-turbo — Rapido y preciso</option>
                  <option value="distil-whisper-large-v3-en">distil-whisper-large-v3-en — Solo ingles, muy rapido</option>
                </select>
              </label>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">Resumen</div>
              <label className="modal-label">
                Modelo LLM
                <select
                  className="modal-input modal-select"
                  value={settingsSummaryModelDraft}
                  onChange={(e) => setSettingsSummaryModelDraft(e.target.value)}
                >
                  <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile — Mas capaz</option>
                  <option value="llama-3.1-8b-instant">llama-3.1-8b-instant — Mas rapido</option>
                  <option value="gemma2-9b-it">gemma2-9b-it — Alternativa equilibrada</option>
                </select>
              </label>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => void handleSaveSettings()}
              >
                Guardar
              </button>
              <button type="button" onClick={() => setShowSettings(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showSessionNameModal && (
        <div className="modal-overlay session-name-modal">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>Nombrar sesion</h2>
            <p>¿Como quieres llamar a esta sesion de entrevista?</p>
            <label className="modal-label">
              Nombre de la sesion
              <input
                type="text"
                className="modal-input"
                value={sessionNameDraft}
                onChange={(e) => setSessionNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && sessionNameDraft.trim()) void handleConfirmSessionName() }}
                placeholder="Ej: Primera entrevista tecnica"
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => void handleConfirmSessionName()}
                disabled={!sessionNameDraft.trim()}
              >
                Guardar
              </button>
              <button type="button" onClick={handleDiscardSession}>
                Descartar grabacion
              </button>
            </div>
          </div>
        </div>
      )}

      {(showNewCandidate || editingCandidateId !== null) && (
        <div className="modal-overlay" onClick={handleCloseCandidateModal}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>{editingCandidateId ? 'Editar candidata' : 'Nueva candidata'}</h2>
            <label className="modal-label">
              Nombre *
              <input
                type="text"
                className="modal-input"
                value={candidateDraft.name}
                onChange={(e) => setCandidateDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Nombre completo"
                autoFocus
              />
            </label>
            <label className="modal-label">
              Email
              <input
                type="email"
                className="modal-input"
                value={candidateDraft.email}
                onChange={(e) => setCandidateDraft((d) => ({ ...d, email: e.target.value }))}
                placeholder="correo@ejemplo.com"
              />
            </label>
            <label className="modal-label">
              Telefono
              <input
                type="text"
                className="modal-input"
                value={candidateDraft.phone}
                onChange={(e) => setCandidateDraft((d) => ({ ...d, phone: e.target.value }))}
                placeholder="+34 600 000 000"
              />
            </label>
            <label className="modal-label">
              Puesto
              <input
                type="text"
                className="modal-input"
                value={candidateDraft.process}
                onChange={(e) => setCandidateDraft((d) => ({ ...d, process: e.target.value }))}
                placeholder="Ej: Frontend Developer"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={editingCandidateId ? handleUpdateCandidate : handleCreateCandidate}
                disabled={!candidateDraft.name.trim()}
              >
                {editingCandidateId ? 'Guardar' : 'Crear'}
              </button>
              <button type="button" onClick={handleCloseCandidateModal}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="workspace">
        <aside className="candidates-list">
          <div className="candidates-header">
            <h2>Candidatas</h2>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                setCandidateDraft(EMPTY_CANDIDATE_DRAFT)
                setShowNewCandidate(true)
              }}
            >
              + Nueva
            </button>
          </div>
          <ul>
            {candidates.length === 0 && (
              <p className="tab-note">Aun no hay candidatas.</p>
            )}
            {candidates.map((candidate) => (
              <li key={candidate.id} className="candidate-row">
                <button
                  type="button"
                  className={`candidate-item ${
                    selectedCandidateId === candidate.id ? 'is-selected' : ''
                  }`}
                  onClick={() => {
                    setSelectedCandidateId(candidate.id)
                    setSaveMessage('')
                  }}
                >
                  {candidate.name}
                </button>
                <button
                  type="button"
                  className={`btn-trash${pendingDeleteId === candidate.id ? ' confirming' : ''}`}
                  title={pendingDeleteId === candidate.id ? 'Confirmar eliminación' : 'Eliminar candidata y todos sus datos'}
                  onClick={() => handleDeleteCandidate(candidate.id)}
                >
                  {pendingDeleteId === candidate.id ? <CheckIcon /> : <TrashIcon />}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="profile-panel">
          {selectedCandidate ? (
            <div className="candidate-profile">
              <p className="profile-label">Perfil de candidata</p>
              <div className="candidate-name-row">
                <h3>{selectedCandidate.name}</h3>
                <button
                  type="button"
                  className="btn-icon"
                  title="Editar candidata"
                  onClick={() => {
                    setCandidateDraft({ name: selectedCandidate.name, email: selectedCandidate.email, phone: selectedCandidate.phone, process: selectedCandidate.process })
                    setEditingCandidateId(selectedCandidate.id)
                  }}
                >
                  <PencilIcon />
                </button>
              </div>
              <div className="profile-tabs">
                <button
                  type="button"
                  className={activeTab === 'entrevistas' ? 'is-active' : ''}
                  onClick={() => {
                    setActiveTab('entrevistas')
                    setSaveMessage('')
                  }}
                >
                  Entrevistas
                </button>
                <button
                  type="button"
                  className={activeTab === 'transcripcion' ? 'is-active' : ''}
                  onClick={() => setActiveTab('transcripcion')}
                >
                  Transcripcion
                </button>
                <button
                  type="button"
                  className={activeTab === 'resumen' ? 'is-active' : ''}
                  onClick={() => setActiveTab('resumen')}
                >
                  Resumen
                </button>
              </div>

              {activeTab === 'entrevistas' && (
                <div className="tab-content">
                  <div className="candidate-meta">
                    <dl>
                      <div>
                        <dt>Email</dt>
                        <dd>{selectedCandidate.email}</dd>
                      </div>
                      <div>
                        <dt>Telefono</dt>
                        <dd>{selectedCandidate.phone}</dd>
                      </div>
                      <div>
                        <dt>Proceso</dt>
                        <dd>{selectedCandidate.process}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="new-interview-header">
                    <h4>Sesion de entrevista</h4>
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={handleCreateInterview}
                    >
                      Nueva entrevista
                    </button>
                  </div>

                  {selectedInterview ? (
                    <div className="recording-panel">
                      <p className="interview-time">
                        Creada: {formatDateTime(selectedInterview.createdAt)}
                      </p>
                      <div className="controls-row">
                        <button
                          type="button"
                          className={`btn-record${selectedInterview.status === 'recording' ? ' is-recording' : ''}`}
                          onClick={() =>
                            selectedInterview.status === 'paused'
                              ? handleResumeRecording()
                              : void handleStartRecording()
                          }
                          disabled={selectedInterview.status === 'recording'}
                        >
                          {selectedInterview.status === 'paused' ? 'Reanudar' : 'Grabar'}
                        </button>
                        <button
                          type="button"
                          className="btn-control"
                          onClick={handlePauseRecording}
                          disabled={selectedInterview.status !== 'recording'}
                        >
                          Pausar
                        </button>
                        <button
                          type="button"
                          className="btn-control"
                          onClick={handleStopRecording}
                          disabled={
                            selectedInterview.status === 'idle' ||
                            selectedInterview.status === 'stopped'
                          }
                        >
                          Parar
                        </button>
                        <span className="timer">
                          {formatDuration(selectedInterview.durationSec)}
                        </span>
                      </div>

                      <div className="device-grid">
                        <label>
                          Microfono (entrada)
                          <select
                            value={selectedInterview.micDeviceId}
                            onChange={(event) =>
                              updateInterview(selectedInterview.id, {
                                micDeviceId: event.target.value,
                              })
                            }
                          >
                            {micDevices.map((device) => (
                              <option key={device.id} value={device.id}>
                                {device.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          Salida (audio a capturar)
                          <select
                            value={selectedInterview.outputDeviceId}
                            onChange={(event) =>
                              updateInterview(selectedInterview.id, {
                                outputDeviceId: event.target.value,
                              })
                            }
                          >
                            {outputDevices.map((device) => (
                              <option key={device.id} value={device.id}>
                                {device.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <p className="device-help">
                        La app intentara capturar audio del sistema (loopback). Si no esta
                        disponible en tu equipo, se guardara solo microfono.
                      </p>
                      {recordingMessage && (
                        <p className="recording-message">{recordingMessage}</p>
                      )}
                      {selectedInterview.recordingUrl && (
                        <div className="recording-preview">
                          <p className="section-label">Preview de grabacion</p>
                          <audio controls src={selectedInterview.recordingUrl} />
                          {selectedInterview.recordingFilePath && (
                            <p className="saved-path">
                              Guardado en: {selectedInterview.recordingFilePath}
                            </p>
                          )}
                        </div>
                      )}
                      {selectedInterview.transcriptionStatus === 'transcribing' && (
                        <div className="spinner-row">
                          <span className="spinner" />
                          <span>Transcribiendo...</span>
                        </div>
                      )}
                      {selectedInterview.transcriptionStatus === 'error' && (
                        <p className="error-note">
                          Error al transcribir. Ve a la pestana Transcripcion para reintentar.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="tab-note">
                      Pulsa "Nueva entrevista" para empezar una sesion.
                    </p>
                  )}

                  <div className="interviews-list">
                    <p className="section-label">Historial de entrevistas</p>
                    {candidateInterviews.length === 0 ? (
                      <p className="tab-note">
                        Aun no hay entrevistas para esta candidata.
                      </p>
                    ) : (
                      <ul>
                        {candidateInterviews.map((interview) => (
                          <li key={interview.id} className="history-row">
                            {editingInterviewId === interview.id ? (
                              <>
                                <input
                                  type="text"
                                  className="history-edit-input"
                                  value={editingNameDraft}
                                  onChange={(e) => setEditingNameDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveEditName(interview.id)
                                    if (e.key === 'Escape') handleCancelEditName()
                                  }}
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  className="btn-icon btn-icon--confirm"
                                  onClick={() => handleSaveEditName(interview.id)}
                                  title="Guardar"
                                >
                                  ✓
                                </button>
                                <button
                                  type="button"
                                  className="btn-icon"
                                  onClick={handleCancelEditName}
                                  title="Cancelar"
                                >
                                  ✕
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className={`history-item ${
                                    interview.id === selectedInterviewId ? 'is-selected' : ''
                                  }`}
                                  onClick={() => setSelectedInterviewId(interview.id)}
                                >
                                  <span className="history-item-name">{interview.sessionName || formatDateTime(interview.createdAt)}</span>
                                  {(interview.recordingFilePath ?? interview.recordingUrl) && (
                                    <>
                                      <span className="playback-timer">
                                        {playingInterviewId === interview.id
                                          ? formatDuration(Math.floor(playbackCurrentTime))
                                          : formatDuration(interview.durationSec)}
                                      </span>
                                      <div className="speed-bar-group">
                                      <button
                                        type="button"
                                        className="btn-speed"
                                        onClick={handleCycleSpeed}
                                      >
                                        x{playbackRate}
                                      </button>
                                      <div
                                        className="playback-bar"
                                        onMouseDown={(e) => handleBarMouseDown(e, interview)}
                                      >
                                        <div
                                          className="playback-bar-fill"
                                          style={{
                                            width: playingInterviewId === interview.id
                                              ? `${playbackProgress * 100}%`
                                              : '0%',
                                          }}
                                        />
                                        {playingInterviewId === interview.id && (
                                          <div
                                            className="playback-bar-thumb"
                                            style={{ left: `${playbackProgress * 100}%` }}
                                          />
                                        )}
                                      </div>
                                      </div>
                                    </>
                                  )}
                                </button>
                                {(interview.recordingUrl ?? interview.recordingFilePath) && (
                                  <button
                                    type="button"
                                    className="btn-icon"
                                    title={playingInterviewId === interview.id ? 'Pausar' : 'Reproducir grabacion'}
                                    onClick={() => handleTogglePlayback(interview)}
                                  >
                                    {playingInterviewId === interview.id ? <PauseIcon /> : <PlayIcon />}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn-icon"
                                  title="Editar nombre"
                                  onClick={() => handleStartEditName(interview)}
                                >
                                  <PencilIcon />
                                </button>
                                <button
                                  type="button"
                                  className={`btn-trash${pendingDeleteId === interview.id ? ' confirming' : ''}`}
                                  title={pendingDeleteId === interview.id ? 'Confirmar eliminación' : 'Eliminar entrevista y grabacion'}
                                  onClick={() => handleDeleteInterview(interview.id)}
                                >
                                  {pendingDeleteId === interview.id ? <CheckIcon /> : <TrashIcon />}
                                </button>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'transcripcion' && (
                <div className="tab-content">
                  <div className="transcript-layout">
                    <aside className="transcript-list">
                      <p className="section-label">Entrevistas</p>
                      {candidateInterviews.length === 0 ? (
                        <p className="tab-note">
                          No hay entrevistas con transcripcion todavia.
                        </p>
                      ) : (
                        <ul>
                          {candidateInterviews.map((interview) => (
                            <li key={interview.id} className="history-row">
                              <button
                                type="button"
                                className={`history-item ${
                                  interview.id === selectedTranscriptInterviewId
                                    ? 'is-selected'
                                    : ''
                                }`}
                                onClick={() =>
                                  setSelectedTranscriptInterviewId(interview.id)
                                }
                              >
                                <span className="history-item-name">{interview.sessionName || formatDateTime(interview.createdAt)}</span>
                              </button>
                              {(interview.recordingUrl ?? interview.recordingFilePath) && (
                                <button
                                  type="button"
                                  className="btn-icon"
                                  title={playingInterviewId === interview.id ? 'Pausar' : 'Reproducir grabacion'}
                                  onClick={() => handleTogglePlayback(interview)}
                                >
                                  {playingInterviewId === interview.id ? <PauseIcon /> : <PlayIcon />}
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </aside>

                    <div className="transcript-editor">
                      <p className="section-label">Transcripcion editable</p>
                      {selectedTranscriptInterview ? (
                        <>
                          {selectedTranscriptInterview.transcriptionStatus ===
                            'transcribing' && (
                            <div className="spinner-row">
                              <span className="spinner" />
                              <span>Transcripcion en curso...</span>
                              <button
                                type="button"
                                className="secondary-btn"
                                style={{ marginLeft: '12px' }}
                                onClick={() =>
                                  updateInterview(selectedTranscriptInterview.id, {
                                    transcriptionStatus: 'pending',
                                  })
                                }
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                          {selectedTranscriptInterview.transcriptionStatus === 'error' && (
                            <div className="error-block">
                              <p className="error-note">Error al transcribir.</p>
                              <button
                                type="button"
                                className="secondary-btn"
                                onClick={() =>
                                  void handleTranscribe(selectedTranscriptInterview.id)
                                }
                              >
                                Reintentar
                              </button>
                            </div>
                          )}
                          {selectedTranscriptInterview.transcriptionStatus !==
                            'transcribing' && (
                            <>
                              <textarea
                                value={transcriptDraft}
                                onChange={(event) =>
                                  setTranscriptDraft(event.target.value)
                                }
                                rows={12}
                              />
                              <div className="editor-actions">
                                <button
                                  type="button"
                                  className="primary-btn"
                                  onClick={handleSaveTranscript}
                                >
                                  Guardar cambios
                                </button>
                                <button type="button" onClick={handleCopyTranscript}>
                                  Copiar
                                </button>
                                <button type="button" onClick={handleRestoreTranscript}>
                                  Restaurar original
                                </button>
                                {selectedTranscriptInterview.recordingFilePath && (
                                  <button
                                    type="button"
                                    className="primary-btn"
                                    onClick={() =>
                                      void handleTranscribe(selectedTranscriptInterview.id)
                                    }
                                  >
                                    Transcribir
                                  </button>
                                )}
                                {saveMessage && (
                                  <span className="save-message">{saveMessage}</span>
                                )}
                              </div>
                            </>
                          )}
                        </>
                      ) : (
                        <p className="tab-note">
                          Selecciona una entrevista para editar su transcripcion.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'resumen' && (
                <div className="tab-content">
                  <div className="transcript-layout">
                    <aside className="transcript-list">
                      <p className="section-label">Entrevistas</p>
                      {candidateInterviews.length === 0 ? (
                        <p className="tab-note">No hay entrevistas todavia.</p>
                      ) : (
                        <ul>
                          {candidateInterviews.map((interview) => (
                            <li key={interview.id} className="history-row">
                              <button
                                type="button"
                                className={`history-item ${
                                  interview.id === selectedSummaryInterviewId
                                    ? 'is-selected'
                                    : ''
                                }`}
                                onClick={() => setSelectedSummaryInterviewId(interview.id)}
                              >
                                <span className="history-item-name">{interview.sessionName || formatDateTime(interview.createdAt)}</span>
                              </button>
                              {(interview.recordingUrl ?? interview.recordingFilePath) && (
                                <button
                                  type="button"
                                  className="btn-icon"
                                  title={playingInterviewId === interview.id ? 'Pausar' : 'Reproducir grabacion'}
                                  onClick={() => handleTogglePlayback(interview)}
                                >
                                  {playingInterviewId === interview.id ? <PauseIcon /> : <PlayIcon />}
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </aside>

                    <div className="transcript-editor">
                      <div className="summary-header">
                        <p className="section-label">Resumen con IA</p>
                        {selectedSummaryInterview && (
                          <select
                            className="summary-type-select"
                            value={selectedSummaryInterview.summaryType}
                            onChange={(event) =>
                              updateInterview(selectedSummaryInterview.id, {
                                summaryType: event.target.value as 'resumen' | 'listado',
                              })
                            }
                          >
                            <option value="resumen">Resumen explicativo</option>
                            <option value="listado">Listado por puntos</option>
                          </select>
                        )}
                      </div>
                      {selectedSummaryInterview ? (
                        <>
                          {!groqApiKey && (
                            <p className="warning-note">
                              Configura tu API key de Groq en ⚙ Ajustes
                            </p>
                          )}
                          {selectedSummaryInterview.transcriptionStatus !== 'done' && (
                            <p className="warning-note">
                              Primero transcribe la entrevista
                            </p>
                          )}
                          <div className="summary-instructions">
                            <label>
                              <span>
                                {selectedSummaryInterview.summaryType === 'listado'
                                  ? '¿Qué secciones quieres en el listado?'
                                  : 'Contexto adicional (opcional)'}
                              </span>
                              <textarea
                                value={selectedSummaryInterview.summaryInstructions}
                                onChange={(event) =>
                                  updateInterview(selectedSummaryInterview.id, {
                                    summaryInstructions: event.target.value,
                                  })
                                }
                                rows={selectedSummaryInterview.summaryType === 'listado' ? 4 : 2}
                                placeholder={
                                  selectedSummaryInterview.summaryType === 'listado'
                                    ? 'Ej: Trayectoria profesional, Habilidades técnicas, Pretensiones salariales, Disponibilidad'
                                    : 'Ej: Candidata para puesto administrativo en correduría de seguros'
                                }
                              />
                            </label>
                          </div>
                          <div className="editor-actions">
                            <button
                              type="button"
                              className="primary-btn"
                              onClick={() =>
                                void handleGenerateSummary(selectedSummaryInterview.id)
                              }
                              disabled={
                                !groqApiKey ||
                                selectedSummaryInterview.transcriptionStatus !== 'done' ||
                                selectedSummaryInterview.summaryStatus === 'generating'
                              }
                            >
                              Generar resumen
                            </button>
                            <button
                              type="button"
                              className={`btn-copy${selectedSummaryInterview.summaryText ? ' btn-copy--filled' : ''}`}
                              disabled={!selectedSummaryInterview.summaryText}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(
                                    selectedSummaryInterview.summaryText,
                                  )
                                  setSaveMessage('Resumen copiado')
                                  window.setTimeout(() => setSaveMessage(''), 1800)
                                } catch {
                                  setSaveMessage('No se pudo copiar')
                                  window.setTimeout(() => setSaveMessage(''), 1800)
                                }
                              }}
                            >
                              Copiar
                            </button>
                            {selectedSummaryInterview.summaryStatus === 'generating' && (
                              <div className="spinner-row">
                                <span className="spinner" />
                                <span>Generando...</span>
                              </div>
                            )}
                            {selectedSummaryInterview.summaryStatus === 'error' && (
                              <p className="error-note">
                                Error al generar el resumen. Intenta de nuevo.
                              </p>
                            )}
                            {saveMessage && (
                              <span className="save-message">{saveMessage}</span>
                            )}
                          </div>
                          {(selectedSummaryInterview.summaryStatus === 'done' ||
                            selectedSummaryInterview.summaryText) && (
                            <div className="summary-result">
                              <textarea
                                value={selectedSummaryInterview.summaryText}
                                onChange={(event) =>
                                  updateInterview(selectedSummaryInterview.id, {
                                    summaryText: event.target.value,
                                  })
                                }
                                rows={10}
                              />
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="tab-note">
                          Selecciona una entrevista para generar su resumen.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="empty-title">Selecciona una candidata</p>
              <p className="empty-subtitle">
                Cuando selecciones un perfil, aqui veras su informacion y entrevistas.
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
