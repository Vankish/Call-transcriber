// ── Implementación falsa: datos inventados, sin red ──────────────────────────
//
// Imita lo que hará Convex para que las pantallas se puedan probar enteras:
// consultas reactivas (cambiar algo repinta quien lo mira), `undefined` mientras
// "carga" y errores con `code` como los de ConvexError. Lo que se cambia vive en
// memoria y se pierde al recargar, salvo la sesión, que se guarda para no tener
// que entrar cada vez.

import { useMemo, useSyncExternalStore } from 'react'
import { ConvexError } from 'convex/values'
import * as demo from './demo'
import { ProveedorFalso } from './ProveedorFalso'
import type { Comentario, Datos, Enlace, Invitacion, LlamadaFila, Miembro, Rol } from './tipos'

const SESION_KEY = 'ct-web-demo-sesion'
const DIA = 24 * 60 * 60_000

// El estado se sustituye entero en cada cambio (nunca se muta): así cada
// consulta puede memorizar su resultado por la identidad del estado, igual que
// useQuery de Convex devuelve el mismo objeto mientras nada cambie.
interface Estado {
  listo: boolean
  dentro: boolean
  /** La hora "de ahora" vive aquí y no en Date.now() dentro de un render:
   *  pintar tiene que ser puro, y así "caducado" se recalcula cada medio minuto. */
  ahora: number
  comentarios: Record<string, Comentario[]>
  enlaces: Record<string, (Enlace & { token: string })[]>
  miembros: Miembro[]
  invitaciones: Invitacion[]
}

let estado: Estado = {
  // Medio segundo de "carga" al abrir: sin esto los estados de carga nunca se
  // ven en desarrollo y nadie sabría si están bien.
  listo: false,
  dentro: (() => { try { return localStorage.getItem(SESION_KEY) === '1' } catch { return false } })(),
  ahora: Date.now(),
  comentarios: demo.comentarios,
  enlaces: demo.enlaces,
  miembros: demo.miembros,
  invitaciones: demo.invitaciones,
}

const oyentes = new Set<() => void>()
function poner(cambios: Partial<Estado>) {
  estado = { ...estado, ...cambios }
  oyentes.forEach((o) => o())
}
setTimeout(() => poner({ listo: true }), 500)
setInterval(() => poner({ ahora: Date.now() }), 30_000)

function useEstado() {
  return useSyncExternalStore(
    (o) => { oyentes.add(o); return () => { oyentes.delete(o) } },
    () => estado,
  )
}

let firmas = 0
const SIN_COMENTARIOS: Comentario[] = []

const espera = (ms = 250) => new Promise((r) => setTimeout(r, ms))
let siguiente = 100
const nuevoId = (p: string) => `${p}${siguiente++}`

function rolEn(workspaceId: string): Rol | undefined {
  return demo.membresias.find((m) => m.workspaceId === workspaceId)?.role
}

function exigirSesion() {
  if (!estado.dentro) throw new ConvexError({ code: 'UNAUTHENTICATED' })
}

function exigirAdmin() {
  exigirSesion()
  const rol = rolEn('w-rios')
  if (rol !== 'owner' && rol !== 'admin') throw new ConvexError({ code: 'FORBIDDEN' })
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function guardarSesion(dentro: boolean) {
  try {
    if (dentro) localStorage.setItem(SESION_KEY, '1')
    else localStorage.removeItem(SESION_KEY)
  } catch { /* incógnito */ }
  poner({ dentro })
}

/** Cambia un comentario sin mutarlo, esté en la llamada que esté. */
function cambiarComentario(commentId: string, f: (c: Comentario) => Comentario | null) {
  let visto = false
  const comentarios = Object.fromEntries(Object.entries(estado.comentarios).map(([id, lista]) => [
    id,
    lista.flatMap((c) => {
      if (c._id !== commentId) return [c]
      visto = true
      const nuevo = f(c)
      return nuevo ? [nuevo] : []
    }),
  ]))
  if (!visto) throw new ConvexError({ code: 'NOT_FOUND' })
  poner({ comentarios })
}

function cambiarEnlace(id: string, f: (e: Enlace & { token: string }) => Enlace & { token: string }) {
  let visto = false
  const enlaces = Object.fromEntries(Object.entries(estado.enlaces).map(([i, lista]) => [
    i,
    lista.map((e) => (e._id === id ? ((visto = true), f(e)) : e)),
  ]))
  if (!visto) throw new ConvexError({ code: 'NOT_FOUND' })
  poner({ enlaces })
}

export const datos: Datos = {
  modo: 'falso',
  Proveedor: ProveedorFalso,

  useSesion() {
    const e = useEstado()
    if (!e.listo) return { estado: 'cargando' }
    return e.dentro ? { estado: 'dentro' } : { estado: 'fuera' }
  },

  useAccionesSesion() {
    return {
      async entrarConGoogle() {
        await espera(400)
        guardarSesion(true)
      },
      async entrarConCorreo(email, password) {
        await espera(400)
        // Para poder ver el error de credenciales sin backend.
        if (password.length < 8 || !email.includes('@')) throw new Error('InvalidSecret')
        guardarSesion(true)
      },
      async salir() {
        guardarSesion(false)
      },
    }
  },

  useMembresias() {
    const e = useEstado()
    return e.listo && e.dentro ? demo.membresias : undefined
  },

  useMisLlamadas(projectId) {
    const e = useEstado()
    return useMemo(() => {
      if (!e.listo) return undefined
      if (!e.dentro) throw new ConvexError({ code: 'UNAUTHENTICATED' })
      const filas: LlamadaFila[] = demo.llamadas
        .filter((l) => !projectId || l.project._id === projectId)
        .map((l) => ({
          _id: l._id,
          workspaceId: l.workspaceId,
          projectId: l.project._id,
          projectName: l.project.name,
          projectKind: l.project.kind,
          candidateName: l.candidate.name,
          sessionName: l.sessionName,
          durationSec: l.durationSec,
          createdAt: l.createdAt,
          tieneVideo: l.media.some((m) => m.kind === 'video'),
        }))
      return filas.sort((a, b) => b.createdAt - a.createdAt)
    }, [e, projectId])
  },

  useProyectos(workspaceId) {
    const e = useEstado()
    return useMemo(
      () => (e.listo ? demo.proyectos.filter((p) => !workspaceId || p.workspaceId === workspaceId) : undefined),
      [e, workspaceId],
    )
  },

  useLlamada(interviewId) {
    const e = useEstado()
    if (!e.listo) return undefined
    if (!e.dentro) throw new ConvexError({ code: 'UNAUTHENTICATED' })
    const l = demo.llamadas.find((x) => x._id === interviewId)
    if (!l) throw new ConvexError({ code: 'NOT_FOUND' })
    return l
  },

  useLlamadaCliente(tokenUrl) {
    const e = useEstado()
    return useMemo(() => {
      if (!e.listo) return undefined
      for (const [interviewId, lista] of Object.entries(e.enlaces)) {
        const en = lista.find((x) => x.token === tokenUrl)
        if (!en) continue
        if (en.revokedAt || en.expiresAt < e.ahora) return { expired: true as const }
        const l = demo.llamadas.find((x) => x._id === interviewId)!
        // Lo mismo que hará share.open: fuera correo, teléfono y notas.
        return { ...l, candidate: { name: l.candidate.name, role: l.candidate.role } }
      }
      // Un token que no existe se contesta igual que uno caducado: así no se
      // puede ir probando tokens para ver cuáles existieron.
      return { expired: true as const }
    }, [e, tokenUrl])
  },

  usePedirUrl() {
    return async () => {
      await espera(150)
      // Cada firma lleva un número distinto, como las URL de R2, para que en
      // desarrollo se vea que la renovación cambia la dirección de verdad.
      firmas++
      return { url: `${demo.VIDEO_DEMO}?firma=${firmas}`, expiresAt: Date.now() + 60 * 60_000 }
    }
  },

  useComentarios(interviewId) {
    const e = useEstado()
    return e.listo ? (e.comentarios[interviewId] ?? SIN_COMENTARIOS) : undefined
  },

  useAccionesComentario() {
    return {
      async add({ interviewId, body, atSec, parentId }) {
        await espera()
        exigirSesion()
        const nuevo: Comentario = { _id: nuevoId('c'), authorName: demo.YO.nombre, esMio: true, body, atSec, parentId, createdAt: Date.now() }
        poner({ comentarios: { ...estado.comentarios, [interviewId]: [...(estado.comentarios[interviewId] ?? []), nuevo] } })
      },
      async edit({ commentId, body }) {
        await espera()
        cambiarComentario(commentId, (c) => {
          if (!c.esMio) throw new ConvexError({ code: 'FORBIDDEN' })
          return { ...c, body, editedAt: Date.now() }
        })
      },
      async remove({ commentId }) {
        await espera()
        cambiarComentario(commentId, (c) => {
          if (!c.esMio) throw new ConvexError({ code: 'FORBIDDEN' })
          return null
        })
      },
      async resolve({ commentId, resolved }) {
        await espera()
        cambiarComentario(commentId, (c) => ({ ...c, resolvedAt: resolved ? Date.now() : undefined }))
      },
    }
  },

  useEnlaces(interviewId) {
    const e = useEstado()
    return useMemo(() => {
      if (!e.listo) return undefined
      // El token no sale nunca de share.list: el servidor solo guarda su hash.
      return (e.enlaces[interviewId] ?? []).map(({ token: _token, ...en }): Enlace => en)
    }, [e, interviewId])
  },

  useAccionesEnlace() {
    return {
      async create({ interviewId, label }) {
        await espera()
        exigirAdmin()
        const en = { _id: nuevoId('e'), token: token(), label, expiresAt: Date.now() + 7 * DIA, openCount: 0, createdAt: Date.now() }
        poner({ enlaces: { ...estado.enlaces, [interviewId]: [en, ...(estado.enlaces[interviewId] ?? [])] } })
        return { shareLinkId: en._id, url: `${location.origin}/l/${en.token}`, expiresAt: en.expiresAt }
      },
      async renew({ shareLinkId }) {
        await espera()
        exigirAdmin()
        cambiarEnlace(shareLinkId, (en) => ({ ...en, expiresAt: Date.now() + 7 * DIA }))
      },
      async revoke({ shareLinkId }) {
        await espera()
        exigirAdmin()
        cambiarEnlace(shareLinkId, (en) => ({ ...en, revokedAt: Date.now() }))
      },
    }
  },

  usePersonas() {
    const e = useEstado()
    return useMemo(() => {
      if (!e.listo) return undefined
      exigirAdmin()
      return { members: e.miembros, invitations: e.invitaciones }
    }, [e])
  },

  useAccionesPersonas() {
    return {
      async invite({ email, role, projectIds }) {
        await espera()
        exigirAdmin()
        const normal = email.trim().toLowerCase()
        if (estado.miembros.some((m) => m.email === normal)) throw new ConvexError({ code: 'ALREADY_MEMBER' })
        if (estado.invitaciones.some((i) => i.email === normal)) throw new ConvexError({ code: 'ALREADY_INVITED' })
        poner({ invitaciones: [{ _id: nuevoId('v'), email: normal, role, projectIds, createdAt: Date.now() }, ...estado.invitaciones] })
      },
      async revokeInvitation({ invitationId }) {
        await espera()
        exigirAdmin()
        poner({ invitaciones: estado.invitaciones.filter((i) => i._id !== invitationId) })
      },
      async update({ memberId, ...cambios }) {
        await espera()
        exigirAdmin()
        const m = estado.miembros.find((x) => x._id === memberId)
        if (!m) throw new ConvexError({ code: 'NOT_FOUND' })
        if (m.role === 'owner') throw new ConvexError({ code: 'FORBIDDEN' })
        const limpios = Object.fromEntries(Object.entries(cambios).filter(([, val]) => val !== undefined))
        poner({ miembros: estado.miembros.map((x) => (x._id === memberId ? { ...x, ...limpios } : x)) })
      },
    }
  },
}
