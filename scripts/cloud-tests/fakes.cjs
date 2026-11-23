// Dobles de prueba para la subida a la nube: un "R2" local que acepta los PUT de
// partes como S3 (y devuelve ETag) y un `callConvex` en memoria que imita las
// funciones `media.*` del contrato. Sin red, sin cuentas y sin datos reales.

const http = require('node:http')
const crypto = require('node:crypto')
const { MEDIA_FN } = require('../../electron/cloud/upload-file.cjs')
const { CloudError } = require('../../electron/cloud/convex-http.cjs')

async function startFakeR2() {
  const parts = new Map() // `${mediaId}/${n}` → Buffer
  const failures = [] // estados que devolverán los próximos PUT
  const stats = { puts: 0, okPuts: 0 }
  let onPut = null

  const server = http.createServer((req, res) => {
    const m = req.url.match(/^\/part\/([^/]+)\/(\d+)\?sig=/)
    if (req.method !== 'PUT' || !m) { res.writeHead(404); res.end(); return }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      stats.puts++
      const fail = failures.shift()
      if (fail) { res.writeHead(fail, { 'Content-Type': 'text/plain' }); res.end('fallo de prueba'); return }
      const body = Buffer.concat(chunks)
      parts.set(`${m[1]}/${m[2]}`, body)
      stats.okPuts++
      const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`
      res.writeHead(200, { ETag: etag })
      res.end()
      onPut?.({ mediaId: m[1], partNumber: Number(m[2]) })
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base,
    parts,
    stats,
    failNext: (...statuses) => failures.push(...statuses),
    setOnPut: (fn) => { onPut = fn },
    close: () => new Promise((r) => server.close(r)),
  }
}

/** `callConvex` falso. `knownInterviews` = las que ya "se han sincronizado". */
function createFakeConvex(r2, { partSize = 1024 * 1024, knownInterviews = null, storageConfigured = true } = {}) {
  const media = new Map()
  const calls = []
  let next = 1

  const fns = {
    'media:startUpload': (a) => {
      for (const k of ['interviewLocalId', 'kind', 'mimeType', 'bytes', 'sha256', 'localRelPath']) {
        if (a[k] === undefined || a[k] === null || a[k] === '') throw new Error(`falta ${k}`)
      }
      // Igual que el Convex de verdad: un ConvexError llega por HTTP 560 con su
      // `code`, y convex-http.cjs lo marca como no repetible por sí mismo.
      if (!storageConfigured) {
        throw new CloudError('Falta configurar el almacenamiento en la nube (R2_BUCKET en el despliegue).', { code: 'storage_not_configured', status: 560 })
      }
      if (knownInterviews && !knownInterviews.has(a.interviewLocalId)) {
        throw new CloudError('Esa llamada todavía no está en la nube: sincronízala primero.', { code: 'not_found', status: 560 })
      }
      const done = [...media.values()].find((m) => m.sha256 === a.sha256 && m.uploadStatus === 'done')
      if (done) return { mediaId: done.id, alreadyUploaded: true, partSize: done.partSize, partsDone: done.partsDone }
      const open = [...media.values()].find((m) => m.sha256 === a.sha256 && m.uploadStatus === 'uploading'
        && m.interviewLocalId === a.interviewLocalId && m.kind === a.kind)
      if (open) return { mediaId: open.id, alreadyUploaded: false, partSize: open.partSize, partsDone: open.partsDone }
      const id = `m${next++}`
      media.set(id, { id, ...a, partSize, partsDone: [], uploadStatus: 'uploading' })
      return { mediaId: id, alreadyUploaded: false, partSize, partsDone: [] }
    },
    'media:signParts': ({ mediaId, partNumbers }) => {
      if (!media.has(mediaId)) throw new Error('media no existe')
      return partNumbers.map((n) => ({ partNumber: n, url: `${r2.base}/part/${mediaId}/${n}?sig=${crypto.randomUUID()}` }))
    },
    'media:completePart': ({ mediaId, partNumber, etag }) => {
      const m = media.get(mediaId)
      m.partsDone = m.partsDone.filter((p) => p.partNumber !== partNumber).concat({ partNumber, etag })
      return null
    },
    'media:complete': ({ mediaId }) => {
      const m = media.get(mediaId)
      const total = Math.max(1, Math.ceil(m.bytes / m.partSize))
      const bufs = []
      for (let n = 1; n <= total; n++) {
        const body = r2.parts.get(`${mediaId}/${n}`)
        const rec = m.partsDone.find((p) => p.partNumber === n)
        if (!body || !rec) throw new Error(`falta la parte ${n}`)
        const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`
        if (rec.etag !== etag) throw new Error(`etag de la parte ${n} no cuadra`)
        bufs.push(body)
      }
      const all = Buffer.concat(bufs)
      if (all.length !== m.bytes) throw new Error('tamaño final distinto')
      if (crypto.createHash('sha256').update(all).digest('hex') !== m.sha256) throw new Error('sha256 final distinto')
      m.uploadStatus = 'done'
      return null
    },
    'media:abort': ({ mediaId }) => { const m = media.get(mediaId); if (m) m.uploadStatus = 'aborted'; return null },
  }

  async function callConvex(kind, fnPath, args) {
    calls.push({ kind, path: fnPath, args })
    const name = fnPath.split(':')[1]
    // Igual que la API HTTP de Convex: llamar a una acción como mutación falla.
    if (MEDIA_FN[name] !== kind) throw new Error(`${fnPath} no es ${kind}`)
    const fn = fns[fnPath]
    if (!fn) throw new Error(`función desconocida ${fnPath}`)
    await new Promise((r) => setImmediate(r))
    return JSON.parse(JSON.stringify(fn(args) ?? null))
  }

  return { callConvex, media, calls }
}

module.exports = { startFakeR2, createFakeConvex }
