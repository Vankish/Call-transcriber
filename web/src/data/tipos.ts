// ── Lo que las pantallas necesitan de los datos ──────────────────────────────
//
// Las pantallas no saben si detrás hay Convex o datos inventados: solo conocen
// esta interfaz. Hay dos implementaciones, `falso.ts` (datos de prueba, sin
// red) y `real.ts` (Convex). Se elige en main.tsx con VITE_CONVEX_URL.
//
// Los nombres de los campos siguen convex/schema.ts siempre que se puede; lo que
// no está en el esquema (el nombre del autor de un comentario, si un comentario
// es mío) lo rellena el adaptador de cada implementación.
//
// Convención de Convex que se respeta en todas las consultas: `undefined` es
// "cargando". Un fallo de permiso no se devuelve, se lanza, y lo recoge el
// ErrorBoundary de la pantalla.

import type { ComponentType, ReactNode } from 'react'

export type Rol = 'owner' | 'admin' | 'editor' | 'coach'
/** El papel de dueño no se reparte: hay uno por espacio y es quien lo creó. */
export type RolInvitable = Exclude<Rol, 'owner'>
export type TipoProyecto = 'entrevistas' | 'clientes'
export type TipoArchivo = 'mix' | 'system' | 'video'

export type Sesion =
  | { estado: 'cargando' }
  | { estado: 'fuera' }
  | { estado: 'dentro' }

export interface Membresia {
  workspaceId: string
  workspaceName: string
  memberId: string
  role: Rol
  projectIds: string[]
}

export interface Proyecto {
  _id: string
  workspaceId: string
  name: string
  company: string
  kind: TipoProyecto
}

/** Una fila de la lista de llamadas de `/`. */
export interface LlamadaFila {
  _id: string
  workspaceId: string
  projectId: string
  projectName: string
  projectKind: TipoProyecto
  candidateName: string
  sessionName: string
  durationSec: number
  createdAt: number
  tieneVideo: boolean
}

export interface Segmento {
  startSec: number
  endSec: number
  speaker: string
  text: string
}

export interface Archivo {
  _id: string
  kind: TipoArchivo
  mimeType: string
  durationSec?: number
  uploadStatus: 'pending' | 'uploading' | 'done' | 'error'
}

/** Lo que pinta la página de una llamada, la del coach y la del cliente. */
export interface LlamadaDetalle {
  _id: string
  workspaceId: string
  sessionName: string
  durationSec: number
  createdAt: number
  interviewerName: string
  summaryText: string
  project: { _id: string; name: string; company: string; kind: TipoProyecto }
  /** Al cliente le llega sin correo, teléfono ni notas (share.open los quita). */
  candidate: { name: string; role: string; email?: string; phone?: string }
  transcript: { text: string; segments?: Segmento[] } | null
  media: Archivo[]
}

export type LlamadaCliente = LlamadaDetalle | { expired: true }

export interface Comentario {
  _id: string
  authorName: string
  esMio: boolean
  atSec?: number
  body: string
  parentId?: string
  resolvedAt?: number
  createdAt: number
  editedAt?: number
}

export interface Enlace {
  _id: string
  label: string
  expiresAt: number
  revokedAt?: number
  openCount: number
  lastOpenedAt?: number
  createdAt: number
}

export interface EnlaceNuevo {
  shareLinkId: string
  url: string
  expiresAt: number
}

export interface Miembro {
  _id: string
  name: string
  email: string
  role: Rol
  status: 'active' | 'disabled'
  projectIds: string[]
}

export interface Invitacion {
  _id: string
  email: string
  role: Rol
  projectIds: string[]
  createdAt: number
}

export interface Personas {
  members: Miembro[]
  invitations: Invitacion[]
}

export interface UrlFirmada {
  url: string
  expiresAt: number
}

export interface Datos {
  modo: 'falso' | 'real'
  /** Envuelve la app: en la real, el cliente de Convex y su sesión. */
  Proveedor: ComponentType<{ children: ReactNode }>

  useSesion(): Sesion
  useAccionesSesion(): {
    entrarConGoogle(): Promise<void>
    entrarConCorreo(email: string, password: string, flujo: 'signIn' | 'signUp'): Promise<void>
    salir(): Promise<void>
  }

  useMembresias(): Membresia[] | undefined
  useMisLlamadas(projectId?: string): LlamadaFila[] | undefined
  /** Proyectos de un espacio, para el filtro de la lista y para dar acceso. */
  useProyectos(workspaceId: string | undefined): Proyecto[] | undefined

  useLlamada(interviewId: string): LlamadaDetalle | undefined
  useLlamadaCliente(token: string): LlamadaCliente | undefined
  /** URL firmada de 1 hora para ver un archivo. */
  usePedirUrl(): (mediaId: string, shareToken?: string) => Promise<UrlFirmada>

  useComentarios(interviewId: string): Comentario[] | undefined
  useAccionesComentario(): {
    add(a: { interviewId: string; body: string; atSec?: number; parentId?: string }): Promise<void>
    edit(a: { commentId: string; body: string }): Promise<void>
    remove(a: { commentId: string }): Promise<void>
    resolve(a: { commentId: string; resolved: boolean }): Promise<void>
  }

  useEnlaces(interviewId: string): Enlace[] | undefined
  useAccionesEnlace(): {
    create(a: { interviewId: string; label: string }): Promise<EnlaceNuevo>
    renew(a: { shareLinkId: string }): Promise<void>
    revoke(a: { shareLinkId: string }): Promise<void>
  }

  /** Del espacio elegido. Sin espacio (aún cargando las membresías), undefined. */
  usePersonas(workspaceId: string | undefined): Personas | undefined
  useAccionesPersonas(): {
    invite(a: { email: string; role: RolInvitable; projectIds: string[]; workspaceId?: string }): Promise<void>
    revokeInvitation(a: { invitationId: string }): Promise<void>
    update(a: { memberId: string; role?: Rol; projectIds?: string[]; status?: 'active' | 'disabled' }): Promise<void>
  }
}
