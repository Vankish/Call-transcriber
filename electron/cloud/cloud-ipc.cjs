// ── La nube en el proceso principal: sesión, sincronización y canales IPC ────
//
// Junta las tres piezas (sesión de Convex Auth, sincronización de datos y la
// cola de subidas del frente C) para que main.cjs solo tenga que registrarlo,
// avisar de cada guardado y pasarle el /convex-auth del servidor local.
//
// Sin VITE_CONVEX_URL (una compilación sin nube) todo esto queda apagado: los
// canales responden "no configurado" y la app funciona exactamente como antes.
//
// Canales:
//   cloud:status               → { configured, session, sync }
//   cloud:sign-in-password     { email, password, flow: 'signIn'|'signUp', name? }
//   cloud:sign-in-google       abre Google en el navegador del sistema
//   cloud:cancel-google
//   cloud:sign-out
//   cloud:sync-now
//   evento cloud:status        el mismo objeto que cloud:status, cada vez que cambia

const path = require('node:path')
const { createConvexHttp } = require('./convex-http.cjs')
const { createCloudSession } = require('./session.cjs')
const { createCloudSync } = require('./sync.cjs')
const { tr } = require('../i18n.cjs')

const CALLBACK_PATH = '/convex-auth'

function registerCloudIpc({
  ipcMain,
  app,
  safeStorage,
  shell,
  convexUrl,
  readData,
  uploads, // lo que devuelve registerUploadIpc
  getWindow,
  showWindow = () => {},
  log,
  callbackPort = 3000,
  // Para las pruebas: un cliente de Convex falso y esperas más cortas.
  httpOverride = null,
  syncOptions = {},
}) {
  const send = (payload) => {
    const w = getWindow?.()
    if (w && !w.isDestroyed()) w.webContents.send('cloud:status', payload)
  }

  let http = null
  try {
    http = httpOverride || (convexUrl ? createConvexHttp({ url: convexUrl }) : null)
  } catch (err) {
    log.warn(`[nube] ${err.message}`)
  }

  if (!http) {
    const off = () => ({ ok: false, errorCode: 'not-configured' })
    ipcMain.handle('cloud:status', () => ({ configured: false, session: null, sync: null }))
    for (const ch of ['cloud:sign-in-password', 'cloud:sign-in-google', 'cloud:cancel-google', 'cloud:sign-out', 'cloud:sync-now']) {
      ipcMain.handle(ch, off)
    }
    return {
      configured: false,
      notifyDataSaved() {},
      handleAuthRequest: () => false,
      stop() {},
    }
  }

  let session = null
  let sync = null
  let connectedKey = null

  const fullStatus = () => ({
    configured: true,
    session: session ? session.status() : { state: 'signed-out', error: null, email: null, name: null, provider: null, workspaceId: null },
    sync: sync ? sync.status() : null,
  })
  const push = () => send(fullStatus())

  // La sesión y la cola de subidas van juntas: sin sesión la cola espera
  // ("esperando sesión") y la sincronización se para.
  async function connect() {
    const st = session.status()
    const key = st.state === 'signed-in' && st.workspaceId ? `${http.url}#${st.workspaceId}` : null
    if (key === connectedKey) return
    connectedKey = key
    if (key) {
      await uploads.setCallConvex(session.callConvex)
      await sync.setSession(session.callConvex, key)
    } else {
      await uploads.setCallConvex(null)
      await sync.setSession(null)
    }
  }

  const ready = app.whenReady().then(async () => {
    const userData = app.getPath('userData')
    session = createCloudSession({
      http,
      storeFile: path.join(userData, 'cloud-session.bin'),
      safeStorage,
      openExternal: (url) => shell.openExternal(url),
      callbackUrl: `http://localhost:${callbackPort}${CALLBACK_PATH}`,
      onChange: () => { push(); void connect().catch((err) => log.warn(`[nube] ${err.message}`)) },
      log,
    })
    sync = createCloudSync({
      storeFile: path.join(userData, 'cloud-sync-state.json'),
      readData,
      enqueueMedia: (entries) => uploads.enqueue(entries),
      onStatus: push,
      log,
      ...syncOptions,
    })
    await session.load()
    // Con la sesión guardada se conecta ya (el espacio va en ella) y luego se
    // comprueba con el servidor; sin red, se queda conectada y reintenta.
    await connect()
    void session.resume().then(connect).catch(() => {})
  })

  const withReady = (fn) => async (_event, payload) => {
    await ready
    try {
      return { ok: true, ...(await fn(payload || {})) }
    } catch (err) {
      return { ok: false, errorCode: session?.status().error || err?.code || 'failed', error: String(err?.message || err).slice(0, 300) }
    }
  }

  ipcMain.handle('cloud:status', async () => { await ready; return fullStatus() })
  ipcMain.handle('cloud:sign-in-password', withReady(async ({ email, password, flow, name }) => {
    const r = await session.signInWithPassword({ email, password, flow, name })
    return { session: r }
  }))
  ipcMain.handle('cloud:sign-in-google', withReady(async () => ({ session: await session.signInWithGoogle() })))
  ipcMain.handle('cloud:cancel-google', withReady(async () => ({ cancelled: session.cancelOAuth() })))
  ipcMain.handle('cloud:sign-out', withReady(async () => { await session.signOut(); return {} }))
  ipcMain.handle('cloud:sync-now', withReady(async () => {
    const r = await sync.runNow()
    if (!r.ok && r.error) throw r.error
    return { pushed: r.pushed ?? 0 }
  }))

  /**
   * Para el servidor local de main.cjs: si la petición es la vuelta de Google
   * (/convex-auth?code=...), la atiende y devuelve true.
   */
  function handleAuthRequest(req, res) {
    let url
    try { url = new URL(req.url || '/', `http://localhost:${callbackPort}`) } catch { return false }
    if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) return false
    const accepted = !!session?.receiveOAuthCode(url.searchParams.get('code'))
    if (accepted) showWindow()
    const title = accepted ? `✓ ${tr('Sesión iniciada')}` : tr('Este enlace ya no sirve')
    const body = accepted ? tr('Puedes cerrar esta ventana y volver a Call Transcriber.') : tr('Vuelve a la app y pulsa otra vez «Entrar con Google».')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Call Transcriber</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#EFF6FF}
.box{background:#fff;border:1px solid #BFDBFE;border-radius:12px;padding:2rem 3rem;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.08)}
h2{color:#2563EB;margin:0 0 .5rem}p{color:#555;margin:0}</style></head>
<body><div class="box"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></div></body></html>`)
    return true
  }

  return {
    configured: true,
    /** main.cjs lo llama tras cada data:save. */
    notifyDataSaved: () => { if (sync) sync.schedule() },
    handleAuthRequest,
    stop: () => { sync?.stop() },
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

module.exports = { registerCloudIpc, CALLBACK_PATH }
