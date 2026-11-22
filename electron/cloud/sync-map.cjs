// ── De call-transcriber-datos.json a las filas de la nube ────────────────────
//
// El archivo local guarda lo que usa la interfaz (tipos Project, Candidate e
// Interview de src/App.tsx): fechas en texto ISO, rutas de archivo, el micro
// elegido, el estado de la grabación... La nube (convex/schema.ts) solo quiere
// lo que alguien puede necesitar desde otro sitio, con fechas en milisegundos.
// Aquí se hace esa traducción, sin red ni estado, para poder probarla sola.
//
// Los validadores de Convex rechazan el lote entero si sobra un campo o uno
// tiene el tipo que no es, así que cada fila se arma campo a campo y con valores
// por defecto, en vez de copiar el objeto local y quitar lo que sobra: un campo
// nuevo en la interfaz no debe tumbar la sincronización.

const crypto = require('node:crypto')

/** ISO → ms. Lo que no se pueda leer devuelve `fallback`. */
function isoToMs(value, fallback = null) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value) return fallback
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : fallback
}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback)
const strArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

// Estados de la grabación en curso: una entrevista así todavía no existe de
// verdad (puede acabar descartada) y su duración cambia cada segundo.
const RECORDING_STATES = new Set(['recording', 'paused'])
const isRecordingInProgress = (iv) => RECORDING_STATES.has(iv?.status)

/** Fila de `project` sin `updatedAt` (lo pone quien sube). */
function toProjectItem(p) {
  return {
    localId: str(p.id),
    name: str(p.name),
    company: str(p.company),
    kind: oneOf(p.kind, ['entrevistas', 'clientes'], 'entrevistas'),
    status: oneOf(p.status, ['active', 'closed'], 'active'),
    evaluationCriteria: strArray(p.evaluationCriteria),
    interviewers: strArray(p.interviewers),
    createdAt: isoToMs(p.createdAt, 0),
  }
}

function toCrmDeal(crm) {
  if (!crm || typeof crm !== 'object') return null
  return {
    dealId: str(crm.dealId),
    company: str(crm.company),
    contactEmail: str(crm.contactEmail),
    linkedinUrl: str(crm.linkedinUrl),
    stage: str(crm.stage),
    lastSentAt: isoToMs(crm.lastSentAt, null),
    spinSituation: str(crm.spinSituation),
    spinProblem: str(crm.spinProblem),
    spinImplication: str(crm.spinImplication),
    spinNeedPayoff: str(crm.spinNeedPayoff),
    singleSalesObjective: str(crm.singleSalesObjective),
    nextStep: str(crm.nextStep),
    nota: str(crm.nota),
  }
}

function toCandidateItem(c) {
  return {
    localId: str(c.id),
    projectLocalId: str(c.projectId),
    name: str(c.name),
    email: str(c.email),
    phone: str(c.phone),
    role: str(c.role),
    notes: str(c.notes),
    candidateStatus: oneOf(c.candidateStatus, ['pendiente', 'apto', 'descartado', 'finalista'], 'pendiente'),
    consentGiven: c.consentGiven === true,
    consentAt: isoToMs(c.consentAt, null),
    crm: toCrmDeal(c.crm),
    createdAt: isoToMs(c.createdAt, 0),
  }
}

/**
 * Fila de `interview`. Lo que NO sube, a propósito: recordingFilePath,
 * systemAudioFilePath, videoFilePath y recordingUrl (rutas de este PC),
 * micDeviceId y outputDeviceId (dispositivos), status (grabación en curso),
 * summaryStatus y summaryInstructions (estado de la interfaz), audioUploaded y
 * ownerId (de la nube de Supabase que había antes). La transcripción va aparte.
 */
function toInterviewItem(iv) {
  return {
    localId: str(iv.id),
    candidateLocalId: str(iv.candidateId),
    sessionName: str(iv.sessionName),
    durationSec: Math.round(num(iv.durationSec)),
    captureSource: oneOf(iv.captureSource, ['none', 'mic', 'mic+system'], 'none'),
    interviewerName: str(iv.interviewerName),
    transcriptionStatus: oneOf(iv.transcriptionStatus, ['pending', 'transcribing', 'done', 'error'], 'pending'),
    summaryText: str(iv.summaryText),
    summaryType: oneOf(iv.summaryType, ['resumen', 'listado'], 'resumen'),
    summaryContext: oneOf(iv.summaryContext, ['entrevista', 'reunion'], 'entrevista'),
    createdAt: isoToMs(iv.createdAt, 0),
  }
}

/** La transcripción de una entrevista, o null si todavía no tiene texto. */
function toTranscriptItem(iv) {
  const original = str(iv.transcriptOriginal)
  const edited = str(iv.transcriptEdited)
  if (!original && !edited) return null
  // Sin `segments`: el escritorio de hoy solo guarda el texto. Cuando lo guarde
  // con sus tiempos, se añade aquí y la web podrá saltar al segundo de cada frase.
  return { interviewLocalId: str(iv.id), original, edited }
}

/** Huella de una fila: si no cambia, no hay nada que subir. */
function fingerprint(row) {
  return crypto.createHash('sha256').update(JSON.stringify(row)).digest('base64').slice(0, 22)
}

/** Las rutas de audio y vídeo de una entrevista, con el tipo que espera la cola. */
function mediaEntriesOf(iv) {
  const out = []
  if (iv.recordingFilePath) out.push({ filePath: iv.recordingFilePath, interviewLocalId: str(iv.id), kind: 'mix' })
  if (iv.systemAudioFilePath) out.push({ filePath: iv.systemAudioFilePath, interviewLocalId: str(iv.id), kind: 'system' })
  if (iv.videoFilePath) out.push({ filePath: iv.videoFilePath, interviewLocalId: str(iv.id), kind: 'video' })
  const durationSec = num(iv.durationSec)
  return durationSec ? out.map((e) => ({ ...e, durationSec })) : out
}

module.exports = {
  isoToMs,
  toProjectItem,
  toCandidateItem,
  toInterviewItem,
  toTranscriptItem,
  toCrmDeal,
  fingerprint,
  mediaEntriesOf,
  isRecordingInProgress,
}
