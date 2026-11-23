// ── Idioma de la web ──────────────────────────────────────────────────────────
//
// El mismo sistema que la app de escritorio (src/i18n.ts): el texto en español
// ES la clave, `t('Comentar en este momento')`, y su inglés vive en `EN`, más
// abajo. Una frase sin traducir sale en español en vez de romper nada, y
// `npm run i18n:check` lista las que faltan.
//
// Es un diccionario aparte del de la app porque es otra compilación: así la web
// no arrastra las 400 frases de la app ni la app las de la web.
//
// Los huecos van entre llaves: `t('Abierto {n} veces', { n })`.

import { useSyncExternalStore } from 'react'

export type Idioma = 'es' | 'en'

const IDIOMA_KEY = 'ct-web-idioma'

const esIdioma = (v: unknown): v is Idioma => v === 'es' || v === 'en'

/** El del navegador si es español; si no, inglés. Un coach que abre el enlace
 *  por primera vez lo ve en su idioma sin tocar nada. */
const idiomaDelNavegador = (): Idioma =>
  (navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en'

// Se lee al cargar el módulo y no en un efecto: así el primer render ya sale en
// el idioma bueno, sin parpadeo de español a inglés.
let actual: Idioma = (() => {
  try {
    const guardado = localStorage.getItem(IDIOMA_KEY)
    if (esIdioma(guardado)) return guardado
  } catch { /* modo incógnito */ }
  return idiomaDelNavegador()
})()
document.documentElement.lang = actual

const oyentes = new Set<() => void>()

export const getIdioma = () => actual

export function setIdioma(idioma: Idioma) {
  actual = idioma
  try { localStorage.setItem(IDIOMA_KEY, idioma) } catch { /* modo incógnito */ }
  document.documentElement.lang = idioma
  oyentes.forEach((o) => o())
}

/** Para que la raíz vuelva a pintar todo al cambiar de idioma. */
export function useIdioma(): Idioma {
  return useSyncExternalStore(
    (o) => { oyentes.add(o); return () => { oyentes.delete(o) } },
    getIdioma,
  )
}

/** Para fechas y números. */
export const locale = () => (actual === 'en' ? 'en-GB' : 'es-ES')

/** Marca una frase que se traduce más tarde, al pintarla, con `t(variable)`.
 *  No hace nada: existe para que `npm run i18n:check` la encuentre en las
 *  tablas que se definen fuera de un render (papeles, errores). */
export const k = (es: string) => es

export function t(es: string, vars?: Record<string, string | number>): string {
  const texto = actual === 'en' ? (EN[es] ?? es) : es
  if (!vars) return texto
  return texto.replace(/\{(\w+)\}/g, (hueco, clave: string) => (clave in vars ? String(vars[clave]) : hueco))
}

const EN: Record<string, string> = {
  // ── General ──
  'Cargando…': 'Loading…',
  'Idioma': 'Language',
  'Llamadas': 'Calls',
  'Personas': 'People',
  'Salir': 'Sign out',
  'Cancelar': 'Cancel',
  'Guardar': 'Save',
  'Editar': 'Edit',
  'Borrar': 'Delete',
  'Hecho': 'Done',
  '{n} min': '{n} min',
  '{h} h {m} min': '{h} h {m} min',

  // ── Estados y errores ──
  'Esta página no existe': 'This page doesn’t exist',
  'Revisa la dirección o vuelve a la lista de llamadas.': 'Check the address or go back to your calls.',
  'No encontramos esta llamada': 'We couldn’t find this call',
  'Ir a mis llamadas': 'Go to my calls',
  'No se ha podido cargar': 'This couldn’t be loaded',
  'Volver a probar': 'Try again',
  'Tu sesión ha caducado. Vuelve a entrar.': 'Your session has expired. Please sign in again.',
  'No tienes acceso a esto. Pide a quien te invitó que te dé permiso.': 'You don’t have access to this. Ask whoever invited you to give you permission.',
  'No lo encontramos. Puede que lo hayan borrado.': 'We couldn’t find it. It may have been deleted.',
  'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.': 'Too many attempts in a row. Wait a minute and try again.',
  'Algún dato no es válido. Revísalo y vuelve a probar.': 'Something in the form isn’t valid. Check it and try again.',
  'Esa persona ya está en el espacio.': 'That person is already in the workspace.',
  'Esa persona ya tiene una invitación pendiente.': 'That person already has a pending invitation.',
  'Este enlace ya no está activo.': 'This link is no longer active.',
  'El vídeo todavía se está subiendo desde el ordenador.': 'The video is still uploading from the computer.',
  'Correo o contraseña incorrectos.': 'Wrong email or password.',
  'No hay conexión. Revisa internet y vuelve a probar.': 'No connection. Check your internet and try again.',
  'Algo ha fallado. Vuelve a probar en un momento.': 'Something went wrong. Try again in a moment.',
  'Todavía no tienes un espacio propio. Se crea al iniciar sesión desde la app de escritorio.': 'You don’t have your own workspace yet. It’s created when you sign in from the desktop app.',
  'Estás en varios espacios: elige en cuál quieres hacerlo.': 'You’re in several workspaces: choose which one to use.',
  'Al dueño del espacio no se le puede cambiar el papel ni desactivar.': 'The workspace owner’s role can’t be changed and they can’t be deactivated.',
  'Esa invitación ya no está pendiente.': 'That invitation is no longer pending.',
  'No se pudo preparar el vídeo. Vuelve a probar en un momento.': 'The video couldn’t be prepared. Try again in a moment.',
  'El almacenamiento de vídeo todavía no está configurado.': 'Video storage isn’t set up yet.',
  'Ese correo ya tiene cuenta. Entra con tu contraseña.': 'That email already has an account. Sign in with your password.',
  'La contraseña tiene que tener al menos 8 caracteres.': 'The password must be at least 8 characters long.',
  'Esa dirección de vuelta no está permitida.': 'That return address isn’t allowed.',
  'Espacio': 'Workspace',
  'Falta configurar el almacenamiento en la nube': 'Cloud storage hasn’t been set up yet',

  // ── Entrar ──
  'Entra para ver tus llamadas': 'Sign in to see your calls',
  'Crea tu cuenta': 'Create your account',
  'Usa el mismo correo con el que te invitaron. Solo verás las llamadas que te hayan compartido.': 'Use the same email you were invited with. You’ll only see the calls shared with you.',
  'Abriendo Google…': 'Opening Google…',
  'Entrar con Google': 'Sign in with Google',
  'o con tu correo': 'or with your email',
  'Correo': 'Email',
  'Contraseña': 'Password',
  'Mínimo 8 caracteres.': 'At least 8 characters.',
  'Entrando…': 'Signing in…',
  'Entrar': 'Sign in',
  'Crear cuenta': 'Create account',
  '¿Es la primera vez?': 'First time here?',
  '¿Ya tienes cuenta?': 'Already have an account?',
  'Entra': 'Sign in',

  // ── Lista ──
  'Aún no tienes acceso a ninguna llamada': 'You don’t have access to any calls yet',
  'Pide a quien te quiera compartir sus llamadas que te invite con este mismo correo. En cuanto lo haga, aparecerán aquí.': 'Ask whoever wants to share their calls to invite this same email. As soon as they do, the calls will show up here.',
  'Las más recientes primero.': 'Most recent first.',
  'Este proyecto no tiene llamadas': 'This project has no calls',
  'Prueba con otro proyecto o quita el filtro.': 'Try another project or clear the filter.',
  'Ver todas': 'Show all',
  'Todavía no hay llamadas': 'No calls yet',
  'Cuando te compartan una llamada, aparecerá aquí.': 'When someone shares a call with you, it will show up here.',
  'Proyecto': 'Project',
  'Todos los proyectos': 'All projects',
  'Cliente': 'Client',
  'Entrevista': 'Interview',

  // ── Llamada ──
  'Cargando la llamada…': 'Loading the call…',
  'Abriendo la llamada…': 'Opening the call…',
  'Transcripción': 'Transcript',
  'Comentarios': 'Comments',
  'Resumen': 'Summary',
  'Compartir con el cliente': 'Share with the client',
  'Con {nombre}': 'With {nombre}',
  'Te han compartido esta llamada para que la veas. Es solo lectura.': 'This call has been shared with you to watch. It’s read-only.',
  'Esta llamada aún no tiene resumen.': 'This call doesn’t have a summary yet.',
  'Esta llamada aún no tiene transcripción.': 'This call doesn’t have a transcript yet.',
  'Esta transcripción no tiene tiempos: no se puede saltar al vídeo desde las frases.': 'This transcript has no timestamps, so you can’t jump to the video from it.',
  'Hay un comentario en este momento': 'There’s a comment at this moment',
  'Volver a lo que suena': 'Back to what’s playing',

  // ── Reproductor ──
  'El vídeo todavía se está subiendo': 'The video is still uploading',
  'Esta llamada no tiene grabación en la nube': 'This call has no recording in the cloud',
  'Se sube desde el ordenador de quien grabó. Vuelve en un rato.': 'It’s uploading from the computer that recorded it. Check back in a while.',
  'Puedes leer la transcripción y el resumen.': 'You can read the transcript and the summary.',
  'Reproductor': 'Player',
  'Solo audio por ahora: el vídeo se está subiendo': 'Audio only for now: the video is uploading',
  'Solo audio': 'Audio only',
  'No se puede reproducir': 'Can’t play this',
  'Reproducir': 'Play',
  'Pausa': 'Pause',
  'Comentario en {t}': 'Comment at {t}',
  'Posición': 'Position',
  'Atrás 10 segundos': 'Back 10 seconds',
  'Adelante 10 segundos': 'Forward 10 seconds',
  'Velocidad': 'Speed',
  'Pantalla completa': 'Full screen',

  // ── Comentarios ──
  'Comentar en este momento': 'Comment at this moment',
  'Comentario general': 'General comment',
  'Ver también los resueltos ({n})': 'Also show resolved ({n})',
  'Aún no hay comentarios. Pausa el vídeo donde quieras comentar y pulsa «Comentar en este momento».': 'No comments yet. Pause the video where you want to comment and press “Comment at this moment”.',
  'Todos los comentarios están resueltos.': 'All comments are resolved.',
  'Comentario en este momento': 'Comment at this moment',
  'Quitar el minuto': 'Remove the timestamp',
  'Comentario general, sin minuto': 'General comment, no timestamp',
  'Qué has visto aquí: tono, ritmo, una pregunta que funcionó…': 'What did you notice here: tone, pace, a question that worked…',
  'Ctrl + Intro para publicar': 'Ctrl + Enter to post',
  'Publicando…': 'Posting…',
  'Publicar': 'Post',
  'Escribe una respuesta…': 'Write a reply…',
  'Responder': 'Reply',
  'Reabrir': 'Reopen',
  'Marcar como resuelto': 'Mark as resolved',
  '¿Borrar este comentario?': 'Delete this comment?',
  'Alguien del equipo': 'Someone from the team',
  'Ir a este momento': 'Go to this moment',
  'editado': 'edited',
  'Resuelto': 'Resolved',

  // ── Enlaces de cliente ──
  'Un enlace de cliente deja ver esta llamada sin cuenta: vídeo, transcripción y resumen, sin comentarios ni datos de contacto. Caduca a los 7 días.': 'A client link lets someone watch this call without an account: video, transcript and summary, with no comments or contact details. It expires after 7 days.',
  'Para quién es': 'Who it’s for',
  'Ej.: Laura, directora de compras': 'E.g.: Laura, head of purchasing',
  'Creando…': 'Creating…',
  'Crear enlace': 'Create link',
  'Todavía no has compartido esta llamada con ningún cliente.': 'You haven’t shared this call with any client yet.',
  'Enlace creado': 'Link created',
  'Enlace': 'Link',
  'Copiado': 'Copied',
  'Copiar': 'Copy',
  'Cópialo ahora: por seguridad no se puede volver a ver. Si lo pierdes, crea otro y revoca este.': 'Copy it now: for security it can’t be shown again. If you lose it, create another one and revoke this one.',
  'Activo': 'Active',
  'Caducado': 'Expired',
  'Revocado': 'Revoked',
  'Caduca {cuando}': 'Expires {cuando}',
  'Caducó {cuando}': 'Expired {cuando}',
  'Revocado {cuando}': 'Revoked {cuando}',
  'Sin abrir': 'Not opened',
  'Abierto 1 vez': 'Opened once',
  'Abierto {n} veces': 'Opened {n} times',
  'última, {cuando}': 'last {cuando}',
  'Renovar 7 días': 'Renew 7 days',
  '¿Revocar este enlace? Quien lo tenga dejará de poder abrir la llamada.': 'Revoke this link? Whoever has it will no longer be able to open the call.',
  'Revocar': 'Revoke',
  'Este enlace ya no está activo': 'This link is no longer active',
  'Los enlaces para ver una llamada duran 7 días, y quien te lo mandó también puede desactivarlo antes.': 'Links to watch a call last 7 days, and whoever sent it can also turn it off earlier.',
  'Si todavía necesitas verla, pide a esa persona que te mande un enlace nuevo. Tardará un momento.': 'If you still need to watch it, ask that person to send you a new link. It only takes a moment.',

  // ── Personas ──
  'Dueño': 'Owner',
  'Todo, incluido repartir accesos.': 'Everything, including granting access.',
  'Administrador': 'Admin',
  'Todo menos borrar el espacio. Llega a todos los proyectos.': 'Everything except deleting the workspace. Reaches every project.',
  'Compañero': 'Teammate',
  'Ve, comenta y edita en sus proyectos.': 'Views, comments and edits in their projects.',
  'Coach': 'Coach',
  'Ve el vídeo y comenta en sus proyectos. No edita nada.': 'Watches the video and comments in their projects. Can’t edit anything.',
  'Solo el dueño del espacio puede ver esta página': 'Only the workspace owner can see this page',
  'Desde aquí se invita a coaches y compañeros.': 'This is where coaches and teammates are invited.',
  'Invitar a alguien': 'Invite someone',
  'Cuando esa persona entre con Google o con contraseña usando este correo, tendrá acceso. No hace falta que tenga cuenta todavía.': 'When that person signs in with Google or a password using this email, they’ll have access. They don’t need an account yet.',
  'Papel': 'Role',
  'Invitación lista para {email}. Avísale de que ya puede entrar.': 'Invitation ready for {email}. Let them know they can sign in now.',
  'Elige al menos un proyecto: sin proyectos no vería nada.': 'Pick at least one project: without projects they’d see nothing.',
  'Invitando…': 'Inviting…',
  'Invitar': 'Invite',
  'Todavía no hay proyectos subidos desde el escritorio.': 'No projects have been uploaded from the desktop app yet.',
  'Proyectos a los que llega': 'Projects they can reach',
  'Clientes': 'Clients',
  'Entrevistas': 'Interviews',
  'Invitaciones pendientes': 'Pending invitations',
  'Con acceso': 'With access',
  'Desactivados': 'Deactivated',
  'invitado {cuando}': 'invited {cuando}',
  'Anular': 'Cancel invitation',
  'ningún proyecto': 'no projects',
  'Cambiar': 'Change',
  'Desactivar': 'Deactivate',
  'Reactivar': 'Reactivate',
}
