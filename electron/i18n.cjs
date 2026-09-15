// ── Idioma en el proceso principal ───────────────────────────────────────────
//
// Dos cosas distintas que conviene no mezclar:
//
//  1. El idioma de la INTERFAZ: el de los errores, los diálogos y la barra de
//     progreso. Es el que ha elegido el usuario en Configuración (o el de
//     Windows, si no ha elegido nada). Funciona igual que src/i18n.ts: la frase
//     en español es la clave y `EN` tiene su traducción.
//
//  2. El idioma de la ENTREVISTA: el de los resúmenes y las etiquetas de quién
//     habla. No depende de la interfaz: una entrevista en inglés da un resumen en
//     inglés aunque la app esté en español. Eso lo decide `detectarIdioma`.

let actual = 'es'

/** Toma el idioma de config.json; si no hay, el de Windows. */
function usarIdiomaDe(config) {
  const guardado = config && config.language
  if (guardado === 'es' || guardado === 'en') { actual = guardado; return }
  try {
    // Se pide aquí y no arriba del todo para que `npm run i18n:check` pueda leer
    // este archivo con Node a secas, sin Electron.
    const { app } = require('electron')
    actual = String(app.getLocale() || '').toLowerCase().startsWith('es') ? 'es' : 'en'
  } catch { /* antes de app.ready no hay locale: se queda como estaba */ }
}

const getIdioma = () => actual

function tr(es, vars) {
  const texto = actual === 'en' ? (EN[es] ?? es) : es
  if (!vars) return texto
  return texto.replace(/\{(\w+)\}/g, (hueco, k) => (k in vars ? String(vars[k]) : hueco))
}

/** Marca una frase que se traduce más tarde con `tr(variable)`. No hace nada. */
const kr = (es) => es

// ── Idioma de una transcripción ──────────────────────────────────────────────
//
// Contar palabras muy frecuentes basta y sobra: en una conversación de minutos
// "the/and/you" o "que/de/pero" aparecen cientos de veces. Una palabra que
// comparten varios idiomas ("de", "a", "no") puntúa menos que una exclusiva, para
// que el portugués no se confunda con el español por culpa de "que".
//
// Se devuelve null cuando no hay texto suficiente para fiarse; quien pregunta
// decide entonces qué hacer (normalmente, usar el idioma de la interfaz).
const PALABRAS = {
  es: 'de la que el en y los se del las un por con no una su para es al lo como más pero sus le ya o este sí porque esta son entre cuando muy sin sobre también me hasta hay donde desde todo nos todos les ni eso esto yo usted bueno pues vale estoy tengo trabajo empresa experiencia hemos',
  en: 'the and to of a in is you that it for was on are with as i they be at have this from or had by not but what we can were all there when your how an which do their if will about then them would so these like has more could did my no than been who its now just know think yeah okay really work company experience',
  fr: 'le la les et est un une des du que qui pas je vous nous il elle ce dans pour sur avec au mais ou donc très oui travail entreprise',
  de: 'der die das und ist nicht ich sie es ein eine zu den mit auf für von dem sich auch wir aber ja arbeit',
  pt: 'de que o a e do da em um uma para com não os no na se por mais as dos como mas foi ao ele das tem você sim muito trabalho empresa',
  it: 'il di che e la per un una non sono è del della in con si ma lo gli le da ho anche molto sì lavoro azienda',
}

const PESO = (() => {
  const cuantos = new Map()
  for (const lista of Object.values(PALABRAS)) {
    for (const p of new Set(lista.split(' '))) cuantos.set(p, (cuantos.get(p) || 0) + 1)
  }
  const pesos = {}
  for (const [idioma, lista] of Object.entries(PALABRAS)) {
    pesos[idioma] = new Map([...new Set(lista.split(' '))].map((p) => [p, 1 / cuantos.get(p)]))
  }
  return pesos
})()

function detectarIdioma(texto) {
  const limpio = String(texto || '')
    .slice(0, 20000)                          // de sobra para decidir, y barato
    .replace(/\[[^\]]*\]/g, ' ')              // etiquetas y marcas de tiempo
    .toLowerCase()
  const palabras = limpio.match(/[a-záéíóúüñàèìòùâêîôûãõçäöß]+/g) || []
  const puntos = Object.fromEntries(Object.keys(PESO).map((i) => [i, 0]))
  let encontradas = 0
  for (const p of palabras) {
    let alguna = false
    for (const idioma of Object.keys(PESO)) {
      const w = PESO[idioma].get(p)
      if (w) { puntos[idioma] += w; alguna = true }
    }
    if (alguna) encontradas++
  }
  if (encontradas < 8) return null
  const [primero, segundo] = Object.entries(puntos).sort((a, b) => b[1] - a[1])
  // Sin una ventaja clara es más honesto no decidir que acertar a medias.
  return primero[1] >= segundo[1] * 1.3 ? primero[0] : null
}

/** Etiquetas por defecto de quién habla, para cuando no se sabe el nombre. Solo
 *  hay dos juegos: para cualquier idioma que no sea español, inglés. */
function etiquetasPorDefecto(idioma) {
  return idioma === 'es'
    ? { entrevistador: 'Entrevistador', candidato: 'Candidato', hablante: 'Hablante' }
    : { entrevistador: 'Interviewer', candidato: 'Candidate', hablante: 'Speaker' }
}

// Nombre del idioma dentro de un prompt escrito en español: "Responde en inglés."
const NOMBRE_EN_PROMPT = { es: 'español', en: 'inglés', fr: 'francés', de: 'alemán', pt: 'portugués', it: 'italiano' }
const nombreEnPrompt = (idioma) => NOMBRE_EN_PROMPT[idioma] || 'español'

const EN = {
  // Página que abre el enlace de acceso (solo con nube)
  'Autenticando...': 'Signing in...',
  'Iniciando sesión...': 'Signing in...',
  'Puedes cerrar esta ventana.': 'You can close this window.',
  'Sesión iniciada': 'Signed in',
  'Iniciar sesión': 'Sign in',

  // Audio y ffmpeg
  'ffmpeg no pudo iniciarse: {msg}': 'ffmpeg could not start: {msg}',
  'La conversión con ffmpeg falló: {msg}': 'ffmpeg conversion failed: {msg}',
  'ffmpeg no pudo iniciarse (fragmento {n}): {msg}': 'ffmpeg could not start (chunk {n}): {msg}',
  'ffmpeg falló al cortar el fragmento {n}: {msg}': 'ffmpeg failed cutting chunk {n}: {msg}',
  'No se pudo leer la duración del audio.': 'Could not read the audio length.',
  'ffmpeg falló generando el audio de prueba': 'ffmpeg failed to generate the test audio',

  // Motores de IA
  'Falta la API key de {servicio}. Configúrala en Configuración → Motores de IA.': 'The {servicio} API key is missing. Add it in Settings → AI engines.',
  'Falta indicar el modelo de {servicio}. Configúralo en Configuración → Motores de IA.': 'No {servicio} model is set. Choose one in Settings → AI engines.',
  'tu servicio': 'your service',
  'Error de {servicio} ({codigo}): {detalle}': '{servicio} error ({codigo}): {detalle}',
  'sin detalle': 'no details',
  'No hay URL configurada para el servicio de transcripción.': 'No URL is set for the transcription service.',
  'No hay URL configurada para el servicio de resumen.': 'No URL is set for the summary service.',
  '{servicio} agotó los {tokens} tokens de respuesta antes de escribir nada (el modelo los gastó razonando). Hace falta menos texto por petición.': '{servicio} used up its {tokens} response tokens before writing anything (the model spent them reasoning). Less text per request is needed.',
  'respuesta vacía': 'empty response',
  'Conexión correcta': 'Connection OK',

  // Resumen
  'el modelo devolvió una respuesta vacía': 'the model returned an empty response',
  'No se pudieron extraer notas de un fragmento de la transcripción: {motivo}': 'Could not extract notes from part of the transcript: {motivo}',
  'No se pudo condensar la transcripción: el modelo de resumen no devolvió notas de ningún fragmento. Prueba con otro modelo en Configuración → Motores de IA.': 'Could not condense the transcript: the summary model returned no notes for any part. Try another model in Settings → AI engines.',
  'Preparando el resumen': 'Preparing the summary',
  'Redactando el informe': 'Writing the report',
  'Leyendo la conversación': 'Reading the conversation',
  'Analizando la conversación': 'Analysing the conversation',
  'Compactando notas · bloque {n} de {total}': 'Condensing notes · block {n} of {total}',
  'Analizando la conversación · fragmento {n} de {total}': 'Analysing the conversation · part {n} of {total}',

  // Diálogos del sistema
  'Guardar PDF': 'Save PDF',
  'exportacion': 'export',
  'Importar grabación de audio': 'Import audio recording',
  'Todos los archivos': 'All files',
}

module.exports = { usarIdiomaDe, getIdioma, tr, kr, detectarIdioma, etiquetasPorDefecto, nombreEnPrompt, EN }
