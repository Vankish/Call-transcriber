// ── Sesión de la nube (Convex Auth) en el proceso principal ──────────────────
//
// La sesión vive aquí y no en la ventana: el token solo hace falta para subir
// datos y archivos, que también salen de aquí, y así una página comprometida no
// puede leerlo. La ventana solo ve "conectado como X".
//
// Convex Auth da dos tokens: `token`, un JWT que caduca en una hora y va en cada
// llamada, y `refreshToken`, que dura semanas y sirve para pedir otro JWT sin
// volver a escribir la contraseña. Los dos se guardan cifrados con safeStorage
// (DPAPI en Windows: solo este usuario de Windows en este PC puede descifrarlos)
// en un archivo propio de userData. Nunca en config.json: ese archivo se copia y
// se enseña para depurar, y los tokens no deben ir con él.
//
// Entrar con Google: `auth:signIn` devuelve la dirección de Google y un
// `verifier`. Se abre en el navegador del sistema (ahí la persona ya tiene su
// sesión de Google y ve la barra de direcciones de verdad) y Google vuelve, vía
// Convex, a http://localhost:3000/convex-auth?code=... El `code` solo vale junto
// con el `verifier`, que no sale nunca de este proceso: una página que intente
// colar su propio code no consigue nada.

const fsp = require('node:fs/promises')
const path = require('node:path')
const { CloudError } = require('./convex-http.cjs')

const OAUTH_TIMEOUT_MS = 5 * 60_000
// Se refresca un poco antes de que caduque: una subida que empieza con un token
// a 5 segundos de morir fallaría a mitad.
const REFRESH_MARGIN_MS = 2 * 60_000

/** Lo que pone en el JWT sin comprobar la firma: solo para saber cuándo caduca. */
function jwtPayload(token) {
  try {
    const part = String(token).split('.')[1]
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'))
  } catch {
    return null
  }
}

function createCloudSession({
  http, // createConvexHttp(...)
  storeFile,
  safeStorage, // el de Electron, o uno falso en las pruebas
  openExternal = async () => {},
  callbackUrl = 'http://localhost:3000/convex-auth',
  onChange = () => {},
  log = { info() {}, warn() {} },
  now = () => Date.now(),
}) {
  // { token, refreshToken, email, name, provider, workspaceId, memberId }
  let session = null
  let status = { state: 'signed-out', error: null }
  let refreshing = null
  let pendingOAuth = null // { verifier, resolve, reject, timer }

  const snapshot = () => ({
    state: status.state, // 'signed-out' | 'signing-in' | 'signed-in'
    error: status.error,
    email: session?.email ?? null,
    name: session?.name ?? null,
    provider: session?.provider ?? null,
    workspaceId: session?.workspaceId ?? null,
  })

  const setStatus = (state, error = null) => {
    status = { state, error }
    try { onChange(snapshot()) } catch { /* la ventana puede no existir */ }
  }

  // ── Guardado cifrado ──────────────────────────────────────────────────────
  const canEncrypt = () => {
    try { return !!safeStorage?.isEncryptionAvailable?.() } catch { return false }
  }

  async function persist() {
    if (!session) {
      await fsp.rm(storeFile, { force: true }).catch(() => {})
      return
    }
    if (!canEncrypt()) {
      // Sin cifrado del sistema no se escribe nada: mejor tener que volver a
      // entrar al reiniciar que dejar un token legible en el disco.
      log.warn('[nube] safeStorage no disponible: la sesión no se guarda en disco')
      return
    }
    const payload = { url: http.url, ...session }
    const blob = safeStorage.encryptString(JSON.stringify(payload))
    await fsp.mkdir(path.dirname(storeFile), { recursive: true })
    const tmp = `${storeFile}.tmp`
    await fsp.writeFile(tmp, blob)
    await fsp.rename(tmp, storeFile)
  }

  async function load() {
    if (!canEncrypt()) return snapshot()
    let blob
    try { blob = await fsp.readFile(storeFile) } catch { return snapshot() }
    try {
      const saved = JSON.parse(safeStorage.decryptString(blob))
      // Una sesión de otro despliegue (por ejemplo, de pruebas) no vale aquí.
      if (saved?.url === http.url && saved.refreshToken) {
        const { url: _u, ...rest } = saved
        session = rest
        setStatus('signed-in')
      }
    } catch (err) {
      log.warn(`[nube] no se pudo leer la sesión guardada: ${err.message}`)
      await fsp.rm(storeFile, { force: true }).catch(() => {})
    }
    return snapshot()
  }

  // ── Tokens ─────────────────────────────────────────────────────────────────
  async function applyTokens(tokens, extra = {}) {
    if (!tokens?.token || !tokens?.refreshToken) throw new CloudError('la nube no devolvió la sesión', { auth: true })
    session = { ...(session || {}), ...extra, token: tokens.token, refreshToken: tokens.refreshToken }
    await persist()
  }

  const expiresAt = (token) => {
    const exp = jwtPayload(token)?.exp
    return typeof exp === 'number' ? exp * 1000 : 0
  }

  /** Pide un JWT nuevo con el refreshToken. Uno a la vez: Convex Auth invalida el viejo al rotarlo. */
  function refresh() {
    if (!session?.refreshToken) return Promise.reject(new CloudError('sin sesión', { auth: true }))
    if (!refreshing) {
      const used = session.refreshToken
      refreshing = (async () => {
        try {
          const res = await http.call('action', 'auth:signIn', { refreshToken: used }, null)
          if (!res?.tokens) throw new CloudError('la sesión ha caducado', { auth: true })
          await applyTokens(res.tokens)
          return session.token
        } catch (err) {
          // Si la red falla, la sesión sigue valiendo: ya se refrescará luego.
          // Si es el servidor quien dice que no, hay que volver a entrar.
          if (!err?.network) await dropSession('expired')
          throw err
        } finally {
          refreshing = null
        }
      })()
    }
    return refreshing
  }

  async function validToken() {
    if (!session) throw new CloudError('sin sesión', { auth: true, code: 'no-session' })
    if (session.token && expiresAt(session.token) - REFRESH_MARGIN_MS > now()) return session.token
    return refresh()
  }

  /**
   * La función que reciben la cola de subidas y la sincronización:
   * callConvex(kind, path, args). Refresca la sesión y repite una vez si el
   * servidor rechaza el token.
   */
  async function callConvex(kind, fnPath, args) {
    const token = await validToken()
    try {
      return await http.call(kind, fnPath, args, token)
    } catch (err) {
      if (!err?.auth || !session) throw err
      const fresh = await refresh()
      return http.call(kind, fnPath, args, fresh)
    }
  }

  async function dropSession(reason) {
    session = null
    await persist().catch(() => {})
    setStatus('signed-out', reason === 'expired' ? 'expired' : null)
  }

  // ── Después de entrar: espacio propio y quién soy ─────────────────────────
  async function afterSignIn(extra) {
    const mine = await callConvex('mutation', 'workspace:ensureMine', {})
    session = { ...session, ...extra, workspaceId: mine.workspaceId, memberId: mine.memberId }
    // El correo y el nombre con los que quedó la cuenta (con Google no se saben
    // hasta aquí). Si la consulta falla, la sesión vale igual.
    try {
      // Con el espacio explícito: sin él, el backend lo deduce y, si la cuenta es
      // además admin de otros espacios, podría pedir que se elija (workspace_required).
      const list = await callConvex('query', 'member:list', { workspaceId: mine.workspaceId })
      const me = list?.members?.find((m) => m._id === mine.memberId)
      if (me) session = { ...session, email: me.email || session.email || null, name: me.name || session.name || null }
    } catch (err) {
      log.warn(`[nube] no se pudo leer el nombre de la cuenta: ${err.message}`)
    }
    await persist()
    setStatus('signed-in')
    return snapshot()
  }

  async function signInWithPassword({ email, password, flow = 'signIn', name }) {
    const cleanEmail = String(email || '').trim().toLowerCase()
    if (!cleanEmail || !password) throw new CloudError('faltan el correo o la contraseña', { code: 'invalid_argument' })
    if (flow !== 'signIn' && flow !== 'signUp') throw new CloudError('flujo desconocido', { code: 'invalid_argument' })
    setStatus('signing-in')
    try {
      const params = { email: cleanEmail, password: String(password), flow }
      if (flow === 'signUp' && name) params.name = String(name).trim()
      const res = await http.call('action', 'auth:signIn', { provider: 'password', params }, null)
      session = null
      await applyTokens(res?.tokens, { email: cleanEmail, name: params.name ?? null, provider: 'password' })
      return await afterSignIn({})
    } catch (err) {
      session = null
      await persist().catch(() => {})
      setStatus('signed-out', classifySignInError(err, flow))
      throw err
    }
  }

  async function signInWithGoogle() {
    if (pendingOAuth) cancelOAuth('replaced')
    setStatus('signing-in')
    try {
      const res = await http.call('action', 'auth:signIn', { provider: 'google', params: { redirectTo: callbackUrl } }, null)
      if (!res?.redirect || !res?.verifier) throw new CloudError('la nube no devolvió la dirección de Google')
      const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => cancelOAuth('timeout'), OAUTH_TIMEOUT_MS)
        pendingOAuth = { verifier: res.verifier, resolve, reject, timer }
        Promise.resolve(openExternal(res.redirect)).catch((err) => cancelOAuth(err?.message || 'open-failed'))
      })
      const verifier = pendingOAuth?.verifier ?? res.verifier
      clearPending()
      const done = await http.call('action', 'auth:signIn', { params: { code }, verifier }, null)
      session = null
      await applyTokens(done?.tokens, { provider: 'google' })
      return await afterSignIn({})
    } catch (err) {
      clearPending()
      session = null
      await persist().catch(() => {})
      setStatus('signed-out', err?.code === 'oauth-cancelled' ? null : classifySignInError(err, 'google'))
      throw err
    }
  }

  function clearPending() {
    if (pendingOAuth) clearTimeout(pendingOAuth.timer)
    pendingOAuth = null
  }

  function cancelOAuth(reason = 'cancelled') {
    const p = pendingOAuth
    if (!p) return false
    clearPending()
    const code = reason === 'timeout' ? 'oauth-timeout' : 'oauth-cancelled'
    p.reject(new CloudError(reason === 'timeout' ? 'se acabó el tiempo para entrar con Google' : 'inicio de sesión cancelado', { code }))
    return true
  }

  /** Lo llama el servidor local al recibir /convex-auth?code=... Devuelve si se esperaba. */
  function receiveOAuthCode(code) {
    if (!pendingOAuth || !code) return false
    pendingOAuth.resolve(String(code))
    return true
  }

  async function signOut() {
    cancelOAuth()
    const token = session?.token
    // Primero se olvida en local: cerrar sesión tiene que funcionar sin red.
    session = null
    await persist().catch(() => {})
    setStatus('signed-out')
    if (token) await http.call('action', 'auth:signOut', {}, token).catch(() => {})
  }

  /** Al arrancar con una sesión guardada: comprueba que sigue viva y lee el espacio. */
  async function resume() {
    if (!session) return snapshot()
    try {
      return await afterSignIn({})
    } catch (err) {
      // Sin red al arrancar no se cierra la sesión: se queda "conectado" y la
      // sincronización reintentará. Solo si el servidor la rechaza se cae.
      if (err?.auth && !err?.network) await dropSession('expired')
      else log.warn(`[nube] no se pudo comprobar la sesión al arrancar: ${err.message}`)
      return snapshot()
    }
  }

  return {
    load,
    resume,
    signInWithPassword,
    signInWithGoogle,
    cancelOAuth,
    receiveOAuthCode,
    signOut,
    callConvex,
    isSignedIn: () => !!session,
    status: snapshot,
  }
}

// Códigos de convex/errors.ts → los estados que traduce CloudPanel.tsx.
const SIGN_IN_CODES = {
  invalid_credentials: 'invalid-credentials',
  account_exists: 'account-exists',
  weak_password: 'weak-password',
  too_many_attempts: 'rate-limited',
  rate_limited: 'rate-limited',
  invalid_redirect: 'redirect-not-allowed',
}

/** Un código estable para que la interfaz enseñe el mensaje en su idioma. */
function classifySignInError(err, flow) {
  if (err?.network) return 'network'
  if (err?.code === 'oauth-timeout') return 'oauth-timeout'
  // El backend traduce los fallos de Convex Auth a ConvexError con `code`
  // (convex/auth.ts, passwordError): es lo único que sobrevive en producción,
  // donde Convex cambia el texto de los demás errores por "Server Error".
  if (err?.code && SIGN_IN_CODES[err.code]) return SIGN_IN_CODES[err.code]
  const text = String(err?.message || '')
  if (/already exists/i.test(text)) return 'account-exists'
  if (/invalid password|al menos \d+ caracteres/i.test(text)) return 'weak-password'
  if (/redirectTo/i.test(text)) return 'redirect-not-allowed'
  if (/rate|too many/i.test(text)) return 'rate-limited'
  // En producción Convex esconde el texto de los errores que no son ConvexError
  // ("Server Error"), así que al entrar con contraseña lo más probable es esto.
  if (flow === 'signIn') return 'invalid-credentials'
  if (flow === 'signUp') return 'signup-failed'
  return 'failed'
}

module.exports = { createCloudSession, jwtPayload, classifySignInError }
