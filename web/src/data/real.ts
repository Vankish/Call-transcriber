// ── Implementación real: Convex ──────────────────────────────────────────────
//
// Llama a las funciones de docs/nube/CONTRATO.md a través de convex-api.ts. El
// contrato dice qué función hay y qué recibe, pero no siempre la forma exacta
// de lo que devuelve; donde hay que suponerla, la conversión está en un
// `adaptar*` de este archivo y lleva un comentario SUPUESTO. Si el backend
// devuelve otra cosa, se cambia aquí y ninguna pantalla se entera.

import { useEffect, useMemo, useState } from 'react'
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { useAuthActions } from '@convex-dev/auth/react'
import { fn } from './convex-api'
import { ProveedorConvex } from './ProveedorConvex'
import type {
  Archivo, Comentario, Datos, Enlace, Invitacion, LlamadaCliente, LlamadaDetalle, LlamadaFila,
  Membresia, Miembro, Proyecto, Segmento,
} from './tipos'

// Lo que llega de Convex no está tipado hasta que exista convex/_generated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any

const str = (v: unknown, otro = '') => (typeof v === 'string' ? v : otro)
const num = (v: unknown, otro = 0) => (typeof v === 'number' ? v : otro)

/** SUPUESTO: viewer.myInterviews devuelve cada llamada con su proyecto y su
 *  perfil al lado ({ ...interview, project, candidate, media? }), o anidada en
 *  `interview`. Se aceptan las dos formas. */
function adaptarFila(d: Doc): LlamadaFila {
  const i = d.interview ?? d
  const p = d.project ?? {}
  const c = d.candidate ?? {}
  return {
    _id: i._id,
    workspaceId: i.workspaceId,
    projectId: i.projectId ?? p._id,
    projectName: str(p.name ?? d.projectName),
    projectKind: (p.kind ?? d.projectKind) === 'clientes' ? 'clientes' : 'entrevistas',
    candidateName: str(c.name ?? d.candidateName),
    sessionName: str(i.sessionName),
    durationSec: num(i.durationSec),
    createdAt: num(i.createdAt),
    tieneVideo: Boolean(d.hasVideo ?? (d.media ?? []).some((m: Doc) => m.kind === 'video')),
  }
}

function adaptarArchivo(m: Doc): Archivo {
  return { _id: m._id, kind: m.kind, mimeType: str(m.mimeType), durationSec: m.durationSec, uploadStatus: m.uploadStatus }
}

/** viewer.interview y share.open: "entrevista + perfil + proyecto +
 *  transcripción + lista de archivos" (contrato). SUPUESTO: con esos nombres. */
function adaptarDetalle(d: Doc): LlamadaDetalle {
  const i = d.interview ?? d
  const p = d.project ?? {}
  const c = d.candidate ?? {}
  const tr = d.transcript
  return {
    _id: i._id,
    workspaceId: i.workspaceId,
    sessionName: str(i.sessionName),
    durationSec: num(i.durationSec),
    createdAt: num(i.createdAt),
    interviewerName: str(i.interviewerName),
    summaryText: str(i.summaryText),
    project: { _id: p._id, name: str(p.name), company: str(p.company), kind: p.kind === 'clientes' ? 'clientes' : 'entrevistas' },
    candidate: { name: str(c.name), role: str(c.role), email: c.email || undefined, phone: c.phone || undefined },
    // La editada es la que el dueño ha revisado a mano: manda sobre la original.
    transcript: tr ? { text: str(tr.edited) || str(tr.original), segments: tr.segments as Segmento[] | undefined } : null,
    media: (d.media ?? []).map(adaptarArchivo),
  }
}

/** SUPUESTO: comment.list trae el nombre del autor (`authorName`) y si es mío
 *  (`isMine`). El esquema solo guarda `authorMemberId`, y la web no tiene cómo
 *  saber el nombre ni su propio memberId en ese espacio. Ver el informe. */
function adaptarComentario(c: Doc): Comentario {
  return {
    _id: c._id,
    authorName: str(c.authorName ?? c.author?.name),
    esMio: Boolean(c.isMine),
    atSec: c.atSec,
    body: str(c.body),
    parentId: c.parentId,
    resolvedAt: c.resolvedAt,
    createdAt: num(c.createdAt),
    editedAt: c.editedAt,
  }
}

function adaptarEnlace(e: Doc): Enlace {
  return {
    _id: e._id, label: str(e.label), expiresAt: num(e.expiresAt), revokedAt: e.revokedAt,
    openCount: num(e.openCount), lastOpenedAt: e.lastOpenedAt, createdAt: num(e.createdAt),
  }
}

/** SUPUESTO: member.list → { members, invitations } (el contrato dice
 *  "members e invitaciones pendientes"). Si llega con otros nombres, aquí. */
function adaptarPersonas(d: Doc): { members: Miembro[]; invitations: Invitacion[] } {
  const miembros: Doc[] = d.members ?? []
  const invitaciones: Doc[] = (d.invitations ?? []).filter((i: Doc) => !i.status || i.status === 'pending')
  return {
    members: miembros.map((m) => ({
      _id: m._id, name: str(m.name), email: str(m.email), role: m.role, status: m.status, projectIds: m.projectIds ?? [],
    })),
    invitations: invitaciones.map((i) => ({
      _id: i._id, email: str(i.email), role: i.role, projectIds: i.projectIds ?? [], createdAt: num(i.createdAt),
    })),
  }
}

/** Convex Auth avisa del resultado de Google volviendo a la misma página. */
const volverAqui = () => location.pathname + location.search

export const datos: Datos = {
  modo: 'real',
  Proveedor: ProveedorConvex,

  useSesion() {
    const { isLoading, isAuthenticated } = useConvexAuth()
    if (isLoading) return { estado: 'cargando' }
    return isAuthenticated ? { estado: 'dentro' } : { estado: 'fuera' }
  },

  useAccionesSesion() {
    const { signIn, signOut } = useAuthActions()
    return {
      async entrarConGoogle() {
        await signIn('google', { redirectTo: volverAqui() })
      },
      async entrarConCorreo(email, password, flujo) {
        await signIn('password', { email, password, flow: flujo })
      },
      async salir() {
        await signOut()
      },
    }
  },

  useMembresias() {
    const { isAuthenticated } = useConvexAuth()
    return useQuery(fn.memberships, isAuthenticated ? {} : 'skip') as Membresia[] | undefined
  },

  useMisLlamadas(projectId) {
    const r = useQuery(fn.myInterviews, projectId ? { projectId } : {})
    return useMemo(() => (r ? (r as Doc[]).map(adaptarFila) : undefined), [r])
  },

  // DESVÍO: el contrato no tiene "proyectos del espacio" para la web. Se sacan
  // de las llamadas a las que llego, así que un proyecto sin llamadas no sale.
  useProyectos(workspaceId) {
    const r = useQuery(fn.myInterviews, {})
    return useMemo(() => {
      if (!r) return undefined
      const vistos = new Map<string, Proyecto>()
      for (const d of r as Doc[]) {
        const f = adaptarFila(d)
        if (workspaceId && f.workspaceId !== workspaceId) continue
        if (!vistos.has(f.projectId)) {
          vistos.set(f.projectId, { _id: f.projectId, workspaceId: f.workspaceId, name: f.projectName, company: str(d.project?.company), kind: f.projectKind })
        }
      }
      return [...vistos.values()]
    }, [r, workspaceId])
  },

  useLlamada(interviewId) {
    const r = useQuery(fn.interview, { interviewId })
    return useMemo(() => (r ? adaptarDetalle(r) : undefined), [r])
  },

  useLlamadaCliente(token) {
    // share.open es una mutación (cuenta las aperturas), así que se pide una vez
    // al abrir y no se queda escuchando: el cliente ve una foto de la llamada.
    const abrir = useMutation(fn.shareOpen)
    const [r, setR] = useState<{ token: string; valor: LlamadaCliente } | null>(null)
    const [fallo, setFallo] = useState<unknown>(null)
    useEffect(() => {
      let vivo = true
      abrir({ token }).then(
        (d: Doc) => { if (vivo) setR({ token, valor: d?.expired ? { expired: true } : adaptarDetalle(d) }) },
        (e: unknown) => { if (vivo) setFallo(e) },
      )
      return () => { vivo = false }
    }, [abrir, token])
    if (fallo) throw fallo
    return r && r.token === token ? r.valor : undefined
  },

  usePedirUrl() {
    const firmar = useAction(fn.playbackUrl)
    return async (mediaId, shareToken) => {
      const r = await firmar(shareToken ? { mediaId, shareToken } : { mediaId })
      return { url: str(r.url), expiresAt: num(r.expiresAt) }
    }
  },

  useComentarios(interviewId) {
    const r = useQuery(fn.commentList, { interviewId })
    return useMemo(() => (r ? (r as Doc[]).map(adaptarComentario) : undefined), [r])
  },

  useAccionesComentario() {
    const add = useMutation(fn.commentAdd)
    const edit = useMutation(fn.commentEdit)
    const remove = useMutation(fn.commentRemove)
    const resolve = useMutation(fn.commentResolve)
    return {
      async add(a) { await add(a) },
      async edit(a) { await edit(a) },
      async remove(a) { await remove(a) },
      async resolve(a) { await resolve(a) },
    }
  },

  useEnlaces(interviewId) {
    const r = useQuery(fn.shareList, { interviewId })
    return useMemo(() => (r ? (r as Doc[]).map(adaptarEnlace) : undefined), [r])
  },

  useAccionesEnlace() {
    const create = useMutation(fn.shareCreate)
    const renew = useMutation(fn.shareRenew)
    const revoke = useMutation(fn.shareRevoke)
    return {
      async create(a) {
        const r = await create(a)
        return { shareLinkId: r.shareLinkId, url: str(r.url), expiresAt: num(r.expiresAt) }
      },
      async renew(a) { await renew(a) },
      async revoke(a) { await revoke(a) },
    }
  },

  usePersonas() {
    const r = useQuery(fn.memberList, {})
    return useMemo(() => (r ? adaptarPersonas(r) : undefined), [r])
  },

  useAccionesPersonas() {
    const invite = useMutation(fn.memberInvite)
    const revokeInvitation = useMutation(fn.memberRevokeInvitation)
    const update = useMutation(fn.memberUpdate)
    return {
      async invite(a) { await invite(a) },
      async revokeInvitation(a) { await revokeInvitation(a) },
      async update(a) { await update(a) },
    }
  },
}
