// Pruebas del frente C: subida reanudable, cola y migración. Todo contra
// carpetas temporales y dobles en memoria (ver fakes.cjs). npm run test:cloud

const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ffmpegPath = require('ffmpeg-static')

const { uploadFile, sha256File } = require('../../electron/cloud/upload-file.cjs')
const { createUploadQueue } = require('../../electron/cloud/upload-queue.cjs')
const { planMigration, runMigration } = require('../../electron/cloud/upload-migrate.cjs')
const { startFakeR2, createFakeConvex } = require('./fakes.cjs')

const MB = 1024 * 1024
const FAST = { baseDelayMs: 5, maxDelayMs: 20 }

const createdDirs = []
async function tmpDir() {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'ct-cloud-test-'))
  createdDirs.push(d)
  return d
}
test.after(async () => {
  for (const d of createdDirs) await fsp.rm(d, { recursive: true, force: true }).catch(() => {})
})

async function randomFile(dir, name, bytes) {
  const p = path.join(dir, name)
  await fsp.mkdir(path.dirname(p), { recursive: true })
  await fsp.writeFile(p, crypto.randomBytes(bytes))
  return p
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

function makeQueue(dir, convex, extra = {}) {
  const events = []
  const q = createUploadQueue({
    storeFile: path.join(dir, 'userData', 'cloud-upload-queue.json'),
    tmpDir: path.join(dir, 'userData', 'cloud-upload-tmp'),
    ffmpegPath,
    callConvex: convex?.callConvex ?? null,
    emit: (e) => events.push(e),
    retry: FAST,
    itemRetryBaseMs: 20,
    itemRetryMaxMs: 50,
    encoder: false,
    ...extra,
  })
  return { q, events }
}

async function until(fn, ms = 15000) {
  const t0 = Date.now()
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('tiempo agotado esperando la condición')
    await new Promise((r) => setTimeout(r, 20))
  }
}

test('sha256 en streaming coincide con el de todo el archivo', async () => {
  const dir = await tmpDir()
  const f = await randomFile(dir, 'a.bin', 3 * MB + 17)
  assert.equal(await sha256File(f), sha(await fsp.readFile(f)))
})

test('subida completa por partes', async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const convex = createFakeConvex(r2)
  const dir = await tmpDir()
  const f = await randomFile(dir, 'a.webm', Math.round(3.5 * MB))
  const progress = []
  const res = await uploadFile({
    callConvex: convex.callConvex, filePath: f, retry: FAST,
    meta: { interviewLocalId: 'iv1', kind: 'mix', mimeType: 'audio/webm', localRelPath: 'P/a.webm' },
    onProgress: (p) => progress.push(p),
  })
  assert.equal(res.alreadyUploaded, false)
  assert.equal(convex.media.get(res.mediaId).uploadStatus, 'done')
  assert.equal(r2.stats.okPuts, 4)
  assert.equal(convex.calls.filter((c) => c.path === 'media:completePart').length, 4)
  assert.equal(progress.at(-1).bytesDone, progress.at(-1).bytesTotal)
})

test('reanuda tras cortar a mitad: solo sube las partes que faltan', async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const convex = createFakeConvex(r2)
  const dir = await tmpDir()
  const f = await randomFile(dir, 'b.webm', 5 * MB)
  const meta = { interviewLocalId: 'iv2', kind: 'video', mimeType: 'video/webm', localRelPath: 'P/b.webm' }
  // Se "cierra la app" justo antes de la tercera parte.
  const ctrl = new AbortController()
  let calls = 0
  const beforePart = () => { if (++calls === 3) ctrl.abort() }
  await assert.rejects(uploadFile({ callConvex: convex.callConvex, filePath: f, meta, signal: ctrl.signal, beforePart, retry: FAST }), { name: 'AbortError' })
  const before = r2.stats.okPuts
  assert.equal(before, 2)
  const res = await uploadFile({ callConvex: convex.callConvex, filePath: f, meta, retry: FAST })
  assert.equal(r2.stats.okPuts - before, 3, 'la segunda vez solo se suben las partes 3, 4 y 5')
  assert.equal(convex.media.size, 1, 'se reutiliza la misma subida del servidor')
  assert.equal(convex.media.get(res.mediaId).uploadStatus, 'done')
})

test('deduplicado por sha256: lo que ya está arriba no se vuelve a subir', async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const convex = createFakeConvex(r2)
  const dir = await tmpDir()
  const f = await randomFile(dir, 'c.mp3', 2 * MB)
  const meta = { interviewLocalId: 'iv3', kind: 'mix', mimeType: 'audio/mpeg', localRelPath: 'c.mp3' }
  await uploadFile({ callConvex: convex.callConvex, filePath: f, meta, retry: FAST })
  const puts = r2.stats.puts
  const again = await uploadFile({ callConvex: convex.callConvex, filePath: f, meta, retry: FAST })
  assert.equal(again.alreadyUploaded, true)
  assert.equal(r2.stats.puts, puts)
})

test('reintenta ante un 500 de R2 y ante una firma caducada (403)', async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const convex = createFakeConvex(r2)
  const dir = await tmpDir()
  const f = await randomFile(dir, 'd.webm', 2 * MB)
  r2.failNext(500, 500, 403)
  const res = await uploadFile({
    callConvex: convex.callConvex, filePath: f, retry: FAST,
    meta: { interviewLocalId: 'iv4', kind: 'mix', mimeType: 'audio/webm', localRelPath: 'd.webm' },
  })
  assert.equal(convex.media.get(res.mediaId).uploadStatus, 'done')
  assert.equal(r2.stats.puts, 5)
  assert.ok(convex.calls.filter((c) => c.path === 'media:signParts').length >= 2, 'refirma tras el 403')
})

test('un 400 de R2 no se reintenta sin fin', async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const convex = createFakeConvex(r2)
  const dir = await tmpDir()
  const f = await randomFile(dir, 'e.webm', 1 * MB)
  r2.failNext(400)
  await assert.rejects(uploadFile({
    callConvex: convex.callConvex, filePath: f, retry: FAST,
    meta: { interviewLocalId: 'iv5', kind: 'mix', mimeType: 'audio/webm', localRelPath: 'e.webm' },
  }), (err) => err.retryable === false)
})

test('la cola sobrevive a un reinicio a mitad de un archivo', async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const convex = createFakeConvex(r2)
  const dir = await tmpDir()
  const files = [
    await randomFile(dir, 'rec/P1/ana_x_iv10.webm', 3 * MB),
    await randomFile(dir, 'rec/P1/ana_x_iv10_video.webm', 6 * MB),
    await randomFile(dir, 'rec/P2/bea_x_iv11.mp3', 1 * MB),
  ]
  const first = makeQueue(dir, convex)
  await first.q.load()
  await first.q.enqueue([
    { filePath: files[0], interviewLocalId: 'iv10', kind: 'mix', localRelPath: 'P1/ana_x_iv10.webm' },
    { filePath: files[1], interviewLocalId: 'iv10', kind: 'video', localRelPath: 'P1/ana_x_iv10_video.webm' },
    { filePath: files[2], interviewLocalId: 'iv11', kind: 'mix', localRelPath: 'P2/bea_x_iv11.mp3' },
  ])
  // "Se cierra la app" en mitad del vídeo (que va el último: primero el audio).
  let stopping = null
  r2.setOnPut(({ mediaId, partNumber }) => {
    if (convex.media.get(mediaId)?.kind === 'video' && partNumber === 3 && !stopping) stopping = first.q.stop()
  })
  first.q.start()
  await until(() => stopping !== null)
  await stopping
  r2.setOnPut(null)
  const putsBefore = r2.stats.okPuts
  assert.equal(first.q.list().filter((i) => i.status === 'done').length, 2)

  const second = makeQueue(dir, convex)
  await second.q.load()
  const pend = second.q.list().filter((i) => i.status === 'pending')
  assert.equal(pend.length, 1)
  assert.equal(pend[0].kind, 'video')
  second.q.start()
  await until(() => second.q.status().state === 'idle' && second.q.list().every((i) => i.status === 'done'))
  await second.q.stop()
  // La parte 3 llegó a R2 justo cuando se cerró: según quién gane la carrera se
  // apuntó en Convex o no. Lo que nunca puede pasar es empezar de cero.
  const diff = r2.stats.okPuts - putsBefore
  assert.ok(diff === 3 || diff === 4, `el vídeo sigue desde la parte 3 o 4 de 6 (subió ${diff})`)
  assert.equal([...convex.media.values()].filter((m) => m.kind === 'video').length, 1)
  const ev = second.events.at(-1)
  assert.equal(ev.batch.total, 3)
  assert.equal(ev.batch.done, 3)
  assert.equal(ev.percent, 100)
})

test('sin sesión espera; grabando se pausa; al acabar sigue', async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const convex = createFakeConvex(r2)
  const dir = await tmpDir()
  const f = await randomFile(dir, 'rec/a_x_iv20.webm', 4 * MB)
  const { q, events } = makeQueue(dir, null)
  await q.load()
  q.start()
  await q.enqueue([{ filePath: f, interviewLocalId: 'iv20', kind: 'mix', localRelPath: 'a_x_iv20.webm' }])
  assert.equal(q.status().pausedBy, 'no-session')

  q.setRecording(true)
  q.setCallConvex(convex.callConvex)
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(r2.stats.puts, 0, 'nada sube mientras se graba')
  assert.equal(q.status().pausedBy, 'recording')
  assert.equal(q.status().state, 'paused')

  q.setRecording(false)
  await until(() => q.list()[0].status === 'done')
  await q.stop()
  assert.ok(events.some((e) => e.current?.phase === 'uploading'))
})

test('grabar a mitad de una subida la deja esperando entre partes', async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const convex = createFakeConvex(r2)
  const dir = await tmpDir()
  const f = await randomFile(dir, 'rec/a_x_iv21_video.webm', 5 * MB)
  const { q } = makeQueue(dir, convex)
  await q.load()
  r2.setOnPut(({ partNumber }) => { if (partNumber === 2) q.setRecording(true) })
  q.start()
  await q.enqueue([{ filePath: f, interviewLocalId: 'iv21', kind: 'video', localRelPath: 'a_x_iv21_video.webm' }])
  await until(() => q.status().pausedBy === 'recording' && r2.stats.okPuts === 2)
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(r2.stats.okPuts, 2)
  r2.setOnPut(null)
  q.setRecording(false)
  await until(() => q.list()[0].status === 'done')
  await q.stop()
  assert.equal(r2.stats.okPuts, 5)
})

test('si la entrevista aún no está en Convex, reintenta más tarde', async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const known = new Set()
  const convex = createFakeConvex(r2, { knownInterviews: known })
  const dir = await tmpDir()
  const f = await randomFile(dir, 'x_iv30.webm', 1 * MB)
  const { q } = makeQueue(dir, convex)
  await q.load()
  q.start()
  await q.enqueue([{ filePath: f, interviewLocalId: 'iv30', kind: 'mix', localRelPath: 'x_iv30.webm' }])
  await until(() => q.list()[0].attempts >= 1)
  assert.equal(q.list()[0].status, 'pending')
  known.add('iv30') // el frente B la sincroniza
  await until(() => q.list()[0].status === 'done')
  await q.stop()
})

test('sin R2 configurado en la nube: error claro, sin reintentos solos', async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const convex = createFakeConvex(r2, { storageConfigured: false })
  const dir = await tmpDir()
  const f = await randomFile(dir, 'z_iv32.webm', 1 * MB)
  const { q } = makeQueue(dir, convex)
  await q.load()
  q.start()
  await q.enqueue([{ filePath: f, interviewLocalId: 'iv32', kind: 'mix', localRelPath: 'z_iv32.webm' }])
  await until(() => q.list()[0].status === 'error')
  assert.equal(q.list()[0].errorCode, 'storage-not-configured')
  assert.equal(q.list()[0].attempts, 1)
  assert.equal(q.status().storageNotConfigured, true)
  await q.stop()
})

test('un archivo que ya no existe queda en error sin reintentos', async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const convex = createFakeConvex(r2)
  const dir = await tmpDir()
  const f = await randomFile(dir, 'y_iv31.webm', 1 * MB)
  const { q } = makeQueue(dir, null)
  await q.load()
  q.start()
  await q.enqueue([{ filePath: f, interviewLocalId: 'iv31', kind: 'mix' }])
  await fsp.rm(f)
  q.setCallConvex(convex.callConvex)
  await until(() => q.list()[0].status === 'error')
  assert.equal(q.list()[0].errorCode, 'missing-file')
  await q.stop()
})

test('migración: plan con huérfanos, duplicados y externos, y ejecución sin tocar nada', async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const dir = await tmpDir()
  const root = path.join(dir, 'Documentos', 'CallTranscriber')
  const id1 = 'aaaaaaaa-1111-4111-8111-111111111111'
  const id2 = 'bbbbbbbb-2222-4222-8222-222222222222'
  const idGone = 'cccccccc-3333-4333-8333-333333333333'
  const f = {
    mix1: await randomFile(root, `Ventas/Ana_Lopez_2026-10-01T10-00-00-000Z_${id1}.mp3`, 1 * MB),
    mix1old: await randomFile(root, `Ventas/Ana_Lopez_2026-10-01T10-00-00-000Z_${id1}.webm`, 2 * MB),
    sys1: await randomFile(root, `Ventas/Ana_Lopez_2026-10-01T10-00-00-000Z_${id1}_system.webm`, 1 * MB),
    vid1: await randomFile(root, `Ventas/Ana_Lopez_2026-10-01T10-00-00-000Z_${id1}_video.webm`, 3 * MB),
    mix2: await randomFile(root, `Bea_2026-09-01T09-00-00-000Z_${id2}.webm`, 1 * MB), // suelto, de antes de las carpetas
    gone: await randomFile(root, `Ventas/Carla_2026-08-01T09-00-00-000Z_${idGone}.webm`, 1 * MB),
    weird: await randomFile(root, 'Ventas/nota de voz.m4a', 1 * MB),
    leftover: await randomFile(root, `Ventas/Ana_${id1}_video.fixed.webm`, 1 * MB),
    notMedia: await randomFile(root, 'Ventas/informe.pdf', 1000),
    ext: await randomFile(dir, 'Descargas/importada.wav', 1 * MB),
  }
  const data = {
    projects: [{ id: 'p1', name: 'Ventas' }],
    candidates: [{ id: 'c1', projectId: 'p1', name: 'Ana López' }, { id: 'c2', projectId: 'p1', name: 'Bea' }],
    interviews: [
      { id: id1, candidateId: 'c1', createdAt: '2026-10-01T10:00:00.000Z', durationSec: 1800, recordingFilePath: f.mix1, systemAudioFilePath: f.sys1, videoFilePath: f.vid1 },
      { id: id2, candidateId: 'c2', createdAt: '2026-09-01T09:00:00.000Z', durationSec: 600, recordingFilePath: path.join(dir, 'otro-pc', 'x.webm'), systemAudioFilePath: f.ext, videoFilePath: path.join(dir, 'otro-pc', 'v.webm') },
    ],
  }
  const dataFile = path.join(dir, 'userData', 'call-transcriber-datos.json')
  await fsp.mkdir(path.dirname(dataFile), { recursive: true })
  await fsp.writeFile(dataFile, JSON.stringify(data))
  const snapshot = async () => {
    const out = {}
    for (const p of [dataFile, ...Object.values(f)]) {
      const st = await fsp.stat(p)
      out[p] = `${st.size}:${st.mtimeMs}:${sha(await fsp.readFile(p))}`
    }
    return out
  }
  const before = await snapshot()

  const plan = await planMigration({ data: JSON.parse(await fsp.readFile(dataFile, 'utf-8')), root })
  const rel = (it) => it.localRelPath
  assert.deepEqual(plan.items.map(rel).sort(), [
    `Bea_2026-09-01T09-00-00-000Z_${id2}.webm`,
    `Ventas/Ana_Lopez_2026-10-01T10-00-00-000Z_${id1}.mp3`,
    `Ventas/Ana_Lopez_2026-10-01T10-00-00-000Z_${id1}_system.webm`,
    `Ventas/Ana_Lopez_2026-10-01T10-00-00-000Z_${id1}_video.webm`,
  ])
  assert.deepEqual(plan.items.map((i) => i.kind).sort(), ['mix', 'mix', 'system', 'video'])
  assert.equal(plan.items.find((i) => i.kind === 'video').projectName, 'Ventas')
  const orphanReasons = Object.fromEntries(plan.orphans.map((o) => [path.basename(o.filePath), o.reason]))
  assert.deepEqual(orphanReasons, {
    [path.basename(f.mix1old)]: 'duplicate',
    [path.basename(f.gone)]: 'no-interview',
    'nota de voz.m4a': 'unrecognized-name',
  })
  assert.equal(plan.external.length, 1)
  assert.equal(plan.external[0].kind, 'system')
  assert.equal(plan.totals.missing, 1)
  assert.equal(plan.totals.files, 4)
  assert.equal(plan.totals.bytes, 6 * MB)
  assert.equal(plan.totals.byKind.video.bytes, 3 * MB)

  const convex = createFakeConvex(r2)
  const { q } = makeQueue(dir, convex)
  await q.load()
  q.start()
  const r = await runMigration(q, plan)
  assert.equal(r.added, 4)
  await until(() => q.list().every((i) => i.status === 'done'))
  // Repetir la migración no vuelve a meter nada.
  assert.equal((await runMigration(q, plan)).added, 0)
  await q.stop()
  const started = convex.calls.filter((c) => c.path === 'media:startUpload').map((c) => c.args.localRelPath).sort()
  assert.deepEqual(started, plan.items.map(rel).sort())
  assert.deepEqual(await snapshot(), before, 'ni el json ni las grabaciones cambian')
})

const hasFfmpeg = fs.existsSync(ffmpegPath)

test('vídeo pesado: se comprime a un temporal, sube el mp4 y el original no se toca', { skip: !hasFfmpeg }, async (t) => {
  const r2 = await startFakeR2(); t.after(r2.close)
  const convex = createFakeConvex(r2)
  const dir = await tmpDir()
  const input = path.join(dir, 'rec', 'Ana_x_iv40_video.webm')
  await fsp.mkdir(path.dirname(input), { recursive: true })
  // 4 s de 1080p a 6 Mbit/s: unos 2,7 GB/hora, muy por encima del umbral.
  const gen = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-f', 'lavfi', '-i', 'sine=f=440',
    '-t', '4', '-c:v', 'libvpx', '-b:v', '6M', '-minrate', '6M', '-maxrate', '6M', '-deadline', 'realtime', '-cpu-used', '8',
    '-c:a', 'libopus', input])
  assert.equal(gen.status, 0, String(gen.stderr))
  const original = sha(await fsp.readFile(input))
  const { q } = makeQueue(dir, convex, { encoder: undefined })
  await q.load()
  q.start()
  await q.enqueue([{ filePath: input, interviewLocalId: 'iv40', kind: 'video', localRelPath: 'Ana_x_iv40_video.webm' }])
  await until(() => q.list()[0].status !== 'pending' && q.list()[0].status !== 'working', 60000)
  await q.stop()
  const item = q.list()[0]
  assert.equal(item.status, 'done', item.lastError)
  const m = [...convex.media.values()][0]
  assert.equal(m.mimeType, 'video/mp4')
  assert.ok(m.bytes < (await fsp.stat(input)).size * 0.85)
  assert.equal(m.localRelPath, 'Ana_x_iv40_video.webm', 'la ruta local es la del original')
  assert.equal(sha(await fsp.readFile(input)), original, 'el original no cambia')
  assert.deepEqual(await fsp.readdir(path.join(dir, 'userData', 'cloud-upload-tmp')), [], 'el temporal se borra')
})
