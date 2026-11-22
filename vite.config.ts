import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// El proceso principal de Electron no pasa por Vite, así que no ve las
// VITE_*. Para que sepa a qué despliegue de Convex conectarse, la compilación
// deja la dirección en dist/cloud-config.json (la lee electron/cloud/convex-url.cjs).
// Es la dirección pública del despliegue, la misma que ya va dentro del código
// de la interfaz: no es ningún secreto.
const cloudConfig = (convexUrl: string): Plugin => ({
  name: 'call-transcriber-cloud-config',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'cloud-config.json',
      source: JSON.stringify({ convexUrl: convexUrl.trim() || null }),
    })
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  return {
    base: './',
    plugins: [react(), cloudConfig(env.VITE_CONVEX_URL ?? '')],
  }
})
