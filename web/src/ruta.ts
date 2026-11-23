// ── Rutas ─────────────────────────────────────────────────────────────────────
//
// Cuatro rutas no justifican una dependencia: basta con history.pushState y
// escuchar popstate. Las del contrato son /, /i/{interviewId} y /l/{token};
// /personas es la página de accesos del dueño.
//
// El filtro de proyecto va en la dirección (?proyecto=...) y no en memoria: así
// el botón de atrás lo respeta y un enlace copiado enseña lo mismo.

import { useSyncExternalStore } from 'react'

export type Ruta =
  | { nombre: 'inicio'; proyecto?: string }
  | { nombre: 'llamada'; id: string }
  | { nombre: 'cliente'; token: string }
  | { nombre: 'personas' }
  | { nombre: 'no-existe' }

const oyentes = new Set<() => void>()
window.addEventListener('popstate', () => oyentes.forEach((o) => o()))

export function navegar(a: string, { reemplazar = false } = {}) {
  if (reemplazar) history.replaceState(null, '', a)
  else history.pushState(null, '', a)
  window.scrollTo(0, 0)
  oyentes.forEach((o) => o())
}

function leer(): string {
  return location.pathname + location.search
}

export function interpretar(dir: string): Ruta {
  const url = new URL(dir, 'http://x')
  const partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (partes.length === 0) return { nombre: 'inicio', proyecto: url.searchParams.get('proyecto') ?? undefined }
  if (partes[0] === 'i' && partes[1]) return { nombre: 'llamada', id: partes[1] }
  if (partes[0] === 'l' && partes[1]) return { nombre: 'cliente', token: partes[1] }
  if (partes[0] === 'personas') return { nombre: 'personas' }
  return { nombre: 'no-existe' }
}

export function useDireccion(): string {
  return useSyncExternalStore((o) => { oyentes.add(o); return () => { oyentes.delete(o) } }, leer)
}
