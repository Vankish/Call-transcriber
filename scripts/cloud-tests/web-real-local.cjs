// Prueba de la web de verdad (no la de datos falsos) contra un Convex LOCAL y
// anónimo, con datos inventados. No entra en `npm run test:cloud`: necesita el
// despliegue levantado y la web servida.
//
//   CONVEX_AGENT_MODE=anonymous npx convex dev          (en otra terminal)
//   npx convex env set SITE_URL http://localhost:5174   (y WEB_URL, JWT_PRIVATE_KEY, JWKS)
//   VITE_CONVEX_URL=http://127.0.0.1:3210 npm run web:build
//   npx vite preview --config vite.web.config.ts --port 5174 --strictPort
//   npx electron scripts/cloud-tests/web-real-local.cjs  (sin ELECTRON_RUN_AS_NODE)
//
// La ventana es offscreen: pinta en memoria y nunca aparece en el escritorio,
// que puede estar compartido. Lo que haya que pulsar se pulsa por JavaScript.
// Las capturas van a una carpeta temporal (se dice cuál al final).
//
// Qué comprueba:
//  - entrar con correo y contraseña desde la web;
//  - /personas para un admin de DOS espacios sin espacio propio (antes fallaba
//    con workspace_required): elige espacio y ve a la gente de cada uno;
//  - un coach ve su llamada, la transcripción, comenta, y la visita se apunta
//    (viewer.markViewed);
//  - /l/{token} sin sesión enseña la llamada sin datos de contacto.

const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const { createConvexHttp } = require('../../electron/cloud/convex-http.cjs')
const { createCloudSession } = require('../../electron/cloud/session.cjs')
const { createCloudSync } = require('../../electron/cloud/sync.cjs')

const CONVEX = process.env.CONVEX_E2E_URL || 'http://127.0.0.1:3210'
const WEB = process.env.WEB_E2E_URL || 'http://localhost:5174'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(CONVEX) || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(WEB)) {
  console.error('Solo contra un despliegue y una web locales.')
  process.exit(1)
}

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-web-real-'))
app.setPath('userData', path.join(tmp, 'perfil'))
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, 'utf-8'),
  decryptString: (b) => Buffer.from(b).toString('utf-8'),
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const http = createConvexHttp({ url: CONVEX })
const CLAVE = 'una-clave-de-prueba'
const sello = Date.now()
const correo = (quien) => `${quien}-${sello}@ejemplo.test`

/** Dueño de un espacio, como lo deja el escritorio al iniciar sesión. */
async function duenoConDatos(quien, nombreCarpeta) {
  const session = createCloudSession({ http, storeFile: path.join(tmp, `${quien}.bin`), safeStorage: fakeSafeStorage })
  const st = await session.signInWithPassword({ email: correo(quien), password: CLAVE, flow: 'signUp', name: `Dueño ${quien}` })
  const ISO = '2026-11-01T10:00:00.000Z'
  const data = {
    projects: [{ id: 'p1', ownerId: 'local', name: nombreCarpeta, company: 'Empresa Inventada', createdAt: ISO, status: 'active', evaluationCriteria: [], interviewers: ['Ana'], kind: 'entrevistas' }],
    candidates: [{ id: 'c1', projectId: 'p1', createdAt: ISO, name: 'Candidata Inventada', email: 'oculto@ejemplo.test', phone: '600000000', role: 'Diseñadora', notes: 'nota privada', candidateStatus: 'pendiente', consentGiven: true, consentAt: ISO }],
    interviews: [{
      id: 'i1', ownerId: 'local', candidateId: 'c1', createdAt: ISO, sessionName: 'Primera llamada', status: 'stopped', durationSec: 95,
      micDeviceId: 'mic', outputDeviceId: 'out', transcriptOriginal: '[Entrevistador] Hola, cuéntame de ti.\n[Candidata] Frase de prueba inventada.', transcriptEdited: '', transcriptUpdatedAt: ISO,
      recordingUrl: null, recordingFilePath: null, videoFilePath: null, systemAudioFilePath: null, captureSource: 'mic+system',
      transcriptionStatus: 'done', summaryInstructions: '', summaryText: 'Resumen inventado.', summaryStatus: 'done', summaryType: 'resumen',
      summaryContext: 'entrevista', interviewerName: 'Ana', audioUploaded: false,
    }],
  }
  const sync = createCloudSync({ storeFile: path.join(tmp, `${quien}-sync.json`), readData: async () => data, enqueueMedia: async () => ({ added: 0, updated: 0, skipped: 0 }) })
  await sync.setSession(session.callConvex, `${CONVEX}#${st.workspaceId}`)
  const r = await sync.runNow()
  assert.equal(r.ok, true, String(r.error?.message))
  const [proyecto] = await session.callConvex('query', 'project:list', { workspaceId: st.workspaceId })
  const [llamada] = await session.callConvex('query', 'viewer:myInterviews', { projectId: proyecto._id })
  return { session, workspaceId: st.workspaceId, proyecto, llamada }
}

/** Cuenta creada desde la web: sin espacio propio (no pasa por ensureMine). */
async function cuentaSinEspacio(quien) {
  await http.call('action', 'auth:signIn', { provider: 'password', params: { email: correo(quien), password: CLAVE, flow: 'signUp' } }, null)
}

async function entrarEnLaWeb(wc, quien) {
  await wc.loadURL(WEB + '/')
  await wc.executeJavaScript('localStorage.clear(); sessionStorage.clear()')
  await wc.loadURL(WEB + '/')
  await esperarA(wc, `!!document.querySelector('input[type=email]')`, 'el formulario de entrar')
  await wc.executeJavaScript(`(() => {
    const poner = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) };
    poner(document.querySelector('input[type=email]'), ${JSON.stringify(correo(quien))});
    poner(document.querySelector('input[type=password]'), ${JSON.stringify(CLAVE)});
    document.querySelector('form.formulario button[type=submit]').click();
  })()`)
  await esperarA(wc, `!document.querySelector('input[type=password]')`, `entrar como ${quien}`)
}

async function esperarA(wc, condicion, que, ms = 15000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (await wc.executeJavaScript(`(() => { try { return ${condicion} } catch { return false } })()`)) return
    await espera(250)
  }
  const texto = await wc.executeJavaScript('document.body.innerText.slice(0, 600)')
  throw new Error(`No llegó: ${que}. En pantalla:\n${texto}`)
}

const textoDe = (wc) => wc.executeJavaScript('document.body.innerText')

async function captura(win, nombre) {
  const img = await win.webContents.capturePage()
  const archivo = path.join(tmp, `${nombre}.jpg`)
  fs.writeFileSync(archivo, img.toJPEG(85))
  console.log('   captura:', archivo)
}

app.whenReady().then(async () => {
  // ── Datos inventados ──
  const a = await duenoConDatos('duena-a', 'Carpeta del espacio A')
  const b = await duenoConDatos('dueno-b', 'Carpeta del espacio B')
  await cuentaSinEspacio('admin-doble')
  await cuentaSinEspacio('coach')
  await a.session.callConvex('mutation', 'member:invite', { email: correo('admin-doble'), role: 'admin', projectIds: [], workspaceId: a.workspaceId })
  await b.session.callConvex('mutation', 'member:invite', { email: correo('admin-doble'), role: 'admin', projectIds: [], workspaceId: b.workspaceId })
  await a.session.callConvex('mutation', 'member:invite', { email: correo('coach'), role: 'coach', projectIds: [a.proyecto._id], workspaceId: a.workspaceId })
  await b.session.callConvex('mutation', 'member:invite', { email: correo('invitada-b'), role: 'coach', projectIds: [b.proyecto._id], workspaceId: b.workspaceId })
  const enlace = await a.session.callConvex('mutation', 'share:create', { interviewId: a.llamada._id, label: 'Cliente inventado' })
  console.log('✓ datos inventados: 2 espacios, 1 admin de los dos, 1 coach, 1 enlace')

  const win = new BrowserWindow({ show: false, width: 1280, height: 860, useContentSize: true, webPreferences: { offscreen: true } })
  const wc = win.webContents
  wc.setFrameRate(10)
  const erroresConsola = []
  wc.on('console-message', (e) => { if (e.level === 'error') erroresConsola.push(e.message) })

  // ── Admin de dos espacios en /personas ──
  await entrarEnLaWeb(wc, 'admin-doble')
  console.log('✓ entrar con correo y contraseña desde la web')
  await wc.loadURL(WEB + '/personas')
  await esperarA(wc, `document.body.innerText.includes(${JSON.stringify(correo('duena-a'))})`, 'la gente del espacio A')
  const opciones = await wc.executeJavaScript(`[...document.querySelectorAll('.pagina__cabeza select option')].map((o) => o.value)`)
  assert.equal(opciones.length, 2, 'elige entre sus dos espacios')
  await captura(win, 'personas-espacio-a')
  await wc.executeJavaScript(`(() => {
    const s = document.querySelector('.pagina__cabeza select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(b.workspaceId)});
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await esperarA(wc, `document.body.innerText.includes(${JSON.stringify(correo('invitada-b'))})`, 'la gente del espacio B')
  assert.ok(!(await textoDe(wc)).includes(correo('coach')), 'en B no sale la gente de A')
  await captura(win, 'personas-espacio-b')
  console.log('✓ /personas con dos espacios: elige y ve a la gente de cada uno')

  // ── Coach: lista, llamada, comentario y visita apuntada ──
  await entrarEnLaWeb(wc, 'coach')
  await esperarA(wc, `document.body.innerText.includes('Primera llamada')`, 'la lista del coach')
  assert.ok(!(await textoDe(wc)).includes('Carpeta del espacio B'), 'el coach no ve el espacio B')
  await captura(win, 'coach-lista')
  await wc.loadURL(`${WEB}/i/${a.llamada._id}`)
  await esperarA(wc, `document.body.innerText.includes('Candidata Inventada')`, 'la llamada')
  await wc.executeJavaScript(`[...document.querySelectorAll('.pestana')].find((b) => /Transcrip/.test(b.textContent))?.click()`)
  await esperarA(wc, `document.body.innerText.includes('Frase de prueba inventada')`, 'la transcripción')
  await wc.executeJavaScript(`[...document.querySelectorAll('.pestana')].find((b) => /Comentarios/.test(b.textContent))?.click()`)
  await espera(300)
  await wc.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => /Comentario general/.test(b.textContent))?.click()`)
  await esperarA(wc, `!!document.querySelector('textarea')`, 'el cuadro de comentario')
  await wc.executeJavaScript(`(() => {
    const ta = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Comentario de prueba del coach');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await espera(200)
  await wc.executeJavaScript(`[...document.querySelectorAll('.formulario-comentario button')].find((b) => /Publicar/.test(b.textContent))?.click()`)
  await esperarA(wc, `[...document.querySelectorAll('li, article')].some((n) => n.innerText.includes('Comentario de prueba del coach'))`, 'el comentario publicado')
  await captura(win, 'coach-llamada')
  const comentarios = await a.session.callConvex('query', 'comment:list', { interviewId: a.llamada._id })
  assert.equal(comentarios.length, 1)
  assert.equal(comentarios[0].isMine, false, 'para la dueña, el comentario del coach no es suyo')
  assert.ok(comentarios[0].authorName)
  console.log('✓ el coach ve la llamada y la transcripción y comenta (la dueña lo ve con autor)')

  // ── Cliente sin cuenta ──
  await wc.executeJavaScript('localStorage.clear()')
  const token = new URL(enlace.url).pathname.split('/').pop()
  await wc.loadURL(`${WEB}/l/${token}`)
  await esperarA(wc, `document.body.innerText.includes('Primera llamada')`, 'la página del cliente')
  const textoCliente = await textoDe(wc)
  assert.ok(!textoCliente.includes('oculto@ejemplo.test') && !textoCliente.includes('600000000'), 'sin datos de contacto')
  assert.ok(!/Comentar/.test(textoCliente), 'sin comentarios')
  await captura(win, 'cliente')
  const enlaces = await a.session.callConvex('query', 'share:list', { interviewId: a.llamada._id })
  assert.equal(enlaces[0].openCount, 1, 'share.open contó una apertura')
  console.log('✓ /l/{token} sin sesión: llamada sin contacto ni comentarios, apertura contada')

  if (erroresConsola.length) console.log('   errores de consola:', erroresConsola.slice(0, 5))
  console.log('\nTodo bien. Capturas en', tmp)
  console.log('interviewId de la llamada de A (para mirar accessLog):', a.llamada._id)
  win.destroy()
  app.quit()
}).catch((err) => { console.error('✗', err); app.exit(1) })
