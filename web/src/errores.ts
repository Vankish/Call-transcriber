// ── Errores entendibles ──────────────────────────────────────────────────────
//
// El backend lanza ConvexError({ code, message }) con los códigos de
// convex/errors.ts, y la web los traduce aquí a una frase que diga qué ha pasado
// y qué hacer. Un código que no esté aquí cae en el genérico.

import { ConvexError } from 'convex/values'
import { k, t } from './i18n'

const SESION = k('Tu sesión ha caducado. Vuelve a entrar.')
const SIN_ACCESO = k('No tienes acceso a esto. Pide a quien te invitó que te dé permiso.')
const ESPERA = k('Demasiados intentos seguidos. Espera un minuto y vuelve a probar.')

const POR_CODIGO: Record<string, string> = {
  unauthenticated: SESION,
  forbidden: SIN_ACCESO,
  read_only: SIN_ACCESO,
  not_found: k('No lo encontramos. Puede que lo hayan borrado.'),
  no_workspace: k('Todavía no tienes un espacio propio. Se crea al iniciar sesión desde la app de escritorio.'),
  workspace_required: k('Estás en varios espacios: elige en cuál quieres hacerlo.'),
  rate_limited: ESPERA,
  too_many_attempts: ESPERA,
  invalid_argument: k('Algún dato no es válido. Revísalo y vuelve a probar.'),
  already_member: k('Esa persona ya está en el espacio.'),
  // Solo lo usa la capa falsa: el backend corrige la invitación que ya había.
  already_invited: k('Esa persona ya tiene una invitación pendiente.'),
  owner_locked: k('Al dueño del espacio no se le puede cambiar el papel ni desactivar.'),
  not_pending: k('Esa invitación ya no está pendiente.'),
  expired: k('Este enlace ya no está activo.'),
  upload_state: k('El vídeo todavía se está subiendo desde el ordenador.'),
  media_not_ready: k('El vídeo todavía se está subiendo desde el ordenador.'),
  storage_error: k('No se pudo preparar el vídeo. Vuelve a probar en un momento.'),
  not_configured: k('El almacenamiento de vídeo todavía no está configurado.'),
  invalid_credentials: k('Correo o contraseña incorrectos.'),
  account_exists: k('Ese correo ya tiene cuenta. Entra con tu contraseña.'),
  weak_password: k('La contraseña tiene que tener al menos 8 caracteres.'),
  invalid_redirect: k('Esa dirección de vuelta no está permitida.'),
}

/** El código de un ConvexError, si lo es. */
export function codigoDe(e: unknown): string | undefined {
  if (e instanceof ConvexError) {
    const d = e.data as unknown
    // En minúsculas, como los de convex/errors.ts.
    if (typeof d === 'string') return d.toLowerCase()
    if (d && typeof d === 'object' && 'code' in d) return String((d as { code: unknown }).code).toLowerCase()
  }
  return undefined
}

export function mensajeDeError(e: unknown): string {
  const codigo = codigoDe(e)
  if (codigo && POR_CODIGO[codigo]) return t(POR_CODIGO[codigo])
  const texto = e instanceof Error ? e.message : String(e ?? '')
  // Por si el backend no envolviera algún fallo de Convex Auth en un ConvexError.
  if (/InvalidSecret|InvalidAccountId|Invalid credentials/i.test(texto)) return t('Correo o contraseña incorrectos.')
  if (/TooManyFailedAttempts/i.test(texto)) return t('Demasiados intentos seguidos. Espera un minuto y vuelve a probar.')
  if (/Failed to fetch|NetworkError|WebSocket/i.test(texto)) return t('No hay conexión. Revisa internet y vuelve a probar.')
  return t('Algo ha fallado. Vuelve a probar en un momento.')
}
