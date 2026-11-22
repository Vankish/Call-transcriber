// Pruebas de la sesión y la sincronización de datos con la nube (frente B), con
// un Convex falso en memoria: sin red, sin cuentas y sin tocar datos reales.
// Todo se escribe en carpetas temporales.

const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fsp = require('node:fs/promises')
const http = require('node:http')

const map = require('../../electron/cloud/sync-map.cjs')
const { createCloudSync, BATCH, MAX_SKIPS } = require('../../electron/cloud/sync.cjs')
const { createCloudSession, jwtPayload } = require('../../electron/cloud/session.cjs')
const { createConvexHttp, normalizeConvexUrl } = require('../../electron/cloud/convex-http.cjs')
const { resolveConvexUrl, fromDotenv } = require('../../electron/cloud/convex-url.cjs')

let tmpRoot
test.before(async () => { tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ct-sync-test-')) })
test.after(async () => { await fsp.rm(tmpRoot, { recursive: true, force: true }) })
const tmpFile = async (name) => path.join(await fsp.mkdtemp(path.join(tmpRoot, 'c-')), name)

// ── Datos inventados con la forma de call-transcriber-datos.json ─────────────

const ISO = '2026-11-01T10:00:00.000Z'
const MS = Date.parse(ISO)

function project(id, extra = {}) {
  return { id, ownerId: 'local', name: `Carpeta ${id}`, company: 'Acme', createdAt: ISO, status: 'active', evaluationCriteria: ['idiomas'], interviewers: ['Ana'], kind: 'entrevistas', ...extra }
}
function candidate(id, projectId, extra = {}) {
  return { id, projectId, createdAt: ISO, name: `Persona ${id}`, email: `${id}@ejemplo.test`, phone: '600000000', role: 'Ventas', notes: 'nota', candidateStatus: 'apto', consentGiven: true, consentAt: ISO, ...extra }
}
function interview(id, candidateId, extra = {}) {
  return {
    id, ownerId: 'local', candidateId, createdAt: ISO, sessionName: `Llamada ${id}`,
    status: 'stopped', durationSec: 61.6, micDeviceId: 'mic-123', outputDeviceId: 'out-456',
    transcriptOriginal: '', transcriptEdited: '', transcriptUpdatedAt: null,
    recordingUrl: 'blob:xyz', recordingFilePath: null, videoFilePath: null, systemAudioFilePath: null,
    captureSource: 'mic+system', transcriptionStatus: 'done', summaryInstructions: 'x', summaryText: 'resumen',
    summaryStatus: 'done', summaryType: 'resumen', summaryContext: 'entrevista', interviewerName: 'Ana', audioUploaded: false,
    ...extra,
  }
}

/**
 * Convex falso: imita las reglas de convex/sync.ts (upsert por localId, gana el
 * updatedAt mayor con empate aplicado, lo borrado no resucita, fila sin padre
 * se salta) y valida los campos igual de estricto que los validadores.
 */
function createFakeConvex() {
  const db = { project: new Map(), candidate: new Map(), interview: new Map(), transcript: new Map() }
  const calls = []
  let failNext = null

  const FIELDS = {
    project: ['localId', 'name', 'company', 'kind', 'status', 'evaluationCriteria', 'interviewers', 'createdAt', 'updatedAt'],
    candidate: ['localId', 'projectLocalId', 'name', 'email', 'phone', 'role', 'notes', 'candidateStatus', 'consentGiven', 'consentAt', 'crm', 'createdAt', 'updatedAt'],
    interview: ['localId', 'candidateLocalId', 'sessionName', 'durationSec', 'captureSource', 'interviewerName', 'transcriptionStatus', 'summaryText', 'summaryType', 'summaryContext', 'createdAt', 'updatedAt'],
  }
  const checkFields = (table, item) => {
    const extra = Object.keys(item).filter((k) => !FIELDS[table].includes(k))
    const missing = FIELDS[table].filter((k) => !(k in item))
    if (extra.length || missing.length) throw new Error(`validador ${table}: sobra ${extra} falta ${missing}`)
    if (typeof item.updatedAt !== 'number' || typeof item.createdAt !== 'number') throw new Error('fechas sin convertir')
  }
  const wins = (existing, updatedAt) => !existing || (existing.deletedAt === undefined && updatedAt >= existing.updatedAt)

  const push = (table, parentTable, parentKey) => ({ items }) => {
    if (items.length > 100) throw new Error('batch_too_large')
    const applied = []
    const skipped = []
    for (const item of items) {
      checkFields(table, item)
      const parent = parentTable ? db[parentTable].get(item[parentKey]) : true
      const existing = db[table].get(item.localId)
      if (!parent || parent.deletedAt !== undefined || !wins(existing, item.updatedAt)) { skipped.push(item.localId); continue }
      db[table].set(item.localId, { ...existing, ...item })
      applied.push(item.localId)
    }
    return { applied, skipped }
  }

  const fns = {
    'sync:pushProjects': push('project'),
    'sync:pushCandidates': push('candidate', 'project', 'projectLocalId'),
    'sync:pushInterviews': push('interview', 'candidate', 'candidateLocalId'),
    'sync:pushTranscript': (a) => {
      const iv = db.interview.get(a.interviewLocalId)
      const existing = db.transcript.get(a.interviewLocalId)
      if (!iv || iv.deletedAt !== undefined || !wins(existing, a.updatedAt)) return { applied: [], skipped: [a.interviewLocalId] }
      if (a.original.length + a.edited.length > 900_000) {
        throw Object.assign(new Error('La transcripción es demasiado larga para la nube.'), { code: 'too_large' })
      }
      db.transcript.set(a.interviewLocalId, { ...a })
      return { applied: [a.interviewLocalId], skipped: [] }
    },
    'sync:markDeleted': ({ kind, localIds, deletedAt }) => {
      const applied = []
      const skipped = []
      for (const id of localIds) {
        const row = db[kind].get(id)
        if (!row) { skipped.push(id); continue }
        if (row.deletedAt === undefined) row.deletedAt = deletedAt
        applied.push(id)
      }
      return { applied, skipped }
    },
  }

  async function callConvex(kind, fnPath, args) {
    calls.push({ kind, path: fnPath, args: JSON.parse(JSON.stringify(args)) })
    if (failNext) { const err = failNext; failNext = null; throw err }
    if (kind !== 'mutation') throw new Error(`${fnPath} no es ${kind}`)
    const fn = fns[fnPath]
    if (!fn) throw new Error(`función desconocida ${fnPath}`)
    return fn(args)
  }

  return { db, calls, callConvex, failNextWith: (err) => { failNext = err }, countOf: (p) => calls.filter((c) => c.path === p).length }
}

async function makeSync({ data, convex, enqueued = [], now } = {}) {
  const storeFile = await tmpFile('cloud-sync-state.json')
  const box = { data }
  let t = MS + 1_000_000
  const sync = createCloudSync({
    storeFile,
    readData: async () => box.data,
    enqueueMedia: async (entries) => { enqueued.push(...entries); return { added: entries.length, updated: 0, skipped: 0 } },
    now: now || (() => (t += 1000)),
    debounceMs: 10,
    retryBaseMs: 60_000,
  })
  await sync.setSession(convex.callConvex, 'https://falso.convex.cloud#ws1')
  return { sync, box, storeFile }
}

// ── Mapeo de campos ──────────────────────────────────────────────────────────

test('mapeo: fechas ISO a ms y solo los campos del esquema', () => {
  const p = map.toProjectItem(project('p1', { ownerId: 'x', kind: undefined }))
  assert.deepEqual(p, { localId: 'p1', name: 'Carpeta p1', company: 'Acme', kind: 'entrevistas', status: 'active', evaluationCriteria: ['idiomas'], interviewers: ['Ana'], createdAt: MS })

  const c = map.toCandidateItem(candidate('c1', 'p1', { consentAt: null, crm: { dealId: 'd1', company: 'Acme', contactEmail: 'a@b.test', linkedinUrl: '', stage: 'won', lastSentAt: ISO, spinSituation: 's', spinProblem: '', spinImplication: '', spinNeedPayoff: '', singleSalesObjective: '', nextStep: 'llamar', nota: '' } }))
  assert.equal(c.projectLocalId, 'p1')
  assert.equal(c.consentAt, null)
  assert.equal(c.crm.lastSentAt, MS)
  assert.equal(c.crm.nextStep, 'llamar')
  assert.equal('projectId' in c, false)

  const iv = map.toInterviewItem(interview('i1', 'c1', { recordingFilePath: 'C:\\x.webm' }))
  assert.equal(iv.candidateLocalId, 'c1')
  assert.equal(iv.durationSec, 62)
  assert.equal(iv.createdAt, MS)
  // Nada de rutas, dispositivos ni estado de la grabación.
  for (const k of ['recordingFilePath', 'systemAudioFilePath', 'videoFilePath', 'recordingUrl', 'micDeviceId', 'outputDeviceId', 'status', 'summaryStatus', 'summaryInstructions', 'audioUploaded', 'ownerId', 'transcriptOriginal']) {
    assert.equal(k in iv, false, `${k} no debe subir`)
  }
})

test('mapeo: valores raros caen en un valor válido en vez de tumbar el lote', () => {
  const iv = map.toInterviewItem({ id: 'i9', candidateId: 'c9', createdAt: 'no es fecha', durationSec: -3, captureSource: 'otro', transcriptionStatus: undefined, summaryType: 'x', summaryContext: null })
  assert.equal(iv.createdAt, 0)
  assert.equal(iv.durationSec, 0)
  assert.equal(iv.captureSource, 'none')
  assert.equal(iv.transcriptionStatus, 'pending')
  assert.equal(iv.summaryType, 'resumen')
  assert.equal(iv.summaryContext, 'entrevista')
  assert.equal(iv.sessionName, '')
  assert.equal(map.toCandidateItem({ id: 'c', projectId: 'p', candidateStatus: 'raro' }).candidateStatus, 'pendiente')
  assert.equal(map.toTranscriptItem({ id: 'i', transcriptOriginal: '', transcriptEdited: '' }), null)
})

// ── Sincronización ───────────────────────────────────────────────────────────

test('sube todo en orden, en lotes de 100, y no reenvía lo que no cambió', async () => {
  const convex = createFakeConvex()
  const projects = [project('p1')]
  const candidates = Array.from({ length: 150 }, (_, i) => candidate(`c${i}`, 'p1'))
  const interviews = Array.from({ length: 230 }, (_, i) => interview(`i${i}`, `c${i % 150}`, i < 3 ? { transcriptOriginal: `texto ${i}`, transcriptEdited: '' } : {}))
  const { sync } = await makeSync({ data: { projects, candidates, interviews }, convex })
  const r = await sync.runNow()
  assert.equal(r.ok, true)

  assert.equal(convex.db.project.size, 1)
  assert.equal(convex.db.candidate.size, 150)
  assert.equal(convex.db.interview.size, 230)
  assert.equal(convex.db.transcript.size, 3)
  assert.equal(convex.countOf('sync:pushCandidates'), 2)
  assert.equal(convex.countOf('sync:pushInterviews'), 3)
  for (const c of convex.calls) if (c.args.items) assert.ok(c.args.items.length <= BATCH)
  // Proyectos antes que perfiles y perfiles antes que entrevistas.
  const order = convex.calls.map((c) => c.path)
  assert.ok(order.indexOf('sync:pushProjects') < order.indexOf('sync:pushCandidates'))
  assert.ok(order.lastIndexOf('sync:pushCandidates') < order.indexOf('sync:pushInterviews'))
  assert.ok(order.lastIndexOf('sync:pushInterviews') < order.indexOf('sync:pushTranscript'))

  const before = convex.calls.length
  await sync.runNow()
  assert.equal(convex.calls.length, before, 'una segunda pasada sin cambios no llama a nada')
})

test('la marca de sincronizado sobrevive a un reinicio y solo se sube lo cambiado', async () => {
  const convex = createFakeConvex()
  const data = { projects: [project('p1')], candidates: [candidate('c1', 'p1')], interviews: [interview('i1', 'c1'), interview('i2', 'c1')] }
  const storeFile = await tmpFile('cloud-sync-state.json')
  const mk = () => createCloudSync({ storeFile, readData: async () => data, debounceMs: 10 })
  const a = mk()
  await a.setSession(convex.callConvex, 'k1')
  await a.runNow()
  a.stop()
  const firstUpdatedAt = convex.db.interview.get('i2').updatedAt

  data.interviews[1] = { ...data.interviews[1], summaryText: 'otro resumen', durationSec: 999 }
  // Cosas que NO suben no cuentan como cambio.
  data.interviews[0] = { ...data.interviews[0], micDeviceId: 'otro-micro', summaryStatus: 'generating' }
  const b = mk()
  const n = convex.calls.length
  await b.setSession(convex.callConvex, 'k1')
  await b.runNow()
  const after = convex.calls.slice(n)
  assert.deepEqual(after.map((c) => c.path), ['sync:pushInterviews'])
  assert.deepEqual(after[0].args.items.map((i) => i.localId), ['i2'])
  assert.equal(convex.db.interview.get('i2').summaryText, 'otro resumen')
  assert.ok(convex.db.interview.get('i2').updatedAt > firstUpdatedAt, 'updatedAt sube con cada cambio')

  // Con otra cuenta la marca no vale: se sube todo otra vez.
  const c = mk()
  const m = convex.calls.length
  await c.setSession(convex.callConvex, 'otra-cuenta')
  await c.runNow()
  assert.equal(convex.calls.slice(m).filter((x) => x.path === 'sync:pushInterviews')[0].args.items.length, 2)
})

test('lo que se está grabando no sube hasta que se para', async () => {
  const convex = createFakeConvex()
  const data = { projects: [project('p1')], candidates: [candidate('c1', 'p1')], interviews: [interview('i1', 'c1', { status: 'recording' })] }
  const { sync, box } = await makeSync({ data, convex })
  await sync.runNow()
  assert.equal(convex.db.interview.size, 0)
  box.data = { ...data, interviews: [{ ...data.interviews[0], status: 'stopped' }] }
  await sync.runNow()
  assert.equal(convex.db.interview.size, 1)
})

test('borrados: de hijos a padres y solo de lo que llegó arriba', async () => {
  const convex = createFakeConvex()
  const data = { projects: [project('p1'), project('p2')], candidates: [candidate('c1', 'p1'), candidate('c2', 'p2')], interviews: [interview('i1', 'c1'), interview('i2', 'c2')] }
  const { sync, box } = await makeSync({ data, convex })
  await sync.runNow()
  box.data = { projects: [project('p1')], candidates: [candidate('c1', 'p1')], interviews: [interview('i1', 'c1')] }
  await sync.runNow()
  const dels = convex.calls.filter((c) => c.path === 'sync:markDeleted').map((c) => [c.args.kind, c.args.localIds])
  assert.deepEqual(dels, [['interview', ['i2']], ['candidate', ['c2']], ['project', ['p2']]])
  assert.ok(convex.db.project.get('p2').deletedAt)
  const n = convex.calls.length
  await sync.runNow()
  assert.equal(convex.calls.length, n, 'un borrado se manda una sola vez')
})

test('un archivo de datos vacío no borra nada en la nube', async () => {
  const convex = createFakeConvex()
  const data = { projects: [project('p1')], candidates: [candidate('c1', 'p1')], interviews: [interview('i1', 'c1')] }
  const { sync, box } = await makeSync({ data, convex })
  await sync.runNow()
  box.data = { projects: [], candidates: [], interviews: [] }
  await sync.runNow()
  assert.equal(convex.countOf('sync:markDeleted'), 0)
  assert.equal(convex.db.project.get('p1').deletedAt, undefined)
})

test('una fila sin padre se reintenta, pero no para siempre', async () => {
  const convex = createFakeConvex()
  // Perfil huérfano: su carpeta no existe en local, así que nunca llega arriba.
  const data = { projects: [project('p1')], candidates: [candidate('c1', 'p1'), candidate('huerfano', 'p-no-existe')], interviews: [] }
  const { sync } = await makeSync({ data, convex })
  for (let i = 0; i < MAX_SKIPS + 2; i++) await sync.runNow()
  const sent = convex.calls.filter((c) => c.path === 'sync:pushCandidates').flatMap((c) => c.args.items.map((x) => x.localId))
  assert.equal(sent.filter((id) => id === 'huerfano').length, MAX_SKIPS)
  assert.equal(sent.filter((id) => id === 'c1').length, 1)
})

test('una transcripción demasiado grande no para las demás', async () => {
  const convex = createFakeConvex()
  const data = {
    projects: [project('p1')],
    candidates: [candidate('c1', 'p1')],
    interviews: [interview('i1', 'c1', { transcriptOriginal: 'x'.repeat(950_000) }), interview('i2', 'c1', { transcriptOriginal: 'hola', transcriptEdited: 'hola editado' })],
  }
  const { sync } = await makeSync({ data, convex })
  const r = await sync.runNow()
  assert.equal(r.ok, true)
  assert.equal(convex.db.transcript.has('i1'), false)
  assert.equal(convex.db.transcript.get('i2').edited, 'hola editado')
  const n = convex.countOf('sync:pushTranscript')
  await sync.runNow()
  assert.equal(convex.countOf('sync:pushTranscript'), n, 'la grande no se reintenta mientras no cambie')
})

test('si la red falla, se queda en "sin conexión" y reintenta; al volver sigue desde donde iba', async () => {
  const convex = createFakeConvex()
  const data = { projects: [project('p1')], candidates: [candidate('c1', 'p1')], interviews: [interview('i1', 'c1')] }
  const { sync } = await makeSync({ data, convex })
  convex.failNextWith(Object.assign(new Error('sin conexión'), { network: true }))
  const r = await sync.runNow()
  assert.equal(r.ok, false)
  assert.equal(sync.status().state, 'offline')
  assert.ok(sync.status().nextRetryAt)
  const r2 = await sync.runNow()
  assert.equal(r2.ok, true)
  assert.equal(sync.status().state, 'idle')
  assert.equal(convex.db.interview.size, 1)
  sync.stop()
})

test('archivos: solo de entrevistas nuevas ya subidas, una vez, y lo antiguo no', async () => {
  const convex = createFakeConvex()
  const enqueued = []
  let t = MS + 1_000_000
  const old = interview('viejo', 'c1', { createdAt: ISO, recordingFilePath: 'C:\\g\\viejo.webm' })
  const data = { projects: [project('p1')], candidates: [candidate('c1', 'p1')], interviews: [old] }
  const { sync, box } = await makeSync({ data, convex, enqueued, now: () => (t += 1000) })
  await sync.runNow()
  assert.equal(enqueued.length, 0, 'lo grabado antes de entrar va por "Subir grabaciones antiguas"')

  const nuevo = interview('nuevo', 'c1', {
    createdAt: new Date(t + 5000).toISOString(),
    recordingFilePath: 'C:\\g\\nuevo.webm', systemAudioFilePath: 'C:\\g\\nuevo_system.webm', videoFilePath: 'C:\\g\\nuevo_video.webm',
  })
  box.data = { ...data, interviews: [old, { ...nuevo, status: 'recording' }] }
  await sync.runNow()
  assert.equal(enqueued.length, 0, 'mientras se graba no se encola')
  box.data = { ...data, interviews: [old, nuevo] }
  await sync.runNow()
  assert.deepEqual(enqueued.map((e) => e.kind).sort(), ['mix', 'system', 'video'])
  assert.ok(enqueued.every((e) => e.interviewLocalId === 'nuevo' && e.durationSec === 61.6))
  await sync.runNow()
  assert.equal(enqueued.length, 3, 'no se vuelve a encolar lo mismo')
})

test('sin sesión no hace nada; cerrar sesión para la sincronización', async () => {
  const convex = createFakeConvex()
  const { sync } = await makeSync({ data: { projects: [project('p1')], candidates: [], interviews: [] }, convex })
  await sync.setSession(null)
  const r = await sync.runNow()
  assert.equal(r.ok, false)
  assert.equal(convex.calls.length, 0)
})

// ── Sesión ───────────────────────────────────────────────────────────────────

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`cifrado:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => Buffer.from(String(b).replace(/^cifrado:/, ''), 'base64').toString('utf-8'),
}

const jwt = (expSec, sub = 'user1|sess1') => [
  Buffer.from('{"alg":"RS256"}').toString('base64url'),
  Buffer.from(JSON.stringify({ sub, exp: expSec })).toString('base64url'),
  'firma',
].join('.')

function fakeAuthHttp({ now }) {
  const calls = []
  const accounts = new Map([['ana@ejemplo.test', 'contraseña-buena']])
  let refreshSeq = 0
  let validRefresh = new Set()
  const tokens = () => {
    const refreshToken = `rt-${++refreshSeq}`
    validRefresh = new Set([refreshToken])
    return { token: jwt(Math.floor(now() / 1000) + 3600), refreshToken }
  }
  async function call(kind, fnPath, args, token) {
    calls.push({ kind, path: fnPath, args, token })
    if (fnPath === 'auth:signIn') {
      if (args.refreshToken) {
        if (!validRefresh.has(args.refreshToken)) return { tokens: null }
        return { tokens: tokens() }
      }
      if (args.provider === 'password') {
        const { email, password, flow } = args.params
        if (flow === 'signUp') {
          if (accounts.has(email)) throw new Error('Account ana@ejemplo.test already exists')
          accounts.set(email, password)
          return { tokens: tokens() }
        }
        if (accounts.get(email) !== password) throw new Error('Invalid credentials')
        return { tokens: tokens() }
      }
      if (args.provider === 'google') return { redirect: 'https://falso.convex.site/api/auth/signin/google?code=abc', verifier: 'verificador-secreto' }
      if (args.params?.code) {
        if (args.verifier !== 'verificador-secreto' || args.params.code !== 'code-de-google') throw new Error('Could not verify code')
        return { tokens: tokens() }
      }
    }
    if (fnPath === 'auth:signOut') return null
    if (!token) throw Object.assign(new Error('sin token'), { auth: true })
    const exp = jwtPayload(token).exp * 1000
    if (exp <= now()) throw Object.assign(new Error('token expired'), { auth: true })
    if (fnPath === 'workspace:ensureMine') return { workspaceId: 'ws1', memberId: 'm1' }
    if (fnPath === 'member:list') return { members: [{ _id: 'm1', email: 'ana@ejemplo.test', name: 'Ana' }], invitations: [] }
    if (fnPath.startsWith('sync:push')) return { applied: (args.items || [args]).map((i) => i.localId ?? i.interviewLocalId), skipped: [] }
    return { ok: true }
  }
  return { url: 'https://falso.convex.cloud', call, calls }
}

test('sesión con contraseña: espacio propio, tokens cifrados en su archivo y refresco al caducar', async () => {
  let t = Date.parse('2026-11-22T10:00:00Z')
  const now = () => t
  const httpFake = fakeAuthHttp({ now })
  const storeFile = await tmpFile('cloud-session.bin')
  const changes = []
  const s = createCloudSession({ http: httpFake, storeFile, safeStorage: fakeSafeStorage, now, onChange: (x) => changes.push(x.state) })
  const st = await s.signInWithPassword({ email: ' Ana@Ejemplo.test ', password: 'contraseña-buena', flow: 'signIn' })
  assert.equal(st.state, 'signed-in')
  assert.equal(st.email, 'ana@ejemplo.test')
  assert.equal(st.workspaceId, 'ws1')
  assert.ok(httpFake.calls.some((c) => c.path === 'workspace:ensureMine'))

  const raw = await fsp.readFile(storeFile, 'utf-8')
  assert.ok(raw.startsWith('cifrado:'), 'en disco solo va cifrado')
  assert.equal(raw.includes('rt-'), false)

  // Una hora después el JWT ha caducado: se refresca solo antes de llamar.
  t += 3600_000
  await s.callConvex('mutation', 'sync:pushProjects', { items: [] })
  const refreshes = httpFake.calls.filter((c) => c.args?.refreshToken)
  assert.equal(refreshes.length, 1)

  // Otra instancia (reinicio de la app) recupera la sesión del archivo.
  const s2 = createCloudSession({ http: httpFake, storeFile, safeStorage: fakeSafeStorage, now })
  assert.equal((await s2.load()).state, 'signed-in')
  await s2.callConvex('query', 'algo:leer', {})

  await s2.signOut()
  assert.equal(s2.status().state, 'signed-out')
  await assert.rejects(fsp.stat(storeFile), 'cerrar sesión borra el archivo')
  assert.ok(changes.includes('signing-in') && changes.includes('signed-in'))
})

test('sesión: errores de contraseña con código estable y sin guardar nada', async () => {
  const now = () => Date.now()
  const httpFake = fakeAuthHttp({ now })
  const storeFile = await tmpFile('cloud-session.bin')
  const s = createCloudSession({ http: httpFake, storeFile, safeStorage: fakeSafeStorage, now })
  await assert.rejects(s.signInWithPassword({ email: 'ana@ejemplo.test', password: 'mala', flow: 'signIn' }))
  assert.equal(s.status().error, 'invalid-credentials')
  await assert.rejects(s.signInWithPassword({ email: 'ana@ejemplo.test', password: 'otra-cosa', flow: 'signUp' }))
  assert.equal(s.status().error, 'account-exists')
  await assert.rejects(fsp.stat(storeFile))
  const ok = await s.signInWithPassword({ email: 'nuevo@ejemplo.test', password: 'una-buena-clave', flow: 'signUp', name: 'Nuevo' })
  assert.equal(ok.state, 'signed-in')
})

test('sesión: un refreshToken rechazado cierra la sesión (caducada)', async () => {
  let t = Date.now()
  const now = () => t
  const httpFake = fakeAuthHttp({ now })
  const storeFile = await tmpFile('cloud-session.bin')
  const s = createCloudSession({ http: httpFake, storeFile, safeStorage: fakeSafeStorage, now })
  await s.signInWithPassword({ email: 'ana@ejemplo.test', password: 'contraseña-buena', flow: 'signIn' })
  // Otro inicio de sesión rota el refreshToken: el que tenemos deja de valer.
  await httpFake.call('action', 'auth:signIn', { provider: 'password', params: { email: 'ana@ejemplo.test', password: 'contraseña-buena', flow: 'signIn' } }, null)
  t += 3600_000
  await assert.rejects(s.callConvex('mutation', 'sync:pushProjects', { items: [] }))
  assert.equal(s.status().state, 'signed-out')
  assert.equal(s.status().error, 'expired')
})

test('sesión con Google: abre el navegador, espera el code y solo vale con nuestro verifier', async () => {
  const now = () => Date.now()
  const httpFake = fakeAuthHttp({ now })
  const storeFile = await tmpFile('cloud-session.bin')
  const opened = []
  const s = createCloudSession({ http: httpFake, storeFile, safeStorage: fakeSafeStorage, now, openExternal: async (u) => { opened.push(u) } })
  assert.equal(s.receiveOAuthCode('code-de-google'), false, 'sin un inicio pendiente, un code se ignora')
  const p = s.signInWithGoogle()
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  assert.equal(opened.length, 1)
  const first = httpFake.calls.find((c) => c.args?.provider === 'google')
  assert.equal(first.args.params.redirectTo, 'http://localhost:3000/convex-auth')
  assert.equal(s.receiveOAuthCode('code-de-google'), true)
  const st = await p
  assert.equal(st.state, 'signed-in')
  assert.equal(st.provider, 'google')
  assert.equal(st.email, 'ana@ejemplo.test', 'el correo sale del member del espacio')

  // Cancelar a medias deja la sesión como estaba (sin sesión) y sin error.
  await s.signOut()
  const p2 = s.signInWithGoogle()
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  assert.equal(s.cancelOAuth(), true)
  await assert.rejects(p2)
  assert.equal(s.status().state, 'signed-out')
  assert.equal(s.status().error, null)
})

test('sesión: sin cifrado del sistema no se escribe nada en disco', async () => {
  const now = () => Date.now()
  const httpFake = fakeAuthHttp({ now })
  const storeFile = await tmpFile('cloud-session.bin')
  const s = createCloudSession({ http: httpFake, storeFile, safeStorage: { isEncryptionAvailable: () => false }, now })
  await s.signInWithPassword({ email: 'ana@ejemplo.test', password: 'contraseña-buena', flow: 'signIn' })
  assert.equal(s.status().state, 'signed-in')
  await assert.rejects(fsp.stat(storeFile))
})

// ── Canales IPC (lo que ve la ventana) ───────────────────────────────────────

const { registerCloudIpc } = require('../../electron/cloud/cloud-ipc.cjs')

function fakeElectron(userData) {
  const handlers = new Map()
  const sent = []
  return {
    handlers,
    sent,
    ipcMain: { handle: (ch, fn) => { handlers.set(ch, fn) } },
    app: { whenReady: () => Promise.resolve(), getPath: () => userData },
    getWindow: () => ({ isDestroyed: () => false, webContents: { send: (ch, payload) => sent.push([ch, payload]) } }),
    invoke: (ch, payload) => handlers.get(ch)(null, payload),
  }
}

function fakeUploads() {
  const calls = { setCallConvex: [], enqueue: [] }
  return { calls, setCallConvex: async (fn) => { calls.setCallConvex.push(typeof fn) }, enqueue: async (e) => { calls.enqueue.push(...e); return { added: e.length, updated: 0, skipped: 0 } } }
}

test('ipc sin VITE_CONVEX_URL: todo responde "no configurado" y no hace nada', async () => {
  const userData = await fsp.mkdtemp(path.join(tmpRoot, 'ud-'))
  const el = fakeElectron(userData)
  const uploads = fakeUploads()
  const cloud = registerCloudIpc({ ...el, safeStorage: fakeSafeStorage, shell: {}, convexUrl: null, readData: async () => null, uploads, log: { info() {}, warn() {} } })
  assert.equal(cloud.configured, false)
  assert.deepEqual(await el.invoke('cloud:status'), { configured: false, session: null, sync: null })
  assert.equal((await el.invoke('cloud:sign-in-google')).errorCode, 'not-configured')
  assert.equal(cloud.handleAuthRequest({ method: 'GET', url: '/convex-auth?code=x' }, {}), false)
  cloud.notifyDataSaved()
  assert.deepEqual(uploads.calls.setCallConvex, [])
})

test('ipc: entrar conecta la cola de subidas y la sincronización; guardar datos sincroniza; salir desconecta', async () => {
  const userData = await fsp.mkdtemp(path.join(tmpRoot, 'ud-'))
  const el = fakeElectron(userData)
  const uploads = fakeUploads()
  const httpFake = fakeAuthHttp({ now: () => Date.now() })
  const data = { projects: [project('p1')], candidates: [candidate('c1', 'p1')], interviews: [interview('i1', 'c1')] }
  const cloud = registerCloudIpc({
    ...el, safeStorage: fakeSafeStorage, shell: { openExternal: async () => {} }, convexUrl: 'https://falso.convex.cloud',
    readData: async () => data, uploads, log: { info() {}, warn() {} }, httpOverride: httpFake, syncOptions: { debounceMs: 5 },
  })
  assert.equal((await el.invoke('cloud:status')).session.state, 'signed-out')

  const bad = await el.invoke('cloud:sign-in-password', { email: 'ana@ejemplo.test', password: 'mala', flow: 'signIn' })
  assert.deepEqual([bad.ok, bad.errorCode], [false, 'invalid-credentials'])

  const ok = await el.invoke('cloud:sign-in-password', { email: 'ana@ejemplo.test', password: 'contraseña-buena', flow: 'signIn' })
  assert.equal(ok.ok, true)
  assert.equal(ok.session.email, 'ana@ejemplo.test')
  assert.equal(JSON.stringify(ok).includes('rt-'), false, 'el token no llega nunca a la ventana')
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(uploads.calls.setCallConvex, ['function'])
  assert.ok(httpFake.calls.some((c) => c.path === 'sync:pushInterviews'), 'al entrar se sincroniza')

  data.interviews.push(interview('i2', 'c1'))
  cloud.notifyDataSaved()
  await new Promise((r) => setTimeout(r, 80))
  const last = httpFake.calls.filter((c) => c.path === 'sync:pushInterviews').at(-1)
  assert.deepEqual(last.args.items.map((i) => i.localId), ['i2'])
  assert.ok(el.sent.some(([ch, p]) => ch === 'cloud:status' && p.session?.state === 'signed-in'))

  // La vuelta de Google sin un inicio pendiente: responde, pero no vale.
  let html = ''
  const res = { writeHead() {}, end: (b) => { html = b } }
  assert.equal(cloud.handleAuthRequest({ method: 'GET', url: '/convex-auth?code=x' }, res), true)
  assert.ok(html.includes('Call Transcriber'))
  assert.equal(cloud.handleAuthRequest({ method: 'GET', url: '/otra' }, res), false)

  await el.invoke('cloud:sign-out')
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(uploads.calls.setCallConvex, ['function', 'object'], 'al salir la cola recibe null')
  cloud.stop()
})

// ── Cliente HTTP y dirección ─────────────────────────────────────────────────

test('cliente HTTP: formato de la API de Convex, errores con código y token rechazado', async (t) => {
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const parsed = JSON.parse(body)
      seen.push({ url: req.url, auth: req.headers.authorization, body: parsed })
      if (parsed.path === 'ok:fn') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'success', value: { n: 1 }, logLines: [] })); return }
      if (parsed.path === 'fail:fn') { res.writeHead(560); res.end(JSON.stringify({ status: 'error', errorMessage: 'Uncaught ConvexError', errorData: { code: 'forbidden', message: 'No tienes permiso.' } })); return }
      if (parsed.path === 'noauth:fn') { res.writeHead(560); res.end(JSON.stringify({ status: 'error', errorMessage: 'x', errorData: { code: 'unauthenticated', message: 'Inicia sesión primero.' } })); return }
      res.writeHead(401); res.end(JSON.stringify({ code: 'Unauthenticated', message: 'Could not verify OIDC token claim' }))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => server.close(r)))
  const c = createConvexHttp({ url: `http://127.0.0.1:${server.address().port}/` })

  assert.deepEqual(await c.call('mutation', 'ok.fn', { a: 1 }, 'tok'), { n: 1 })
  assert.equal(seen[0].url, '/api/mutation')
  assert.equal(seen[0].auth, 'Bearer tok')
  assert.deepEqual(seen[0].body, { path: 'ok:fn', args: { a: 1 }, format: 'json' })

  await assert.rejects(c.call('query', 'fail:fn', {}), (e) => e.code === 'forbidden' && !e.auth && e.message === 'No tienes permiso.')
  await assert.rejects(c.call('query', 'noauth:fn', {}), (e) => e.auth === true)
  await assert.rejects(c.call('action', 'otra:fn', {}, 'caducado'), (e) => e.auth === true && e.status === 401)
  await assert.rejects(createConvexHttp({ url: 'http://127.0.0.1:1' }).call('query', 'x:y', {}), (e) => e.network === true)
})

test('dirección de Convex: entorno, dist/cloud-config.json y .env en desarrollo; nada de http remoto', () => {
  assert.equal(normalizeConvexUrl('https://feliz-gato-123.convex.cloud/'), 'https://feliz-gato-123.convex.cloud')
  assert.equal(normalizeConvexUrl('http://ejemplo.com'), null)
  assert.equal(normalizeConvexUrl('http://127.0.0.1:3210'), 'http://127.0.0.1:3210')
  assert.equal(normalizeConvexUrl(''), null)
  assert.equal(fromDotenv('# x\nVITE_SUPABASE_URL=a\nVITE_CONVEX_URL="https://a.convex.cloud"\n'), 'https://a.convex.cloud')

  const files = {}
  const readFile = (f) => { const k = path.basename(f); if (!(k in files)) throw new Error('no existe'); return files[k] }
  const root = path.join(os.tmpdir(), 'raiz-falsa')
  assert.equal(resolveConvexUrl({ env: {}, appRoot: root, readFile }), null)
  files['.env'] = 'VITE_CONVEX_URL=https://dev.convex.cloud'
  assert.equal(resolveConvexUrl({ env: {}, appRoot: root, readFile }), null, 'el .env solo se mira en desarrollo')
  assert.equal(resolveConvexUrl({ env: {}, appRoot: root, readFile, isDev: true }), 'https://dev.convex.cloud')
  files['cloud-config.json'] = JSON.stringify({ convexUrl: 'https://prod.convex.cloud' })
  assert.equal(resolveConvexUrl({ env: {}, appRoot: root, readFile, isDev: true }), 'https://prod.convex.cloud')
  assert.equal(resolveConvexUrl({ env: { VITE_CONVEX_URL: 'https://env.convex.cloud' }, appRoot: root, readFile }), 'https://env.convex.cloud')
})
