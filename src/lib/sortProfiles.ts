// ── Orden de las listas de perfiles ──────────────────────────────────────────
//
// Vive aparte de App.tsx para poder probarlo sin montar el componente. Los tipos
// son mínimos a propósito (solo los campos que se miran), así que no hace falta
// importar Candidate ni Interview y no hay dependencia cruzada.

export type ProfileSort = 'recent' | 'oldest' | 'name'

export const PROFILE_SORT_LABELS: Record<ProfileSort, string> = {
  recent: 'Recientes primero',
  oldest: 'Antiguos primero',
  name: 'Nombre (A-Z)',
}

export const isProfileSort = (v: unknown): v is ProfileSort =>
  v === 'recent' || v === 'oldest' || v === 'name'

type SortableProfile = { id: string; name: string; createdAt: string }
type DatedInterview = { candidateId: string; createdAt: string }

const time = (iso: string): number => {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** Fecha de la última entrevista de cada perfil, indexada por id de perfil. */
export function lastInterviewMap(interviews: DatedInterview[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const iv of interviews) {
    const t = time(iv.createdAt)
    if (t) m.set(iv.candidateId, Math.max(m.get(iv.candidateId) ?? 0, t))
  }
  return m
}

/** Lo último que ha pasado con un perfil: o se acaba de crear, o se le acaba de
 *  entrevistar. Ordenar solo por fecha de alta dejaría abajo a alguien dado de
 *  alta hace un mes y entrevistado ayer, que es justo a quien estás buscando. */
export function profileActivity(c: SortableProfile, lastAt: Map<string, number>): number {
  return Math.max(time(c.createdAt), lastAt.get(c.id) ?? 0)
}

/** Devuelve una copia ordenada; nunca toca el array recibido.
 *
 *  Los perfiles de antes de que existiera `createdAt` y sin entrevistas valen 0:
 *  caen al fondo en "Recientes" y encabezan "Antiguos", que es donde tocan. El
 *  desempate por nombre evita que dos perfiles de la misma fecha vayan bailando
 *  de sitio entre renders. */
export function sortProfiles<T extends SortableProfile>(
  list: T[], sort: ProfileSort, lastAt: Map<string, number>,
): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  if (sort === 'name') return [...list].sort(byName)
  return [...list].sort((a, b) => {
    const av = profileActivity(a, lastAt)
    const bv = profileActivity(b, lastAt)
    const diff = sort === 'oldest' ? av - bv : bv - av
    return diff !== 0 ? diff : byName(a, b)
  })
}
