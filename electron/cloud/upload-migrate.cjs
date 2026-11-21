// ── Migración de las grabaciones antiguas a la nube ──────────────────────────
//
// Hay cientos de grabaciones hechas antes de que existiera la nube. Este módulo
// las relaciona con su entrevista y las mete en la cola de subidas, en dos pasos:
// primero un PLAN (qué se subiría, cuánto pesa, qué no se sabe de quién es) que
// se enseña al usuario, y solo con su visto bueno se ejecuta.
//
// Solo lee. No cambia nombres, ni carpetas, ni call-transcriber-datos.json: el
// vínculo con el CRM y las rutas que ya guarda cada entrevista siguen igual. La
// nube recibe la ruta relativa (`localRelPath`) para poder rehacer la misma
// estructura de carpetas en otro PC.
//
// Cómo se sabe de qué entrevista es cada archivo: el nombre lo lleva desde
// siempre (ver `recordingsDirFor` y `STREAM_SUFFIX` en main.cjs):
//
//     <candidato>_<fecha>_<interviewId>[_system|_video].<ext>
//
// y además la entrevista guarda la ruta de sus archivos. Se mira primero la ruta
// guardada y, si no cuadra, el id del nombre. Lo que no se puede atar a ninguna
// entrevista que exista va a "huérfanos": no se sube, decide el usuario.

const path = require('node:path')
const fsp = require('node:fs/promises')

const MEDIA_EXT = new Set(['webm', 'mp3', 'wav', 'm4a', 'ogg', 'opus', 'mp4', 'mkv', 'flac', 'aac', 'wma'])
const KIND_BY_SUFFIX = { _system: 'system', _video: 'video' }
const PATH_FIELD = { mix: 'recordingFilePath', system: 'systemAudioFilePath', video: 'videoFilePath' }

// Restos de un reempaquetado o una conversión cortados a medias (ver
// writeDurationHeader y recording:convert en main.cjs): no son grabaciones.
const isLeftover = (name) => /\.(fixed|partial)\.[^.]+$/i.test(name) || /\.tmp$/i.test(name)

const norm = (p) => path.resolve(String(p)).toLowerCase()
const toRel = (root, file) => path.relative(root, file).split(path.sep).join('/')

async function walk(dir, out = []) {
  let entries
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walk(full, out)
    else if (e.isFile()) out.push(full)
  }
  return out
}

/** Separa `<...>_<id>[_system|_video]` del nombre sin extensión. */
function parseName(fileName) {
  const ext = path.extname(fileName).slice(1).toLowerCase()
  let stem = fileName.slice(0, fileName.length - (ext ? ext.length + 1 : 0))
  let kind = 'mix'
  for (const [suffix, k] of Object.entries(KIND_BY_SUFFIX)) {
    if (stem.toLowerCase().endsWith(suffix)) { kind = k; stem = stem.slice(0, -suffix.length); break }
  }
  const i = stem.lastIndexOf('_')
  return { ext, kind, interviewId: i >= 0 ? stem.slice(i + 1) : null }
}

/**
 * Calcula el plan sin tocar nada.
 * data: el contenido de call-transcriber-datos.json ({ projects, candidates, interviews }).
 * root: la carpeta Documentos\CallTranscriber.
 */
async function planMigration({ data, root }) {
  const interviews = Array.isArray(data?.interviews) ? data.interviews : []
  const candidates = new Map((data?.candidates || []).map((c) => [c.id, c]))
  const projects = new Map((data?.projects || []).map((p) => [p.id, p]))
  const byId = new Map(interviews.map((iv) => [String(iv.id), iv]))

  // Ruta guardada en la entrevista → { interview, kind }
  const byStoredPath = new Map()
  for (const iv of interviews) {
    for (const [kind, field] of Object.entries(PATH_FIELD)) {
      if (iv[field]) byStoredPath.set(norm(iv[field]), { iv, kind })
    }
  }

  const describe = (iv) => {
    const cand = candidates.get(iv.candidateId)
    const proj = cand ? projects.get(cand.projectId) : null
    return { candidateName: cand?.name ?? '', projectName: proj?.name ?? '', createdAt: iv.createdAt ?? null }
  }

  const files = (await walk(root)).filter((f) => {
    const name = path.basename(f)
    return MEDIA_EXT.has(path.extname(name).slice(1).toLowerCase()) && !isLeftover(name)
  })

  const groups = new Map() // `${id}:${kind}` → [{...}]
  const orphans = []
  const seen = new Set()

  for (const filePath of files) {
    const st = await fsp.stat(filePath).catch(() => null)
    if (!st) continue
    seen.add(norm(filePath))
    const name = path.basename(filePath)
    const parsed = parseName(name)
    const stored = byStoredPath.get(norm(filePath))
    const iv = stored?.iv || (parsed.interviewId ? byId.get(parsed.interviewId) : null)
    const kind = stored?.kind || parsed.kind
    const localRelPath = toRel(root, filePath)
    if (!iv) {
      orphans.push({
        filePath,
        localRelPath,
        bytes: st.size,
        reason: parsed.interviewId && /^[0-9a-f-]{20,}$/i.test(parsed.interviewId) ? 'no-interview' : 'unrecognized-name',
        interviewLocalId: parsed.interviewId,
      })
      continue
    }
    const key = `${iv.id}:${kind}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ filePath, localRelPath, bytes: st.size, mtimeMs: st.mtimeMs, iv, kind, isStored: !!stored })
  }

  // Una entrevista tiene un archivo por tipo en la nube. Si hay dos (un .webm que
  // no llegó a borrarse tras pasar a .mp3, por ejemplo), gana el que la entrevista
  // tiene enlazado; si ninguno, el más reciente. El resto se enseña como huérfano.
  const items = []
  for (const list of groups.values()) {
    list.sort((a, b) => (b.isStored - a.isStored) || (b.mtimeMs - a.mtimeMs))
    const [best, ...rest] = list
    items.push({
      filePath: best.filePath,
      localRelPath: best.localRelPath,
      bytes: best.bytes,
      kind: best.kind,
      interviewLocalId: String(best.iv.id),
      durationSec: Number(best.iv.durationSec) > 0 ? Number(best.iv.durationSec) : null,
      ...describe(best.iv),
    })
    for (const r of rest) {
      orphans.push({ filePath: r.filePath, localRelPath: r.localRelPath, bytes: r.bytes, reason: 'duplicate', interviewLocalId: String(r.iv.id) })
    }
  }

  // Archivos que una entrevista tiene enlazados pero viven fuera de la carpeta de
  // grabaciones (un audio importado desde Descargas, por ejemplo). No tienen sitio
  // en la estructura de carpetas, así que no entran solos: el usuario decide.
  const external = []
  const missing = []
  const covered = new Set(items.map((it) => `${it.interviewLocalId}:${it.kind}`))
  for (const iv of interviews) {
    for (const [kind, field] of Object.entries(PATH_FIELD)) {
      const p = iv[field]
      if (!p || seen.has(norm(p)) || covered.has(`${iv.id}:${kind}`)) continue
      const st = await fsp.stat(p).catch(() => null)
      if (!st?.isFile()) { missing.push({ interviewLocalId: String(iv.id), kind, filePath: p }); continue }
      external.push({
        filePath: p,
        localRelPath: `_importados/${path.basename(p)}`,
        bytes: st.size,
        kind,
        interviewLocalId: String(iv.id),
        durationSec: Number(iv.durationSec) > 0 ? Number(iv.durationSec) : null,
        ...describe(iv),
      })
    }
  }

  const sum = (list) => ({ files: list.length, bytes: list.reduce((s, x) => s + x.bytes, 0) })
  const byKind = {}
  for (const k of ['mix', 'system', 'video']) byKind[k] = sum(items.filter((it) => it.kind === k))
  items.sort((a, b) => String(a.localRelPath).localeCompare(String(b.localRelPath)))

  return {
    root,
    createdAt: Date.now(),
    items,
    orphans,
    external,
    missing,
    totals: { ...sum(items), byKind, orphans: sum(orphans), external: sum(external), missing: missing.length },
  }
}

/** Mete el plan en la cola. Devuelve lo que diga `queue.enqueue`. */
async function runMigration(queue, plan, { includeExternal = false } = {}) {
  const list = includeExternal ? [...plan.items, ...plan.external] : plan.items
  return queue.enqueue(list.map((it) => ({
    filePath: it.filePath,
    interviewLocalId: it.interviewLocalId,
    kind: it.kind,
    localRelPath: it.localRelPath,
    durationSec: it.durationSec,
  })))
}

module.exports = { planMigration, runMigration, parseName }
