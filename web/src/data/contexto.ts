import { createContext, useContext } from 'react'
import type { Datos } from './tipos'

// La implementación (falsa o Convex) se decide una vez, en main.tsx, y llega a
// todas las pantallas por aquí. Ninguna pantalla importa falso.ts ni real.ts.
export const DatosContext = createContext<Datos | null>(null)

export function useDatos(): Datos {
  const d = useContext(DatosContext)
  if (!d) throw new Error('Falta <DatosContext.Provider> en main.tsx')
  return d
}
