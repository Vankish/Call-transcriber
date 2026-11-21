// ── Idioma de la web ──────────────────────────────────────────────────────────
//
// El mismo sistema que la app de escritorio (src/i18n.ts): el texto en español
// ES la clave, `t('Comentar en este momento')`, y su inglés vive en `EN`, más
// abajo. Una frase sin traducir sale en español en vez de romper nada, y
// `npm run i18n:check` lista las que faltan.
//
// Es un diccionario aparte del de la app porque es otra compilación: así la web
// no arrastra las 400 frases de la app ni la app las de la web.
//
// Los huecos van entre llaves: `t('Hace {n} días', { n })`.

import { useSyncExternalStore } from 'react'

export type Idioma = 'es' | 'en'

const IDIOMA_KEY = 'ct-web-idioma'

const esIdioma = (v: unknown): v is Idioma => v === 'es' || v === 'en'

/** El del navegador si es español; si no, inglés. Un coach que abre el enlace
 *  por primera vez lo ve en su idioma sin tocar nada. */
const idiomaDelNavegador = (): Idioma =>
  (navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en'

// Se lee al cargar el módulo y no en un efecto: así el primer render ya sale en
// el idioma bueno, sin parpadeo de español a inglés.
let actual: Idioma = (() => {
  try {
    const guardado = localStorage.getItem(IDIOMA_KEY)
    if (esIdioma(guardado)) return guardado
  } catch { /* modo incógnito */ }
  return idiomaDelNavegador()
})()
document.documentElement.lang = actual

const oyentes = new Set<() => void>()

export const getIdioma = () => actual

export function setIdioma(idioma: Idioma) {
  actual = idioma
  try { localStorage.setItem(IDIOMA_KEY, idioma) } catch { /* modo incógnito */ }
  document.documentElement.lang = idioma
  oyentes.forEach((o) => o())
}

/** Para que la raíz vuelva a pintar todo al cambiar de idioma. */
export function useIdioma(): Idioma {
  return useSyncExternalStore(
    (o) => { oyentes.add(o); return () => { oyentes.delete(o) } },
    getIdioma,
  )
}

/** Para fechas y números. */
export const locale = () => (actual === 'en' ? 'en-GB' : 'es-ES')

/** Marca una frase que se traduce más tarde, al pintarla, con `t(variable)`.
 *  No hace nada: existe para que `npm run i18n:check` la encuentre en las
 *  tablas que se definen fuera de un render (papeles, errores). */
export const k = (es: string) => es

export function t(es: string, vars?: Record<string, string | number>): string {
  const texto = actual === 'en' ? (EN[es] ?? es) : es
  if (!vars) return texto
  return texto.replace(/\{(\w+)\}/g, (hueco, clave: string) => (clave in vars ? String(vars[clave]) : hueco))
}

const EN: Record<string, string> = {
}
