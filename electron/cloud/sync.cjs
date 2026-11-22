// ── Sincronización de datos con la nube ──────────────────────────────────────
//
// El PC es el original. Esto solo empuja hacia arriba una copia de lo que hay en
// call-transcriber-datos.json: proyectos, perfiles, entrevistas y
// transcripciones, y los borrados. No baja nada (eso es `sync.pull`, para un
// segundo PC, y queda para después).
//
// Las filas locales no tienen `updatedAt`, así que lo que "ha cambiado" se sabe
// comparando con lo último que se subió: se guarda la huella de cada fila
// subida en `cloud-sync-state.json` (userData). Si la huella es la misma, no se
// manda; si cambió, se manda con updatedAt = ahora. Así un arranque no reenvía
// cientos de entrevistas, y subir dos veces lo mismo no hace daño (el servidor
// hace upsert por localId).
//
// Respuestas del servidor que hay que entender (ver convex/sync.ts):
// - `skipped` mezcla tres casos que no se distinguen: el padre aún no está
//   arriba, arriba hay una versión más nueva, o arriba está borrado (y lo
//   borrado no resucita). Por eso una fila saltada se reintenta en las
//   siguientes pasadas, pero como mucho MAX_SKIPS veces mientras no cambie.
// - Empate de updatedAt = aplicado: repetir un lote que llegó pero cuya
//   respuesta se perdió es inofensivo.
//
// Nada de esto bloquea la interfaz ni la grabación: corre en el proceso
// principal, en segundo plano, y si falla se reintenta más tarde con espera
// creciente.

const { writeJsonAtomic, readJson } = require('./upload-queue.cjs')
const map = require('./sync-map.cjs')

const STORE_VERSION = 1
const BATCH = 100
const MAX_SKIPS = 3
const DEBOUNCE_MS = 4_000
const RETRY_BASE_MS = 30_000
const RETRY_MAX_MS = 15 * 60_000

const TABLES = ['project', 'candidate', 'interview', 'transcript']

const emptyState = (accountKey, now) => ({
  version: STORE_VERSION,
  accountKey,
  // Desde cuándo se suben solos los archivos de las entrevistas nuevas. Lo
  // anterior va por "Subir grabaciones antiguas", que enseña antes cuánto pesa.
  mediaSince: now,
  rows: { project: {}, candidate: {}, interview: {}, transcript: {} },
  media: {},
  lastSyncAt: null,
})

function createCloudSync({
  storeFile,
  readData,
  enqueueMedia = async () => ({ added: 0, updated: 0, skipped: 0 }),
  onStatus = () => {},
  log = { info() {}, warn() {} },
  now = () => Date.now(),
  debounceMs = DEBOUNCE_MS,
  retryBaseMs = RETRY_BASE_MS,
  retryMaxMs = RETRY_MAX_MS,
}) {
  let callConvex = null
  let accountKey = null
  let state = null
  let running = null
  let again = false
  let timer = null
  let failures = 0
  let status = { state: 'idle', lastSyncAt: null, error: null, errorCode: null, nextRetryAt: null, pending: 0, progress: null }

  const emit = (patch) => {
    status = { ...status, ...patch }
    try { onStatus({ ...status }) } catch { /* la ventana puede no existir */ }
  }

  const save = () => writeJsonAtomic(storeFile, state).catch((err) => {
    log.warn(`[nube] no se pudo guardar la marca de sincronizado: ${err.message}`)
  })

  async function loadState(key) {
    const saved = await readJson(storeFile)
    if (saved && saved.version === STORE_VERSION && saved.accountKey === key && saved.rows) {
      for (const t of TABLES) saved.rows[t] = saved.rows[t] || {}
      saved.media = saved.media || {}
      return saved
    }
    // Otra cuenta (u otro despliegue): lo que se subió allí no cuenta aquí.
    return emptyState(key, now())
  }

  /**
   * La capa de sesión avisa al entrar (con la función y la cuenta) y al salir
   * (con null). Al entrar se sincroniza enseguida.
   */
  async function setSession(fn, key) {
    callConvex = typeof fn === 'function' ? fn : null
    if (!callConvex) {
      accountKey = null
      clearTimeout(timer)
      timer = null
      emit({ state: 'idle', error: null, errorCode: null, nextRetryAt: null, progress: null })
      return
    }
    if (key !== accountKey || !state) {
      accountKey = key
      state = await loadState(key)
    }
    failures = 0
    emit({ lastSyncAt: state.lastSyncAt })
    schedule(0)
  }

  /** Tras cada guardado de datos: espera a que se calme y sincroniza. */
  function schedule(delay = debounceMs) {
    if (!callConvex) return
    clearTimeout(timer)
    timer = setTimeout(() => { timer = null; void runNow() }, Math.max(0, delay))
  }

  function runNow() {
    if (!callConvex) return Promise.resolve({ ok: false, reason: 'no-session' })
    if (running) { again = true; return running }
    running = (async () => {
      const result = { pushed: 0, total: 0 }
      try {
        do {
          again = false
          const r = await syncOnce()
          result.pushed += r.pushed || 0
          result.total += r.total || 0
        } while (again && callConvex)
        failures = 0
        emit({ state: 'idle', error: null, errorCode: null, nextRetryAt: null, progress: null, pending: 0, lastSyncAt: state?.lastSyncAt ?? null })
        return { ok: true, ...result }
      } catch (err) {
        if (!callConvex) return { ok: false, reason: 'no-session' }
        failures++
        const wait = Math.min(retryMaxMs, retryBaseMs * 2 ** (failures - 1))
        log.warn(`[nube] la sincronización falló (intento ${failures}): ${err?.message || err}`)
        emit({
          state: err?.network ? 'offline' : 'error',
          error: String(err?.message || err).slice(0, 300),
          errorCode: err?.code ?? null,
          nextRetryAt: now() + wait,
          progress: null,
        })
        schedule(wait)
        return { ok: false, reason: 'error', error: err }
      } finally {
        running = null
      }
    })()
    return running
  }

  // ── Una pasada ────────────────────────────────────────────────────────────

  const stamp = (prev) => Math.max(now(), (prev?.u ?? 0) + 1)

  /** Lo que hay que subir de una tabla: filas nuevas o cambiadas que no se han dado por perdidas. */
  function changed(table, items) {
    const marks = state.rows[table]
    const out = []
    for (const item of items) {
      const id = item.localId ?? item.interviewLocalId
      if (!id) continue
      const h = map.fingerprint(item)
      const m = marks[id]
      if (m && m.h === h) continue
      if (m && m.gaveUp === h) continue
      out.push({ id, h, item })
    }
    return out
  }

  function recordResult(table, batch, res) {
    const marks = state.rows[table]
    const applied = new Set(res?.applied || [])
    for (const { id, h, updatedAt } of batch) {
      if (applied.has(id)) {
        marks[id] = { h, u: updatedAt }
      } else {
        const prev = marks[id] || {}
        const skips = (prev.pendingHash === h ? prev.skips || 0 : 0) + 1
        marks[id] = { ...prev, pendingHash: h, skips, ...(skips >= MAX_SKIPS ? { gaveUp: h } : {}) }
        if (!prev.h) delete marks[id].h
      }
    }
    return applied
  }

  async function pushBatches(table, fnPath, rows, progress) {
    let applied = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      if (!callConvex) throw Object.assign(new Error('sesión cerrada'), { code: 'no-session' })
      const batch = rows.slice(i, i + BATCH).map((r) => ({ ...r, updatedAt: stamp(state.rows[table][r.id]) }))
      const items = batch.map((r) => ({ ...r.item, updatedAt: r.updatedAt }))
      const res = await callConvex('mutation', fnPath, { items })
      applied += recordResult(table, batch, res).size
      await save()
      progress(batch.length)
    }
    return applied
  }

  async function syncOnce() {
    const data = await readData()
    if (!data || typeof data !== 'object') return { pushed: 0 }
    const projects = Array.isArray(data.projects) ? data.projects : []
    const candidates = Array.isArray(data.candidates) ? data.candidates : []
    const allInterviews = Array.isArray(data.interviews) ? data.interviews : []
    // Lo que se está grabando ahora mismo no sube hasta que se pare.
    const interviews = allInterviews.filter((iv) => !map.isRecordingInProgress(iv))

    const todo = {
      project: changed('project', projects.map(map.toProjectItem)),
      candidate: changed('candidate', candidates.map(map.toCandidateItem)),
      interview: changed('interview', interviews.map(map.toInterviewItem)),
    }
    // Las transcripciones solo de entrevistas que ya están arriba (o van ahora).
    const transcripts = changed('transcript', interviews.map(map.toTranscriptItem).filter(Boolean))

    const deletions = plannedDeletions({ projects, candidates, interviews: allInterviews })
    const total = todo.project.length + todo.candidate.length + todo.interview.length + transcripts.length
      + deletions.reduce((s, d) => s + d.ids.length, 0)

    let done = 0
    const progress = (n) => { done += n; emit({ state: 'syncing', progress: { done, total } }) }
    if (total) emit({ state: 'syncing', progress: { done: 0, total }, pending: total })

    // El orden importa: un perfil necesita su proyecto arriba, y una entrevista su perfil.
    let pushed = 0
    pushed += await pushBatches('project', 'sync:pushProjects', todo.project, progress)
    pushed += await pushBatches('candidate', 'sync:pushCandidates', todo.candidate, progress)
    pushed += await pushBatches('interview', 'sync:pushInterviews', todo.interview, progress)

    for (const row of transcripts) {
      if (!callConvex) break
      if (!state.rows.interview[row.id]?.h) { progress(1); continue } // la entrevista aún no está arriba
      const updatedAt = stamp(state.rows.transcript[row.id])
      try {
        const res = await callConvex('mutation', 'sync:pushTranscript', { ...row.item, updatedAt })
        pushed += recordResult('transcript', [{ ...row, updatedAt }], res).size
      } catch (err) {
        // Una transcripción demasiado grande no debe parar las demás.
        if (err?.code !== 'too_large' && err?.code !== 'invalid_argument') throw err
        state.rows.transcript[row.id] = { ...(state.rows.transcript[row.id] || {}), gaveUp: row.h, error: err.code }
        log.warn(`[nube] transcripción de ${row.id} no subida: ${err.message}`)
      }
      await save()
      progress(1)
    }

    for (const { kind, table, ids } of deletions) {
      for (let i = 0; i < ids.length; i += BATCH) {
        if (!callConvex) break
        const chunk = ids.slice(i, i + BATCH)
        // Aplicado o saltado (no estaba arriba): en los dos casos ya no hay nada que seguir.
        await callConvex('mutation', 'sync:markDeleted', { kind, localIds: chunk, deletedAt: now() })
        for (const id of chunk) {
          delete state.rows[table][id]
          if (table === 'interview') { delete state.rows.transcript[id]; delete state.media[id] }
        }
        await save()
        progress(chunk.length)
      }
    }

    await enqueueNewMedia(interviews)

    state.lastSyncAt = now()
    await save()
    return { pushed, total }
  }

  /**
   * Lo que estaba arriba y ya no está en el archivo. Si el archivo viene vacío
   * del todo no se borra nada: eso pasa al vaciarlo a propósito (o si se dañó),
   * no porque se hayan borrado todas las carpetas, y borrar arriba todo el
   * histórico por un archivo vacío sería un desastre difícil de deshacer.
   */
  function plannedDeletions({ projects, candidates, interviews }) {
    if (!projects.length && !candidates.length && !interviews.length) {
      const had = TABLES.some((t) => Object.keys(state.rows[t]).length)
      if (had) log.warn('[nube] el archivo de datos está vacío: no se borra nada en la nube')
      return []
    }
    const present = {
      project: new Set(projects.map((p) => String(p.id))),
      candidate: new Set(candidates.map((c) => String(c.id))),
      interview: new Set(interviews.map((iv) => String(iv.id))),
    }
    const out = []
    // De hijos a padres, para que nada quede apuntando a algo ya borrado.
    for (const table of ['interview', 'candidate', 'project']) {
      const ids = Object.keys(state.rows[table]).filter((id) => !present[table].has(id))
      // Solo lo que de verdad llegó arriba; lo que nunca se aplicó se olvida y ya.
      const uploaded = ids.filter((id) => state.rows[table][id]?.h)
      for (const id of ids) if (!state.rows[table][id]?.h) delete state.rows[table][id]
      if (uploaded.length) out.push({ kind: table, table, ids: uploaded })
    }
    return out
  }

  /** Mete en la cola de subidas los archivos de las entrevistas nuevas que ya están arriba. */
  async function enqueueNewMedia(interviews) {
    const entries = []
    const keys = []
    for (const iv of interviews) {
      const id = String(iv.id)
      if (!state.rows.interview[id]?.h) continue
      const created = map.isoToMs(iv.createdAt, 0)
      if (created < (state.mediaSince || 0)) continue
      const files = map.mediaEntriesOf(iv)
      if (!files.length) continue
      const key = files.map((f) => `${f.kind}=${f.filePath}`).join('|')
      if (state.media[id] === key) continue
      entries.push(...files)
      keys.push([id, key])
    }
    if (!entries.length) return
    try {
      await enqueueMedia(entries)
      for (const [id, key] of keys) state.media[id] = key
    } catch (err) {
      // La cola falló (disco lleno, por ejemplo): se intenta en la próxima pasada.
      log.warn(`[nube] no se pudieron encolar los archivos: ${err.message}`)
    }
  }

  return {
    setSession,
    schedule,
    runNow,
    status: () => ({ ...status }),
    /** Para las pruebas y el panel: lo que se recuerda como subido. */
    debugState: () => (state ? JSON.parse(JSON.stringify(state)) : null),
    stop: () => { clearTimeout(timer); timer = null; callConvex = null },
  }
}

module.exports = { createCloudSync, BATCH, MAX_SKIPS }
