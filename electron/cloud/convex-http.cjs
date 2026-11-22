// ── Cliente de Convex para el proceso principal ──────────────────────────────
//
// Habla con la API HTTP de Convex a pelo (POST /api/query|mutation|action) en
// vez de usar el paquete `convex`. Dos motivos:
//  1. `convex` está en devDependencies a propósito (solo lo usan las funciones
//     del servidor y lo que empaqueta Vite): no llega dentro del instalador, así
//     que un require('convex') aquí fallaría en la app instalada.
//  2. El proceso principal no necesita suscripciones en vivo: sube lotes y pide
//     firmas de subida. Un fetch por llamada es todo lo que hace falta.
//
// Las respuestas de la API: 200 con { status: 'success', value } si fue bien;
// 560 con { status: 'error', errorMessage, errorData? } si la función lanzó (el
// errorData es el de un ConvexError, con nuestro `code`); cualquier otro código
// es un fallo de la propia petición (token rechazado, despliegue caído...).

const KINDS = new Set(['query', 'mutation', 'action'])
const STATUS_FUNCTION_FAILED = 560
const DEFAULT_TIMEOUT_MS = 60_000

/** Error de la nube con lo justo para decidir qué hacer: reintentar, refrescar la sesión o rendirse. */
class CloudError extends Error {
  constructor(message, { code = null, status = null, auth = false, network = false, data = null } = {}) {
    super(message)
    this.name = 'CloudError'
    this.code = code
    this.status = status
    this.auth = auth // el token no vale: hay que refrescarlo o volver a entrar
    this.network = network // no se llegó al servidor: reintentar más tarde
    this.data = data
    // Lo que sí merece la pena repetir: la red y los fallos del servidor.
    this.retryable = network || (status !== null && status >= 500 && status !== STATUS_FUNCTION_FAILED) || status === 429
  }
}

// Lo que Convex responde cuando el JWT no vale (caducado, firmado por otro
// despliegue, mal formado). No siempre llega como 401, por eso se mira el texto.
const AUTH_TEXT = /unauthenticated|invalidauthheader|token.{0,20}expired|could not verify oidc|authtoken|no auth provider/i

/** Quita la barra final y comprueba que es una dirección que tiene sentido. */
function normalizeConvexUrl(raw) {
  const text = String(raw || '').trim().replace(/\/+$/, '')
  if (!text) return null
  let url
  try { url = new URL(text) } catch { return null }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  // http solo para un despliegue local de pruebas: el token viaja en la cabecera.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null
  return text
}

function createConvexHttp({ url, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const base = normalizeConvexUrl(url)
  if (!base) throw new Error('VITE_CONVEX_URL no es una dirección válida de Convex')

  /**
   * Llama a una función pública. `path` con dos puntos: 'sync:pushProjects'.
   * `token` es el JWT de Convex Auth, o null para las que no piden sesión.
   */
  async function call(kind, path, args = {}, token = null) {
    if (!KINDS.has(kind)) throw new Error(`tipo de función desconocido: ${kind}`)
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res
    try {
      res = await fetchImpl(`${base}/api/${kind}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: String(path).replace('.', ':'), args, format: 'json' }),
        signal: ctrl.signal,
      })
    } catch (err) {
      throw new CloudError(`sin conexión con la nube: ${err?.message || err}`, { network: true })
    } finally {
      clearTimeout(timer)
    }

    const text = await res.text().catch(() => '')
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { /* no era JSON */ }

    if (res.ok && body?.status === 'success') return body.value
    if (body?.status === 'error') {
      const data = body.errorData ?? null
      const code = data && typeof data === 'object' && typeof data.code === 'string' ? data.code : null
      const message = (data && typeof data.message === 'string' && data.message) || body.errorMessage || 'error en la nube'
      throw new CloudError(message, {
        code,
        status: res.status,
        data,
        auth: code === 'unauthenticated' || (!code && AUTH_TEXT.test(String(body.errorMessage || ''))),
      })
    }
    const detail = (body && (body.message || body.code)) || text.slice(0, 300) || `HTTP ${res.status}`
    throw new CloudError(`la nube respondió ${res.status}: ${detail}`, {
      status: res.status,
      code: body?.code ?? null,
      auth: res.status === 401 || res.status === 403 || AUTH_TEXT.test(String(detail)),
    })
  }

  return { url: base, call }
}

module.exports = { createConvexHttp, normalizeConvexUrl, CloudError }
