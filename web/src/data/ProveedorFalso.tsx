import type { ReactNode } from 'react'

/** Sin backend no hay nada que envolver: el estado falso vive en su módulo. */
export function ProveedorFalso({ children }: { children: ReactNode }) {
  return <>{children}</>
}
