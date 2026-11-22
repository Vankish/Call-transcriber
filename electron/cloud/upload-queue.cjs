// ── Cola de subidas en segundo plano ─────────────────────────────────────────
//
// Sube los audios y vídeos de uno en uno, sin que la interfaz espere, y se
// acuerda de lo que le queda aunque se cierre la app: la cola vive en un archivo
// de userData (`cloud-upload-queue.json`) y cada subida se reanuda desde las
// partes que el servidor ya tiene.
//
// Una sola subida a la vez, a propósito: subir 4 vídeos en paralelo no acaba
// antes (la línea de subida es la misma) y sí satura el disco y la red mientras
// el usuario está en otra llamada.
//
// Mientras se graba no se sube ni se comprime nada: la parte en curso termina
// (son 8 MB, segundos) y la cola espera. Una videollamada con la subida a tope
// se corta, y comprimir a la vez que se graba vídeo es justo lo que satura el PC.
//
// Formato del evento de progreso (`emit(snapshot)`), el mismo que devuelve
// `status()`; está documentado en el informe del frente C y en global.d.ts:
//
//   {
//     state: 'idle' | 'working' | 'paused' | 'waiting',
//     pausedBy: 'user' | 'recording' | 'no-session' | null,
//     batch: { total, done, failed, index },   // "subiendo {index}/{total}"
//     bytes: { done, total },                  // del lote, para el % global
//     percent,                                 // 0-100 del lote
//     current: { id, interviewLocalId, kind, fileName, phase, percent } | null,
//     nextRetryAt,                             // ms, si se espera para reintentar
//   }

const path = require('node:path')
const fsp = require('node:fs/promises')
const { uploadFile, sha256File, MEDIA_FN, abortError } = require('./upload-file.cjs')
const compress = require('./upload-compress.cjs')
const { tr } = require('../i18n.cjs')

const STORE_VERSION = 1
const MAX_ATTEMPTS = 8
const EMIT_EVERY_MS = 250

const MIME = {
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg',
  flac: 'audio/flac', aac: 'audio/aac', wma: 'audio/x-ms-wma', mp4: 'video/mp4', mkv: 'video/x-matroska',
}

function mimeFor(filePath, kind) {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (ext === 'webm') return kind === 'video' ? 'video/webm' : 'audio/webm'
  if (ext === 'mp4' && kind !== 'video') return 'audio/mp4'
  return MIME[ext] || 'application/octet-stream'
}

/** Escritura atómica con volcado, igual que `writeData` en main.cjs. */
async function writeJsonAtomic(target, payload) {
  await fsp.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  const handle = await fsp.open(tmp, 'w')
  try {
    await handle.writeFile(JSON.stringify(payload), 'utf-8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    JSON.parse(await fsp.readFile(target, 'utf-8'))
    await fsp.copyFile(target, `${target}.bak`)
  } catch { /* la actual no existe o está dañada: no pisar la copia buena */ }
  await fsp.rename(tmp, target)
}

async function readJson(file) {
  for (const f of [file, `${file}.bak`]) {
    try { return JSON.parse(await fsp.readFile(f, 'utf-8')) } catch { /* siguiente */ }
  }
  return null
}

const itemId = (interviewLocalId, kind) => `${interviewLocalId}:${kind}`
const tmpNameFor = (id) => `${id.replace(/[^\w.-]+/g, '_')}.mp4`

function createUploadQueue({
  storeFile,
  tmpDir,
  ffmpegPath,
  fetchImpl = globalThis.fetch,
  callConvex = null,
  emit = () => {},
  log = { info() {}, warn() {} },
  retry = {},
  now = () => Date.now(),
  // Para las pruebas: base de la espera entre intentos de un archivo entero.
  itemRetryBaseMs = 15_000,
  itemRetryMaxMs = 30 * 60_000,
  // Para las pruebas: forzar un codificador ('libx264') o desactivar la compresión (false).
  encoder,
}) {
  let state = { version: STORE_VERSION, batchStartedAt: 0, paused: false, items: [] }
  let recording = false
  let stopped = false
  let loopPromise = null
  let wakeResolve = null
  let current = null // { item, phase, percent, ctrl, abortReason }
  let lastEmit = 0
  let emitTimer = null
  let saveChain = Promise.resolve()

  const save = () => {
    const snapshot = JSON.parse(JSON.stringify(state))
    saveChain = saveChain.then(() => writeJsonAtomic(storeFile, snapshot)).catch((err) => {
      log.warn(`[nube] no se pudo guardar la cola de subidas: ${err.message}`)
    })
    return saveChain
  }

  const wake = () => { const r = wakeResolve; wakeResolve = null; r?.() }

  const waitForWake = (ms) => new Promise((resolve) => {
    wakeResolve = resolve
    if (ms != null) setTimeout(() => { if (wakeResolve === resolve) wakeResolve = null; resolve() }, Math.max(0, ms))
  })

  const blockedBy = () => {
    if (state.paused) return 'user'
    if (recording) return 'recording'
    if (!callConvex) return 'no-session'
    return null
  }

  function inBatch(it) {
    return it.status !== 'done' || (it.completedAt || 0) >= state.batchStartedAt
  }

  function status() {
    const batch = state.items.filter(inBatch)
    const done = batch.filter((it) => it.status === 'done').length
    const failed = batch.filter((it) => it.status === 'error').length
    const pending = batch.filter((it) => it.status === 'pending')
    const totalBytes = batch.reduce((s, it) => s + (it.size || 0), 0)
    let doneBytes = batch.filter((it) => it.status === 'done').reduce((s, it) => s + (it.size || 0), 0)
    if (current) doneBytes += Math.round(((current.percent || 0) / 100) * (current.item.size || 0))
    const futureRetries = pending.map((it) => it.nextAttemptAt || 0).filter((t) => t > now())
    const by = blockedBy()
    let st = 'idle'
    if (current) st = 'working'
    else if (pending.length && by) st = 'paused'
    else if (pending.length) st = 'waiting'
    return {
      state: st,
      pausedBy: pending.length || current ? by : null,
      batch: {
        total: batch.length,
        done,
        failed,
        index: Math.min(batch.length, done + failed + (current ? 1 : 0)),
      },
      bytes: { done: doneBytes, total: totalBytes },
      percent: totalBytes ? Math.min(100, Math.round((doneBytes / totalBytes) * 100)) : (batch.length ? 100 : 0),
      current: current ? {
        id: current.item.id,
        interviewLocalId: current.item.interviewLocalId,
        kind: current.item.kind,
        fileName: path.basename(current.item.filePath),
        phase: current.phase,
        percent: current.percent,
      } : null,
      nextRetryAt: futureRetries.length && !current ? Math.min(...futureRetries) : null,
    }
  }

  // Los cambios de estado salen al momento; el progreso de una parte, como mucho
  // 4 veces por segundo, para no inundar la ventana con mensajes IPC.
  function notify(force = false) {
    const t = now()
    if (force || t - lastEmit >= EMIT_EVERY_MS) {
      lastEmit = t
      if (emitTimer) { clearTimeout(emitTimer); emitTimer = null }
      try { emit(status()) } catch { /* la ventana puede no existir */ }
      return
    }
    if (!emitTimer) emitTimer = setTimeout(() => { emitTimer = null; notify(true) }, EMIT_EVERY_MS)
  }

  async function load() {
    const saved = await readJson(storeFile)
    if (saved && saved.version === STORE_VERSION && Array.isArray(saved.items)) state = saved
    // Lo que estaba "trabajando" cuando se cerró la app vuelve a la cola: el
    // servidor sabe qué partes llegaron, así que no se pierde nada.
    for (const it of state.items) if (it.status === 'working') it.status = 'pending'
    await fsp.mkdir(tmpDir, { recursive: true }).catch(() => {})
    // Temporales de compresión que ya no pertenecen a ningún elemento pendiente.
    const keep = new Set(state.items.filter((it) => it.status !== 'done' && it.prepared?.compressed).map((it) => path.basename(it.prepared.path)))
    for (const name of await fsp.readdir(tmpDir).catch(() => [])) {
      if (!keep.has(name)) await fsp.rm(path.join(tmpDir, name), { force: true }).catch(() => {})
    }
  }

  /**
   * Mete archivos en la cola. Cada uno: { filePath, interviewLocalId, kind,
   * localRelPath, durationSec? }. Uno por entrevista y tipo, como en R2.
   * → { added, updated, skipped }
   */
  async function enqueue(entries) {
    const result = { added: 0, updated: 0, skipped: 0 }
    const hadPending = state.items.some((it) => it.status !== 'done')
    if (!hadPending) state.batchStartedAt = now()
    for (const e of entries) {
      if (!e?.filePath || !e.interviewLocalId || !['mix', 'system', 'video'].includes(e.kind)) { result.skipped++; continue }
      let st
      try { st = await fsp.stat(e.filePath) } catch { result.skipped++; continue }
      const id = itemId(e.interviewLocalId, e.kind)
      const existing = state.items.find((it) => it.id === id)
      const same = existing && existing.filePath === e.filePath && existing.size === st.size && existing.mtimeMs === st.mtimeMs
      if (existing && same && existing.status !== 'error') { result.skipped++; continue }
      const base = {
        id,
        filePath: e.filePath,
        interviewLocalId: String(e.interviewLocalId),
        kind: e.kind,
        localRelPath: String(e.localRelPath || path.basename(e.filePath)).replace(/\\/g, '/'),
        durationSec: Number.isFinite(e.durationSec) && e.durationSec > 0 ? e.durationSec : null,
        size: st.size,
        mtimeMs: st.mtimeMs,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
        errorCode: null,
        addedAt: now(),
        completedAt: null,
      }
      if (existing) {
        // El archivo cambió (o falló y se vuelve a pedir): se conserva la subida
        // a medias solo si es el mismo archivo; si no, se prepara de nuevo.
        Object.assign(existing, base, same ? { prepared: existing.prepared, mediaId: existing.mediaId } : { prepared: null })
        if (!same) await dropPrepared(existing, { keepMedia: true })
        result.updated++
      } else {
        state.items.push({ ...base, prepared: null, mediaId: null })
        result.added++
      }
    }
    await save()
    notify(true)
    wake()
    return result
  }

  async function dropPrepared(item, { keepMedia = false } = {}) {
    if (item.prepared?.compressed) await fsp.rm(item.prepared.path, { force: true }).catch(() => {})
    item.prepared = null
    if (!keepMedia) item.mediaId = null
  }

  function pickNext() {
    const t = now()
    const ready = state.items.filter((it) => it.status === 'pending' && (it.nextAttemptAt || 0) <= t)
    // Primero el audio: pesa poco y es lo que hace falta para escuchar y transcribir
    // desde otro sitio; los vídeos grandes, detrás.
    ready.sort((a, b) => ((a.kind === 'video') - (b.kind === 'video')) || a.addedAt - b.addedAt)
    return ready[0] || null
  }

  // Puerta entre parte y parte: si se pausa o empieza una grabación, la subida
  // espera aquí sin perder lo hecho.
  async function gate(ctrl) {
    while (blockedBy() && !stopped && !ctrl.signal.aborted) {
      notify(true)
      await waitForWake(1000)
    }
    if (stopped || ctrl.signal.aborted) throw abortError()
  }

  async function prepare(item, ctrl) {
    const st = await fsp.stat(item.filePath).catch(() => null)
    if (!st) {
      const err = new Error(tr('No se encuentra el archivo en este PC'))
      err.code = 'missing-file'
      throw err
    }
    if (st.size !== item.size || st.mtimeMs !== item.mtimeMs) {
      item.size = st.size
      item.mtimeMs = st.mtimeMs
      await dropPrepared(item, { keepMedia: true })
    }
    if (item.prepared && (await fsp.stat(item.prepared.path).catch(() => null))) return item.prepared

    let uploadPath = item.filePath
    let compressed = false
    let encoderUsed = null
    let mimeType = mimeFor(item.filePath, item.kind)
    let durationSec = item.durationSec

    if (item.kind === 'video' && encoder !== false && ffmpegPath) {
      const info = await compress.probe(ffmpegPath, item.filePath)
      durationSec = durationSec || info.durationSec
      const decision = compress.decide({ kind: item.kind, bytes: st.size, durationSec, height: info.height })
      if (decision.action === 'transcode') {
        if (recording) throw abortError()
        current.phase = 'compressing'
        current.percent = 0
        notify(true)
        const out = path.join(tmpDir, tmpNameFor(item.id))
        await fsp.mkdir(tmpDir, { recursive: true })
        const r = await compress.compressVideo({
          ffmpegPath,
          input: item.filePath,
          output: out,
          durationSec,
          encoder,
          signal: ctrl.signal,
          onProgress: ({ percent }) => { current.percent = percent; notify() },
        })
        // Si comprimido no ahorra al menos un 15 %, se sube el original: mejor
        // calidad por casi el mismo coste.
        if (r.bytes < st.size * 0.85) {
          uploadPath = out
          compressed = true
          encoderUsed = r.encoder
          mimeType = 'video/mp4'
          log.info(`[nube] ${path.basename(item.filePath)}: ${Math.round(st.size / 1048576)} → ${Math.round(r.bytes / 1048576)} MB con ${r.encoder} en ${Math.round(r.elapsedMs / 1000)} s`)
        } else {
          await fsp.rm(out, { force: true }).catch(() => {})
        }
      }
    }

    current.phase = 'hashing'
    current.percent = 0
    notify(true)
    const upSize = compressed ? (await fsp.stat(uploadPath)).size : st.size
    const sha256 = await sha256File(uploadPath, {
      signal: ctrl.signal,
      onBytes: (n) => { current.percent = Math.round((n / upSize) * 100); notify() },
    })
    // Un vídeo recomprimido de nuevo (por ejemplo, tras borrarse el temporal)
    // tiene otro hash: la subida a medias del anterior ya no sirve.
    if (item.mediaId && item.prepared?.sha256 && item.prepared.sha256 !== sha256) {
      await callConvex(MEDIA_FN.abort, 'media:abort', { mediaId: item.mediaId }).catch(() => {})
      item.mediaId = null
    }
    item.durationSec = durationSec || null
    item.prepared = { path: uploadPath, compressed, encoder: encoderUsed, mimeType, sha256, bytes: upSize }
    await save()
    return item.prepared
  }

  async function processItem(item) {
    const ctrl = new AbortController()
    current = { item, phase: 'preparing', percent: 0, ctrl, abortReason: null }
    item.status = 'working'
    notify(true)
    try {
      const prepared = await prepare(item, ctrl)
      current.phase = 'uploading'
      current.percent = 0
      notify(true)
      const meta = {
        interviewLocalId: item.interviewLocalId,
        kind: item.kind,
        mimeType: prepared.mimeType,
        localRelPath: item.localRelPath,
      }
      if (item.durationSec) meta.durationSec = Math.round(item.durationSec)
      const res = await uploadFile({
        callConvex,
        fetchImpl,
        filePath: prepared.path,
        sha256: prepared.sha256,
        meta,
        signal: ctrl.signal,
        retry,
        beforePart: () => gate(ctrl),
        onStarted: ({ mediaId }) => { item.mediaId = mediaId; void save() },
        onProgress: ({ phase, bytesDone, bytesTotal }) => {
          current.phase = phase
          current.percent = bytesTotal ? Math.round((bytesDone / bytesTotal) * 100) : 100
          notify()
        },
      })
      item.status = 'done'
      item.completedAt = now()
      item.mediaId = res.mediaId
      item.sha256 = res.sha256
      item.uploadedBytes = res.bytes
      item.alreadyUploaded = !!res.alreadyUploaded
      item.lastError = null
      item.errorCode = null
      await dropPrepared(item, { keepMedia: true })
    } catch (err) {
      if (err?.name === 'AbortError') {
        // Pausa, grabación o cierre: no cuenta como intento fallido.
        item.status = 'pending'
      } else {
        item.attempts = (item.attempts || 0) + 1
        item.lastError = String(err?.message || err).slice(0, 500)
        const fatal = err?.code === 'missing-file' || err?.retryable === false
        item.errorCode = err?.code === 'missing-file' ? 'missing-file' : 'failed'
        if (fatal || item.attempts >= MAX_ATTEMPTS) {
          item.status = 'error'
        } else {
          // Espera creciente por archivo: un fallo de Convex (por ejemplo, que la
          // entrevista aún no se ha sincronizado) se arregla solo al rato.
          item.status = 'pending'
          item.nextAttemptAt = now() + Math.min(itemRetryMaxMs, itemRetryBaseMs * 2 ** (item.attempts - 1))
        }
        log.warn(`[nube] subida de ${path.basename(item.filePath)} falló (intento ${item.attempts}): ${item.lastError}`)
      }
    } finally {
      current = null
      await save()
      notify(true)
    }
  }

  async function loop() {
    while (!stopped) {
      if (blockedBy()) { notify(true); await waitForWake(); continue }
      const next = pickNext()
      if (!next) {
        const future = state.items.filter((it) => it.status === 'pending').map((it) => it.nextAttemptAt || 0)
        notify(true)
        await waitForWake(future.length ? Math.min(...future) - now() : null)
        continue
      }
      await processItem(next)
    }
  }

  function start() {
    if (!loopPromise) { stopped = false; loopPromise = loop().finally(() => { loopPromise = null }) }
    return loopPromise
  }

  /** Para la cola (al cerrar la app). Lo que esté a medias sigue en el servidor. */
  async function stop() {
    stopped = true
    current?.ctrl.abort()
    wake()
    await loopPromise
    if (emitTimer) { clearTimeout(emitTimer); emitTimer = null }
    await saveChain
  }

  /** La app avisa de si está grabando. Comprimir o leer un archivo entero se corta al momento. */
  function setRecording(value) {
    recording = !!value
    if (recording && current && ['preparing', 'compressing', 'hashing'].includes(current.phase)) {
      current.ctrl.abort()
    }
    notify(true)
    wake()
  }

  function setCallConvex(fn) {
    callConvex = typeof fn === 'function' ? fn : null
    if (!callConvex && current) current.ctrl.abort()
    notify(true)
    wake()
  }

  async function pause() { state.paused = true; await save(); notify(true); wake() }
  async function resume() { state.paused = false; await save(); notify(true); wake() }

  /** Vuelve a intentar los que fallaron (todos, o uno por id). */
  async function retryFailed(id) {
    let n = 0
    for (const it of state.items) {
      if ((id ? it.id === id : true) && (it.status === 'error' || (it.status === 'pending' && it.nextAttemptAt > now()))) {
        it.status = 'pending'
        it.attempts = 0
        it.nextAttemptAt = 0
        n++
      }
    }
    await save()
    notify(true)
    wake()
    return { retried: n }
  }

  /** Quita un elemento de la cola. Si se estaba subiendo, se cancela también en el servidor. */
  async function remove(id) {
    const it = state.items.find((x) => x.id === id)
    if (!it) return { removed: false }
    if (current?.item === it) current.ctrl.abort()
    if (it.status !== 'done' && it.mediaId && callConvex) {
      await callConvex(MEDIA_FN.abort, 'media:abort', { mediaId: it.mediaId }).catch(() => {})
    }
    await dropPrepared(it)
    state.items = state.items.filter((x) => x !== it)
    await save()
    notify(true)
    return { removed: true }
  }

  /** Lista de la cola, sin los detalles internos. */
  function list() {
    return state.items.map((it) => ({
      id: it.id,
      interviewLocalId: it.interviewLocalId,
      kind: it.kind,
      fileName: path.basename(it.filePath),
      localRelPath: it.localRelPath,
      size: it.size,
      status: current?.item === it ? 'working' : it.status,
      attempts: it.attempts,
      nextAttemptAt: it.nextAttemptAt || null,
      errorCode: it.errorCode,
      lastError: it.lastError,
      compressed: !!(it.prepared?.compressed),
      uploadedBytes: it.uploadedBytes ?? null,
      mediaId: it.mediaId,
      completedAt: it.completedAt,
    }))
  }

  return { load, start, stop, enqueue, setRecording, setCallConvex, pause, resume, retry: retryFailed, remove, status, list }
}

module.exports = { createUploadQueue, mimeFor, writeJsonAtomic, readJson }
