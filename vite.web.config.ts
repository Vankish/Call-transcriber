import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// La web de coaches y clientes es otra compilacion, separada de la app de
// escritorio: tiene su propio index.html en web/ y sale a dist-web/, para que
// electron-builder (que empaqueta dist/) nunca la meta en el instalador.
//
// `base: '/'` y no './' como la app: la web tiene rutas profundas
// (/i/{id}, /l/{token}) y con rutas relativas los .js se pedirian a
// /i/assets/... y no cargaria nada.

/** Con backend de verdad, el video de prueba (web/public/demo) no se publica:
 *  pesa ~20 MB y solo sirve a los datos falsos. */
function sinDemoEnProduccion(conBackend: boolean): Plugin {
  return {
    name: 'sin-demo-en-produccion',
    apply: 'build',
    closeBundle() {
      if (conBackend) rmSync(resolve(__dirname, 'dist-web', 'demo'), { recursive: true, force: true })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_')
  return {
    root: 'web',
    base: '/',
    // Las .env viven en la raiz, como las de la app. Solo VITE_* llega al navegador.
    envDir: '..',
    plugins: [react(), sinDemoEnProduccion(Boolean(env.VITE_CONVEX_URL))],
    build: {
      outDir: '../dist-web',
      emptyOutDir: true,
    },
    server: { port: 5180 },
    preview: { port: 5181, strictPort: true },
  }
})
