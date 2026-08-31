// ── Compartir proyectos con un compañero ─────────────────────────────────────
// Ninguna función de este módulo lanza excepciones: la UI del diálogo de
// compartir necesita poder pintar el error sin envolver cada llamada en un
// try/catch propio, así que todo sale como resultado tipado.

import { supabase, isSupabaseConfigured } from './supabase'
import type { DbProjectShare } from './supabase'

export type SharedUser = { id: string; name: string; email: string }

export type ProjectShare = {
  id: string; projectId: string; ownerId: string; ownerName: string
  sharedWithId: string; sharedWithEmail: string; sharedWithName: string
  createdAt: string
}

export type BuscarResultado =
  | { ok: true; user: SharedUser }
  | { ok: false; reason: 'vacio' | 'formato' | 'no-encontrado' | 'eres-tu' | 'error'; message: string }

// Fila tal y como la devuelve el RPC / la tabla profiles.
type FilaUsuario = { id: string; name: string | null; email: string | null }

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const SIN_CONEXION = 'No hay conexión con la nube: entra con tu cuenta para poder compartir'

// Si el perfil todavía no tiene nombre, la parte anterior a la @ es lo más
// parecido a un nombre que se le puede enseñar al usuario.
const nombreDe = (name: string | null | undefined, email: string): string =>
  (name ?? '').trim() || email.split('@')[0]

// snake_case → camelCase, igual que projFromDb/candFromDb en App.tsx. Los dos
// nombres llegan aparte porque no viven en la tabla, sino en profiles.
const shareFromDb = (r: DbProjectShare, name: string, ownerName = ''): ProjectShare => ({
  id: r.id, projectId: r.project_id, ownerId: r.owner_id, ownerName,
  sharedWithId: r.shared_with_id, sharedWithEmail: r.shared_with_email,
  sharedWithName: name, createdAt: r.created_at,
})

export async function buscarUsuarioPorCorreo(email: string): Promise<BuscarResultado> {
  const correo = email.trim().toLowerCase()
  if (!correo) return { ok: false, reason: 'vacio', message: 'Escribe un correo electrónico' }
  if (!RE_CORREO.test(correo)) return { ok: false, reason: 'formato', message: 'Eso no parece un correo electrónico' }
  if (!isSupabaseConfigured) return { ok: false, reason: 'error', message: SIN_CONEXION }

  try {
    // Se busca por RPC y no con un select a profiles porque las políticas de RLS
    // no dejan leer perfiles ajenos: la función va con permisos del servidor.
    const { data, error } = await supabase.rpc('buscar_usuario_por_correo', { p_email: correo })
    if (error) return { ok: false, reason: 'error', message: error.message }

    const filas = (data ?? []) as FilaUsuario[]
    const fila = filas[0]
    if (!fila) return { ok: false, reason: 'no-encontrado', message: 'No hay ninguna cuenta de Call Transcriber con ese correo' }

    // Segunda red por si el RPC no filtró al propio usuario (versión antigua del SQL).
    const yo = (await supabase.auth.getUser()).data.user?.id
    if (yo && yo === fila.id) return { ok: false, reason: 'eres-tu', message: 'Ese eres tú' }

    const correoFila = (fila.email ?? '').trim() || correo
    return { ok: true, user: { id: fila.id, name: nombreDe(fila.name, correoFila), email: correoFila } }
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : 'No se pudo buscar el correo' }
  }
}

export async function listarComparticiones(projectIds?: string[]): Promise<ProjectShare[]> {
  // Filtro vacío = no hay nada que consultar; sin este atajo `.in()` con lista
  // vacía haría un viaje a la red para devolver cero filas.
  if (projectIds && projectIds.length === 0) return []
  if (!isSupabaseConfigured) return []

  try {
    let q = supabase.from('project_shares').select('*').order('created_at', { ascending: true })
    if (projectIds) q = q.in('project_id', projectIds)
    const { data, error } = await q
    if (error) {
      console.error('[sharing] listarComparticiones:', error.message)
      return []
    }

    const filas = (data ?? []) as DbProjectShare[]
    if (filas.length === 0) return []

    // Los nombres se piden en UNA consulta para toda la lista: una por fila
    // multiplicaría las llamadas en proyectos con varios compañeros.
    // Hacen falta los dos lados: el invitado (para la lista de "compartido con"
    // que ve el dueño) y el dueño (para la etiqueta "Compartido por Fulanito"
    // que ve el invitado). La política `profiles_leer` de la migración es la que
    // permite leer estos perfiles ajenos; sin ella la consulta vuelve vacía y se
    // cae al correo, que sigue siendo legible.
    const ids = [...new Set(filas.flatMap(r => [r.shared_with_id, r.owner_id]))]
    const nombres = new Map<string, string>()
    const { data: perfiles, error: errPerfiles } = await supabase
      .from('profiles').select('id,name,email').in('id', ids)
    // Si RLS no deja leer esos perfiles no se rompe la lista: el correo ya
    // identifica a la persona lo suficiente.
    if (errPerfiles) console.error('[sharing] perfiles de comparticiones:', errPerfiles.message)
    else for (const p of (perfiles ?? []) as FilaUsuario[]) {
      nombres.set(p.id, nombreDe(p.name, (p.email ?? '').trim()))
    }

    return filas.map(r => shareFromDb(
      r,
      nombres.get(r.shared_with_id) || r.shared_with_email,
      nombres.get(r.owner_id) || '',
    ))
  } catch (e) {
    console.error('[sharing] listarComparticiones:', e)
    return []
  }
}

export async function compartirProyecto(
  args: { projectId: string; ownerId: string; user: SharedUser },
): Promise<{ ok: true; share: ProjectShare } | { ok: false; message: string }> {
  if (!isSupabaseConfigured) return { ok: false, message: SIN_CONEXION }

  try {
    const { data, error } = await supabase
      .from('project_shares')
      .insert({
        project_id: args.projectId,
        owner_id: args.ownerId,
        shared_with_id: args.user.id,
        shared_with_email: args.user.email,
      })
      .select()
      .single()

    if (error) {
      // El índice único (project_id, shared_with_id) es la defensa real contra
      // compartir dos veces; aquí solo se traduce a algo legible.
      const duplicado = error.code === '23505' || /duplicate/i.test(error.message)
      return { ok: false, message: duplicado ? 'Esa persona ya tiene acceso a este proyecto' : error.message }
    }

    return { ok: true, share: shareFromDb(data as DbProjectShare, args.user.name) }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'No se pudo compartir el proyecto' }
  }
}

export async function dejarDeCompartir(shareId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isSupabaseConfigured) return { ok: false, message: SIN_CONEXION }

  try {
    const { error } = await supabase.from('project_shares').delete().eq('id', shareId)
    if (error) return { ok: false, message: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'No se pudo retirar el acceso' }
  }
}
