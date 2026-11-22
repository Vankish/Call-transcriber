// ── Dónde está el despliegue de Convex ───────────────────────────────────────
//
// La dirección es la misma que usa la interfaz, VITE_CONVEX_URL, pero Vite solo
// la incrusta en el código del navegador: main.cjs no pasa por Vite. Por eso
// `vite build` deja además un `dist/cloud-config.json` con ella (ver el plugin
// de vite.config.ts) y aquí se lee de ahí. Así hay una sola fuente: el .env (o
// la variable de entorno) con el que se compila el instalador.
//
// Se busca, por este orden:
//   1. La variable de entorno VITE_CONVEX_URL del proceso (útil para probar).
//   2. dist/cloud-config.json, que es lo que lleva la app instalada.
//   3. En desarrollo (`npm run desktop:dev` no compila dist/), los .env de la
//      raíz del proyecto, igual que haría Vite.
//
// Nunca se le pide a la ventana: si la página pudiera elegir la dirección,
// podría mandar el token de la sesión a otro servidor.

const fs = require('node:fs')
const path = require('node:path')
const { normalizeConvexUrl } = require('./convex-http.cjs')

const KEY = 'VITE_CONVEX_URL'

/** Lee KEY de un .env sencillo (KEY=valor, con o sin comillas). */
function fromDotenv(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?VITE_CONVEX_URL\s*=\s*(.*)\s*$/)
    if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2').trim()
  }
  return null
}

function resolveConvexUrl({ env = process.env, appRoot, isDev = false, readFile = (f) => fs.readFileSync(f, 'utf-8') } = {}) {
  const fromEnv = normalizeConvexUrl(env[KEY])
  if (fromEnv) return fromEnv

  try {
    const cfg = JSON.parse(readFile(path.join(appRoot, 'dist', 'cloud-config.json')))
    const fromDist = normalizeConvexUrl(cfg?.convexUrl)
    if (fromDist) return fromDist
  } catch { /* sin compilar o compilado sin nube */ }

  if (isDev) {
    // El mismo orden de prioridad que Vite: lo más específico gana.
    for (const name of ['.env.development.local', '.env.local', '.env.development', '.env']) {
      try {
        const found = normalizeConvexUrl(fromDotenv(readFile(path.join(appRoot, name))))
        if (found) return found
      } catch { /* no existe */ }
    }
  }
  return null
}

module.exports = { resolveConvexUrl, fromDotenv }
