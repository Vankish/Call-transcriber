// Prueba de punta a punta de la sesión y la sincronización contra un Convex de
// verdad, pero LOCAL y anónimo (nunca uno con cuenta). No entra en
// `npm run test:cloud` porque necesita el despliegue levantado:
//
//   CONVEX_AGENT_MODE=anonymous npx convex dev          (en otra terminal)
//   npx convex env set SITE_URL http://localhost:5173
//   npx convex env set JWT_PRIVATE_KEY -- "<clave de prueba>"   (ver docs de Convex Auth)
//   npx convex env set JWKS -- "<jwks de prueba>"
//   CONVEX_E2E_URL=http://127.0.0.1:3210 node scripts/cloud-tests/e2e-local.cjs
//
// Crea una cuenta inventada con correo y contraseña, sube datos inventados y
// comprueba con `sync.pull` que llegaron con el formato del esquema.

const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fsp = require('node:fs/promises')
const { createConvexHttp } = require('../../electron/cloud/convex-http.cjs')
const { createCloudSession } = require('../../electron/cloud/session.cjs')
const { createCloudSync } = require('../../electron/cloud/sync.cjs')

const url = process.env.CONVEX_E2E_URL || 'http://127.0.0.1:3210'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Solo contra un despliegue local: CONVEX_E2E_URL tiene que ser http://127.0.0.1:...')
  process.exit(1)
}

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, 'utf-8'),
  decryptString: (b) => Buffer.from(b).toString('utf-8'),
}

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ct-e2e-'))
  try {
    const http = createConvexHttp({ url })
    const session = createCloudSession({ http, storeFile: path.join(dir, 'cloud-session.bin'), safeStorage: fakeSafeStorage })
    const email = `prueba-${Date.now()}@ejemplo.test`
    const st = await session.signInWithPassword({ email, password: 'una-clave-de-prueba', flow: 'signUp', name: 'Persona de prueba' })
    assert.equal(st.state, 'signed-in')
    assert.ok(st.workspaceId)
    assert.equal(st.email, email)
    console.log('✓ registro con correo y contraseña, espacio', st.workspaceId)

    // Entrar otra vez con la misma cuenta (flujo signIn) y con una contraseña mala.
    await session.signOut()
    await assert.rejects(session.signInWithPassword({ email, password: 'mala-mala-mala', flow: 'signIn' }))
    console.log('✓ contraseña mala rechazada:', session.status().error)
    assert.equal(session.status().error, 'invalid-credentials')
    // Los fallos de contraseña llegan con `code` (convex/auth.ts) y no por el texto.
    await assert.rejects(session.signInWithPassword({ email, password: 'otra-clave-cualquiera', flow: 'signUp' }))
    assert.equal(session.status().error, 'account-exists')
    await assert.rejects(session.signInWithPassword({ email: `corta-${Date.now()}@ejemplo.test`, password: 'corta', flow: 'signUp' }))
    assert.equal(session.status().error, 'weak-password')
    console.log('✓ cuenta repetida y contraseña corta, con su código')
    const again = await session.signInWithPassword({ email, password: 'una-clave-de-prueba', flow: 'signIn' })
    assert.equal(again.workspaceId, st.workspaceId, 'ensureMine devuelve el mismo espacio')
    console.log('✓ entrar de nuevo: mismo espacio')

    const ISO = '2026-11-01T10:00:00.000Z'
    const data = {
      projects: [{ id: 'p1', ownerId: 'local', name: 'Ventas Q4', company: 'Acme', createdAt: ISO, status: 'active', evaluationCriteria: ['idiomas'], interviewers: ['Ana'], kind: 'clientes' }],
      candidates: [{ id: 'c1', projectId: 'p1', createdAt: ISO, name: 'Persona Inventada', email: 'x@ejemplo.test', phone: '', role: 'CEO', notes: '', candidateStatus: 'pendiente', consentGiven: true, consentAt: ISO, crm: { dealId: 'd1', company: 'Acme', contactEmail: 'x@ejemplo.test', linkedinUrl: '', stage: 'interesado', lastSentAt: null, spinSituation: '', spinProblem: '', spinImplication: '', spinNeedPayoff: '', singleSalesObjective: '', nextStep: '', nota: '' } }],
      interviews: Array.from({ length: 120 }, (_, i) => ({
        id: `i${i}`, ownerId: 'local', candidateId: 'c1', createdAt: ISO, sessionName: `Llamada ${i}`, status: 'stopped', durationSec: 60 + i,
        micDeviceId: 'mic', outputDeviceId: 'out', transcriptOriginal: i < 2 ? `Hola ${i}` : '', transcriptEdited: '', transcriptUpdatedAt: null,
        recordingUrl: null, recordingFilePath: `C:\\falso\\i${i}.webm`, videoFilePath: null, systemAudioFilePath: null, captureSource: 'mic+system',
        transcriptionStatus: 'done', summaryInstructions: '', summaryText: 'resumen', summaryStatus: 'done', summaryType: 'resumen',
        summaryContext: 'reunion', interviewerName: 'Ana', audioUploaded: false,
      })),
    }
    const box = { data }
    const enqueued = []
    const sync = createCloudSync({
      storeFile: path.join(dir, 'cloud-sync-state.json'),
      readData: async () => box.data,
      enqueueMedia: async (e) => { enqueued.push(...e); return { added: e.length, updated: 0, skipped: 0 } },
    })
    await sync.setSession(session.callConvex, `${url}#${st.workspaceId}`)
    const r = await sync.runNow()
    assert.equal(r.ok, true, String(r.error?.message))
    console.log('✓ sincronizado:', r.pushed, 'filas')

    let since = 0
    const all = { projects: [], candidates: [], interviews: [], transcripts: [] }
    for (;;) {
      const page = await session.callConvex('query', 'sync:pull', { since })
      for (const k of Object.keys(all)) all[k].push(...page[k])
      if (!page.hasMore) break
      since = page.until
    }
    assert.equal(all.projects.length, 1)
    assert.equal(all.projects[0].kind, 'clientes')
    assert.equal(all.candidates[0].projectLocalId, 'p1')
    assert.equal(all.candidates[0].crm.stage, 'interesado')
    assert.equal(new Set(all.interviews.map((x) => x.localId)).size, 120)
    assert.equal(all.interviews[0].createdAt, Date.parse(ISO))
    assert.equal(all.transcripts.length, 2)
    console.log('✓ sync.pull devuelve lo subido (1 carpeta, 1 perfil, 120 llamadas, 2 transcripciones)')

    box.data = { ...data, interviews: data.interviews.slice(1) }
    const r2 = await sync.runNow()
    assert.equal(r2.ok, true)
    const after = await session.callConvex('query', 'sync:pull', { since: 0 })
    const i0 = after.interviews.find((x) => x.localId === 'i0')
    assert.ok(i0 && i0.deletedAt, 'la llamada borrada en local queda borrada arriba')
    console.log('✓ borrado propagado')

    // Subida sin R2 (aquí no hay cuenta): Convex responde con un error de
    // almacenamiento y la cola tiene que esperar y reintentar, no rendirse.
    // Una llamada que aún no está arriba (i999) tampoco es un fallo definitivo.
    const { createUploadQueue } = require('../../electron/cloud/upload-queue.cjs')
    const audio = path.join(dir, 'grabacion-inventada.webm')
    await fsp.writeFile(audio, Buffer.alloc(64 * 1024, 7))
    const queue = createUploadQueue({
      storeFile: path.join(dir, 'cloud-upload-queue.json'),
      tmpDir: path.join(dir, 'cloud-upload-tmp'),
      ffmpegPath: null,
      callConvex: session.callConvex,
      itemRetryBaseMs: 60_000,
      encoder: false,
    })
    await queue.load()
    queue.start()
    await queue.enqueue([
      { filePath: audio, interviewLocalId: 'i5', kind: 'mix', localRelPath: 'Ventas Q4/grabacion-inventada.webm' },
      { filePath: audio, interviewLocalId: 'i999', kind: 'mix', localRelPath: 'Ventas Q4/otra.webm' },
    ])
    const t0 = Date.now()
    while (queue.list().some((it) => !it.attempts) && Date.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 100))
    for (const it of queue.list()) {
      assert.equal(it.status, 'pending', `${it.interviewLocalId}: ${it.lastError}`)
      assert.ok(it.nextAttemptAt > Date.now())
    }
    await queue.stop()
    console.log('✓ subida sin R2 y llamada sin sincronizar: la cola espera y reintenta')
    for (const it of queue.list()) console.log('   ', it.interviewLocalId, '→', it.lastError)

    // Refresco de verdad: otra instancia lee la sesión guardada con un reloj dos
    // horas adelantado, así que da el JWT por caducado y pide otro con el refreshToken.
    const later = createCloudSession({ http, storeFile: path.join(dir, 'cloud-session.bin'), safeStorage: fakeSafeStorage, now: () => Date.now() + 2 * 3600_000 })
    assert.equal((await later.load()).state, 'signed-in')
    const mine = await later.callConvex('query', 'workspace:mine', {})
    assert.equal(mine.workspaceId, st.workspaceId)
    console.log('✓ refresco del token con el refreshToken')
    // El refreshToken rota: la primera instancia tiene ahora uno viejo, pero su
    // JWT sigue vivo, así que puede cerrar sesión igual.
    await session.signOut()
    console.log('✓ cerrar sesión')
    console.log('\nTodo bien contra', url)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

main().catch((err) => { console.error('✗', err); process.exit(1) })
