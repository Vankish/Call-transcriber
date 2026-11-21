import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DatosContext } from './data/contexto'
import type { Datos } from './data/tipos'
import { App } from './App'
import './web.css'

// Con VITE_CONVEX_URL vacía la web funciona con datos inventados, sin red: para
// trabajar en las pantallas y sacar capturas sin backend. Se carga solo la
// implementación que toca, para que la falsa no viaje en la web de verdad.
async function arrancar() {
  const { datos }: { datos: Datos } = import.meta.env.VITE_CONVEX_URL
    ? await import('./data/real')
    : await import('./data/falso')
  const { Proveedor } = datos
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <DatosContext.Provider value={datos}>
        <Proveedor>
          <App />
        </Proveedor>
      </DatosContext.Provider>
    </StrictMode>,
  )
}

void arrancar()
