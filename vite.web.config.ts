import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// La web de coaches y clientes es otra compilacion, separada de la app de
// escritorio: tiene su propio index.html en web/ y sale a dist-web/, para que
// electron-builder (que empaqueta dist/) nunca la meta en el instalador.
//
// `base: '/'` y no './' como la app: la web tiene rutas profundas
// (/i/{id}, /l/{token}) y con rutas relativas los .js se pedirian a
// /i/assets/... y no cargaria nada.
export default defineConfig({
  root: 'web',
  base: '/',
  // Solo VITE_CONVEX_URL llega al navegador; el resto de variables no.
  envDir: '..',
  plugins: [react()],
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
  },
  server: { port: 5180 },
  preview: { port: 5181 },
})
