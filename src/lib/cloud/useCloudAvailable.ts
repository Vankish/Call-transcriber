import { useEffect, useState } from 'react'

/**
 * ¿Esta compilación tiene nube? Solo si se hizo con VITE_CONVEX_URL: sin ella,
 * App.tsx no enseña la pestaña "Nube" y nada cambia respecto a antes.
 */
export function useCloudAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let alive = true
    void window.desktopApp?.cloudStatus?.()
      .then(s => { if (alive) setAvailable(!!s?.configured) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return available
}
