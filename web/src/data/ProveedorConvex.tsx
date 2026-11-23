import type { ReactNode } from 'react'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { cliente } from './cliente-convex'

/** Cliente de Convex con la sesión de Convex Auth (Google o correo). */
export function ProveedorConvex({ children }: { children: ReactNode }) {
  return <ConvexAuthProvider client={cliente}>{children}</ConvexAuthProvider>
}
