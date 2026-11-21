// ── Errores entendibles ──────────────────────────────────────────────────────
//
// El backend lanza ConvexError({ code }) y la web lo traduce aquí a una frase
// que diga qué ha pasado y qué hacer. Los códigos no están cerrados en el
// contrato: se cubren los esperables y cualquier otro cae en el genérico.

import { ConvexError } from 'convex/values'
import { k, t } from './i18n'

const POR_CODIGO: Record<string, string> = {
  UNAUTHENTICATED: k('Tu sesión ha caducado. Vuelve a entrar.'),
  NOT_AUTHENTICATED: k('Tu sesión ha caducado. Vuelve a entrar.'),
  FORBIDDEN: k('No tienes acceso a esto. Pide a quien te invitó que te dé permiso.'),
  NO_ACCESS: k('No tienes acceso a esto. Pide a quien te invitó que te dé permiso.'),
  NOT_FOUND: k('No lo encontramos. Puede que lo hayan borrado.'),
  RATE_LIMITED: k('Demasiados intentos seguidos. Espera un minuto y vuelve a probar.'),
  INVALID_ARGUMENT: k('Algún dato no es válido. Revísalo y vuelve a probar.'),
  ALREADY_MEMBER: k('Esa persona ya está en el espacio.'),
  ALREADY_INVITED: k('Esa persona ya tiene una invitación pendiente.'),
  EXPIRED: k('Este enlace ya no está activo.'),
  MEDIA_NOT_READY: k('El vídeo todavía se está subiendo desde el ordenador.'),
}

/** El código de un ConvexError, si lo es. */
export function codigoDe(e: unknown): string | undefined {
  if (e instanceof ConvexError) {
    const d = e.data as unknown
    if (typeof d === 'string') return d
    if (d && typeof d === 'object' && 'code' in d) return String((d as { code: unknown }).code)
  }
  return undefined
}

export function mensajeDeError(e: unknown): string {
  const codigo = codigoDe(e)
  if (codigo && POR_CODIGO[codigo]) return t(POR_CODIGO[codigo])
  const texto = e instanceof Error ? e.message : String(e ?? '')
  // Convex Auth con contraseña no lanza ConvexError: avisa con estos nombres.
  if (/InvalidSecret|InvalidAccountId|Invalid credentials/i.test(texto)) return t('Correo o contraseña incorrectos.')
  if (/TooManyFailedAttempts/i.test(texto)) return t('Demasiados intentos seguidos. Espera un minuto y vuelve a probar.')
  if (/Failed to fetch|NetworkError|WebSocket/i.test(texto)) return t('No hay conexión. Revisa internet y vuelve a probar.')
  return t('Algo ha fallado. Vuelve a probar en un momento.')
}
