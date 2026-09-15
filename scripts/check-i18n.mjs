// Comprueba que toda frase que pasa por el traductor tiene su versión en inglés.
//
// Sin esto, una frase nueva sin traducir no rompe nada: sale en español en la
// interfaz inglesa y nadie se da cuenta hasta que la ve un usuario. Mira dos
// sitios, porque hay dos traductores:
//
//   · src/          t('...') y k('...')  contra EN de src/i18n.ts
//   · electron/     tr('...') y kr('...') contra EN de electron/i18n.cjs
//
// También avisa de las traducciones que ya no usa nadie, para que la tabla no
// se llene de frases muertas.
//
// Uso: npm run i18n:check   (sale con código 1 si falta alguna)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)

// Un literal de JS entre comillas simples o dobles, con escapes.
const LITERAL = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")`
// El literal es código nuestro, así que evaluarlo es la forma más fiable de
// resolver los escapes (\n, \') igual que lo hará el navegador.
const valor = (lit) => Function(`return ${lit}`)()

function archivos(dir, extensiones) {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) return archivos(ruta, extensiones)
    return extensiones.some((e) => nombre.endsWith(e)) ? [ruta] : []
  })
}

function clavesUsadas(rutas, funciones) {
  const re = new RegExp(String.raw`\b(?:${funciones.join('|')})\(\s*${LITERAL}`, 'g')
  const usadas = new Map()
  for (const ruta of rutas) {
    const texto = readFileSync(ruta, 'utf8')
    for (const m of texto.matchAll(re)) {
      const clave = valor(m[1])
      if (!usadas.has(clave)) usadas.set(clave, relative(raiz, ruta))
    }
  }
  return usadas
}

/** Los pares 'es': 'en' del objeto EN de src/i18n.ts, sin compilar TypeScript. */
function diccionarioTs(ruta) {
  const texto = readFileSync(ruta, 'utf8')
  const cuerpo = texto.slice(texto.indexOf('const EN'))
  const re = new RegExp(String.raw`^\s*${LITERAL}\s*:\s*${LITERAL},?\s*$`, 'gm')
  return new Map([...cuerpo.matchAll(re)].map((m) => [valor(m[1]), valor(m[2])]))
}

let fallos = 0

function informe(nombre, usadas, diccionario, extras = []) {
  const faltan = [...usadas].filter(([clave]) => !diccionario.has(clave))
  const muertas = [...diccionario.keys()].filter((clave) => !usadas.has(clave) && !extras.includes(clave))
  console.log(`\n${nombre}: ${usadas.size} frases, ${diccionario.size} traducciones`)
  for (const [clave, donde] of faltan) console.log(`  FALTA  ${JSON.stringify(clave)}  (${donde})`)
  for (const clave of muertas) console.log(`  SOBRA  ${JSON.stringify(clave)}`)
  fallos += faltan.length
}

// ── Interfaz ─────────────────────────────────────────────────────────────────
const usadasUi = clavesUsadas(archivos(join(raiz, 'src'), ['.ts', '.tsx']), ['t', 'k'])
// Las notas de cada proveedor llegan del proceso principal y se traducen al
// pintarlas en Configuración, así que también son frases de la interfaz.
const providers = readFileSync(join(raiz, 'electron', 'providers.cjs'), 'utf8')
for (const m of providers.matchAll(new RegExp(String.raw`\b(note|label):\s*${LITERAL}`, 'g'))) {
  const clave = valor(m[2])
  // Las notas son siempre texto nuestro. De las etiquetas, casi todas son marcas
  // ("Groq", "Anthropic (Claude)"); solo cuentan las que llevan una aclaración
  // en minúsculas, tipo "Otro (personalizado)".
  if (m[1] === 'note' || /\([a-záéíóúñ]+\)/.test(clave)) {
    if (!usadasUi.has(clave)) usadasUi.set(clave, 'electron/providers.cjs')
  }
}
informe('Interfaz (src/i18n.ts)', usadasUi, diccionarioTs(join(raiz, 'src', 'i18n.ts')))

// ── Proceso principal ────────────────────────────────────────────────────────
const usadasMain = clavesUsadas(archivos(join(raiz, 'electron'), ['.cjs']).filter((r) => !r.endsWith('i18n.cjs')), ['tr', 'kr'])
const { EN: enMain } = require(join(raiz, 'electron', 'i18n.cjs'))
informe('Proceso principal (electron/i18n.cjs)', usadasMain, new Map(Object.entries(enMain)))

if (fallos) {
  console.log(`\n${fallos} frase(s) sin traducir.`)
  process.exit(1)
}
console.log('\nTodo traducido.')
