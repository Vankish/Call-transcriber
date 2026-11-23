// ── Las funciones de Convex que usa la web, en un solo sitio ─────────────────
//
// Con `api` tipado de convex/_generated: TypeScript comprueba el nombre de cada
// función y lo que recibe contra convex/*.ts, así que si el backend cambia una
// firma, `npm run web:build` falla aquí en vez de en el navegador. En tiempo de
// ejecución `api` es el mismo `anyApi` de antes (ver convex/_generated/api.js):
// no mete código del servidor en la web.

import { api } from '../../../convex/_generated/api'

export const fn = {
  // Sesión y espacio
  memberships: api.workspace.memberships, // consulta
  // Proyectos
  projectList: api.project.list, // consulta: { workspaceId? } → carpetas a las que llego
  // Personas (solo owner/admin). `workspaceId` opcional: la web lo pasa siempre,
  // porque a un admin de varios espacios el backend le pide que elija.
  memberInvite: api.member.invite, // mutación
  memberRevokeInvitation: api.member.revokeInvitation, // mutación
  memberList: api.member.list, // consulta
  memberUpdate: api.member.update, // mutación
  // Archivos
  playbackUrl: api.media.playbackUrl, // acción
  // Ver y comentar
  myInterviews: api.viewer.myInterviews, // consulta
  interview: api.viewer.interview, // consulta (se actualiza sola, no escribe)
  // Mutación aparte: una consulta no puede apuntar la visita en accessLog.
  markViewed: api.viewer.markViewed,
  commentList: api.comment.list, // consulta
  commentAdd: api.comment.add, // mutación
  commentEdit: api.comment.edit, // mutación
  commentRemove: api.comment.remove, // mutación
  commentResolve: api.comment.resolve, // mutación
  // Enlaces de cliente
  shareCreate: api.share.create, // mutación
  shareRenew: api.share.renew, // mutación
  shareRevoke: api.share.revoke, // mutación
  shareList: api.share.list, // consulta
  // Mutación y no consulta: suma `openCount` y aplica el límite de peticiones,
  // y una consulta de Convex no puede escribir.
  shareOpen: api.share.open,
}
