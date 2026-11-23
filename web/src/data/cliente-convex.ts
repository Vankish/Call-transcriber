import { ConvexReactClient } from 'convex/react'

// Solo la dirección pública del despliegue: ninguna clave llega al navegador.
export const cliente = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)
