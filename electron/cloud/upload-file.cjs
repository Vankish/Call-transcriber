// ── Subida de un archivo a R2, por partes y reanudable ───────────────────────
//
// Los bytes nunca pasan por Convex: Convex solo firma direcciones PUT de R2
// (multipart de S3) y apunta qué partes están ya arriba. Por eso este módulo no
// sabe nada de sesiones ni de tokens: recibe `callConvex(kind, path, args)` ya
// preparado (lo monta la capa de sesión, frente B) y un `fetch`.
//
// Dos cosas que lo explican casi todo:
//  1. Se reanuda desde lo que dice el SERVIDOR (`partsDone`), no desde un estado
//     local. Si la app se cierra a mitad o se sube desde otro PC, la verdad es la
//     de Convex, y `completePart` se llama tras cada parte justo para eso.
//  2. Nunca se carga el archivo entero: el hash va en streaming y cada parte se
//     lee sola (8 MB), así un vídeo de 2 GB ocupa 8 MB de memoria y no 2 GB.

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const crypto = require('node:crypto')

const DEFAULT_PART_SIZE = 8 * 1024 * 1024

// Qué tipo de función de Convex es cada una. El contrato solo dice "acción" de
// signParts; startUpload, complete y abort tienen que hablar con R2 (crear,
// cerrar o cancelar el multipart), y desde Convex eso solo se puede en una
// acción. Si el frente A las deja como mutación con un scheduler por detrás,
// basta con cambiar esta tabla: la API HTTP de Convex no deja llamar a una
// acción por /api/mutation ni al revés.
const MEDIA_FN = {
  startUpload: 'action',
  signParts: 'action',
  completePart: 'mutation',
  complete: 'action',
  abort: 'action',
}

/** sha256 en hex leyendo el archivo a trozos. `onBytes(leidos)` para el progreso. */
function sha256File(filePath, { onBytes, signal } = {}) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    // 1 MB por lectura: con el valor por defecto (64 KB) un vídeo de 2 GB son
    // 32.000 vueltas del bucle de eventos y el hash tarda el doble.
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })
    let read = 0
    const onAbort = () => stream.destroy(abortError())
    if (signal) {
      if (signal.aborted) { onAbort(); return }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    stream.on('data', (chunk) => {
      hash.update(chunk)
      read += chunk.length
      onBytes?.(read)
    })
    stream.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err) })
    stream.on('end', () => { signal?.removeEventListener('abort', onAbort); resolve(hash.digest('hex')) })
  })
}

function abortError() {
  const err = new Error('subida detenida')
  err.name = 'AbortError'
  return err
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(abortError()); return }
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
  const onAbort = () => { clearTimeout(t); reject(abortError()) }
  signal?.addEventListener('abort', onAbort, { once: true })
})

/** Error de subida con la pista de si merece la pena reintentar. */
class UploadError extends Error {
  constructor(message, { retryable = true, status } = {}) {
    super(message)
    this.name = 'UploadError'
    this.retryable = retryable
    this.status = status
  }
}

async function readPart(handle, partNumber, partSize, totalBytes) {
  const start = (partNumber - 1) * partSize
  const length = Math.min(partSize, totalBytes - start)
  const buffer = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset)
    if (!bytesRead) throw new UploadError('el archivo es más corto de lo esperado', { retryable: false })
    offset += bytesRead
  }
  return buffer
}

/**
 * PUT de una parte a su URL firmada. Devuelve el ETag que R2 necesita para
 * cerrar el multipart. Un 403 suele ser una firma caducada (valen 1 hora y una
 * subida lenta de un vídeo grande puede pasar de ahí): se marca para refirmar.
 */
async function putPart(fetchImpl, url, body, signal) {
  let res
  try {
    res = await fetchImpl(url, {
      method: 'PUT',
      body,
      headers: { 'Content-Length': String(body.length) },
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new UploadError(`red: ${err?.message || err}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new UploadError(`R2 respondió ${res.status} ${text.slice(0, 200)}`, {
      retryable: res.status >= 500 || res.status === 429 || res.status === 403 || res.status === 408,
      status: res.status,
    })
    throw err
  }
  // Algunas pasarelas lo devuelven sin comillas; R2 acepta las dos formas, pero
  // se guarda tal cual venga para no cambiar lo que firmó el servidor.
  const etag = res.headers.get('etag')
  if (!etag) throw new UploadError('R2 no devolvió ETag (¿falta exponerlo en CORS?)', { retryable: false })
  await res.arrayBuffer().catch(() => {})
  return etag
}

/**
 * Sube un archivo. `meta` lleva lo que pide `media.startUpload` salvo los bytes
 * y el hash, que se calculan aquí si no vienen ya calculados.
 *
 * onProgress({ phase: 'hashing' | 'uploading' | 'finishing', bytesDone, bytesTotal })
 *
 * Devuelve { mediaId, alreadyUploaded, sha256, bytes }.
 */
async function uploadFile({
  callConvex,
  fetchImpl = globalThis.fetch,
  filePath,
  meta,
  sha256,
  onProgress,
  signal,
  // Puerta que se espera antes de cada parte: la cola la usa para pausar sin
  // cortar una parte a medias (por ejemplo, al empezar una grabación).
  beforePart,
  retry = {},
}) {
  const maxAttempts = retry.maxAttempts ?? 6
  const baseDelayMs = retry.baseDelayMs ?? 1000
  const maxDelayMs = retry.maxDelayMs ?? 60_000

  const stat = await fsp.stat(filePath)
  const bytes = stat.size
  if (!sha256) {
    sha256 = await sha256File(filePath, {
      signal,
      onBytes: (n) => onProgress?.({ phase: 'hashing', bytesDone: n, bytesTotal: bytes }),
    })
  }

  const started = await callConvex(MEDIA_FN.startUpload, 'media:startUpload', { ...meta, bytes, sha256 })
  const { mediaId, alreadyUploaded } = started
  if (alreadyUploaded) {
    onProgress?.({ phase: 'finishing', bytesDone: bytes, bytesTotal: bytes })
    return { mediaId, alreadyUploaded: true, sha256, bytes }
  }

  const partSize = started.partSize || DEFAULT_PART_SIZE
  const totalParts = Math.max(1, Math.ceil(bytes / partSize))
  const done = new Set((started.partsDone || []).map((p) => p.partNumber))
  const partBytes = (n) => Math.min(partSize, bytes - (n - 1) * partSize)
  let bytesDone = [...done].reduce((s, n) => s + partBytes(n), 0)
  onProgress?.({ phase: 'uploading', bytesDone, bytesTotal: bytes })

  const pending = []
  for (let n = 1; n <= totalParts; n++) if (!done.has(n)) pending.push(n)

  const handle = await fsp.open(filePath, 'r')
  try {
    // Se firman de pocas en pocas: una firma vale 1 hora, y firmar las 250
    // partes de un vídeo de 2 GB de golpe haría caducar las últimas por el camino.
    const SIGN_BATCH = 8
    const urls = new Map()
    const sign = async (numbers) => {
      const signed = await callConvex(MEDIA_FN.signParts, 'media:signParts', { mediaId, partNumbers: numbers })
      for (const { partNumber, url } of signed) urls.set(partNumber, url)
    }

    for (let i = 0; i < pending.length; i++) {
      const partNumber = pending[i]
      if (beforePart) await beforePart()
      if (signal?.aborted) throw abortError()
      if (!urls.has(partNumber)) await sign(pending.slice(i, i + SIGN_BATCH))

      const body = await readPart(handle, partNumber, partSize, bytes)
      let etag
      for (let attempt = 1; ; attempt++) {
        try {
          etag = await putPart(fetchImpl, urls.get(partNumber), body, signal)
          break
        } catch (err) {
          if (err?.name === 'AbortError') throw err
          if (!err.retryable || attempt >= maxAttempts) throw err
          // Espera creciente con algo de azar: si se cae la wifi, los reintentos
          // no se amontonan todos en el mismo segundo en que vuelve.
          const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5)
          await sleep(delay, signal)
          if (err.status === 403) await sign([partNumber])
        }
      }
      await callConvex(MEDIA_FN.completePart, 'media:completePart', { mediaId, partNumber, etag })
      bytesDone += body.length
      onProgress?.({ phase: 'uploading', bytesDone, bytesTotal: bytes })
    }
  } finally {
    await handle.close()
  }

  onProgress?.({ phase: 'finishing', bytesDone: bytes, bytesTotal: bytes })
  await callConvex(MEDIA_FN.complete, 'media:complete', { mediaId })
  return { mediaId, alreadyUploaded: false, sha256, bytes }
}

module.exports = { MEDIA_FN, uploadFile, sha256File, UploadError, DEFAULT_PART_SIZE, sleep, abortError }
