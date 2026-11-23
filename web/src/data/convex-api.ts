// ── Las funciones de Convex que usa la web, en un solo sitio ─────────────────
//
// Mientras no exista convex/_generated (sale al conectar con un despliegue), no
// hay `api` tipado: se usa `anyApi`, que acepta cualquier nombre. Por eso todos
// los nombres viven aquí y solo aquí, copiados de docs/nube/CONTRATO.md.
//
// Cuando exista convex/_generated, este archivo pasa a ser:
//
//   import { api } from '../../../convex/_generated/api'
//   export const fn = { ...las mismas claves, apuntando a api.x.y }
//
// y el resto de la web no se entera (salvo que TypeScript empezará a avisar de
// los campos que no coincidan con lo que supone real.ts, que es lo que se quiere).

import { anyApi } from 'convex/server'

const api = anyApi

export const fn = {
  // Sesión y espacio
  memberships: api.workspace.memberships, // consulta
  // Proyectos
  projectList: api.project.list, // consulta: { workspaceId? } → carpetas a las que llego
  // Personas (solo owner/admin)
  memberInvite: api.member.invite, // mutación
  memberRevokeInvitation: api.member.revokeInvitation, // mutación
  memberList: api.member.list, // consulta
  memberUpdate: api.member.update, // mutación
  // Archivos
  playbackUrl: api.media.playbackUrl, // acción
  // Ver y comentar
  myInterviews: api.viewer.myInterviews, // consulta
  interview: api.viewer.interview, // consulta
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
