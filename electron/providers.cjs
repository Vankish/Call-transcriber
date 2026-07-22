// ── Capa de proveedores de IA ────────────────────────────────────────────────
//
// La app NO conoce a ningún proveedor concreto. Conoce dos contratos:
//
//   transcribe(provider, audio)  → { text, segments }
//   chat(provider, prompts)      → texto
//
// Cada proveedor se describe con datos (URL base, dialecto, modelos, límites) y
// cada "dialecto" es un traductor pequeño. La mayoría del mercado habla el
// dialecto de OpenAI — Groq incluido, de ahí el /openai/v1 de su URL — así que
// con un solo traductor ya quedan cubiertos casi todos. Los que hablan distinto
// (Deepgram, Anthropic) tienen el suyo.
//
// Añadir un proveedor nuevo del dialecto OpenAI = una fila en la tabla de abajo.
// Y el usuario siempre puede elegir "custom" y escribir su propia URL, así que
// no depende de que su servicio esté en la lista.

const DEFAULT_MAX_BYTES = 24 * 1024 * 1024

// ── Catálogo de transcripción (audio → texto) ────────────────────────────────
const STT_PRESETS = [
  {
    id: 'groq',
    label: 'Groq',
    note: 'Gratis, sin tarjeta',
    consoleUrl: 'https://console.groq.com',
    keyHint: 'gsk_...',
    dialect: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['whisper-large-v3', 'whisper-large-v3-turbo'],
    maxBytes: DEFAULT_MAX_BYTES,
    diarize: true,   // Groq acepta el parámetro `diarize`, que es invento suyo.
    segments: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    note: 'Mismo modelo Whisper que Groq',
    consoleUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...',
    dialect: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'],
    maxBytes: DEFAULT_MAX_BYTES,
    diarize: false,
    segments: true,
    // Los modelos gpt-4o-* no admiten verbose_json, así que no devuelven marcas
    // de tiempo. Sin ellas no se puede separar hablantes por pistas.
    noSegmentModels: ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe'],
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs (Scribe)',
    note: 'Muy bueno en español, hasta 32 hablantes',
    consoleUrl: 'https://elevenlabs.io/app/settings/api-keys',
    dialect: 'elevenlabs',
    baseUrl: 'https://api.elevenlabs.io/v1',
    models: ['scribe_v2', 'scribe_v1'],
    maxBytes: 1024 * 1024 * 1024,
    diarize: true,
    segments: true,
  },
  {
    id: 'deepgram',
    label: 'Deepgram',
    note: 'Separa hablantes de verdad, no alucina en silencios',
    consoleUrl: 'https://console.deepgram.com',
    dialect: 'deepgram',
    baseUrl: 'https://api.deepgram.com/v1',
    models: ['nova-3', 'nova-2'],
    maxBytes: 1024 * 1024 * 1024,
    diarize: true,
    segments: true,
  },
  {
    id: 'custom',
    label: 'Otro (personalizado)',
    note: 'Escribe tú la URL: tu propio servidor, Ollama, lo que sea',
    dialect: 'openai',
    baseUrl: '',
    models: [],
    maxBytes: DEFAULT_MAX_BYTES,
    diarize: false,
    segments: true,
  },
]

// ── Catálogo de resumen (texto → informe) ────────────────────────────────────
const LLM_PRESETS = [
  {
    id: 'groq',
    label: 'Groq',
    note: 'Gratis, sin tarjeta',
    consoleUrl: 'https://console.groq.com',
    keyHint: 'gsk_...',
    dialect: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    consoleUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...',
    dialect: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    consoleUrl: 'https://console.anthropic.com',
    keyHint: 'sk-ant-...',
    dialect: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    note: 'Una clave, acceso a casi cualquier modelo',
    consoleUrl: 'https://openrouter.ai/keys',
    dialect: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-5', 'google/gemini-2.5-pro', 'meta-llama/llama-3.3-70b-instruct'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    dialect: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat'],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    note: 'En tu PC: nada sale de aquí',
    dialect: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.1', 'qwen2.5'],
    noKey: true,
  },
  {
    id: 'custom',
    label: 'Otro (personalizado)',
    note: 'Escribe tú la URL',
    dialect: 'openai',
    baseUrl: '',
    models: [],
  },
]

const findPreset = (list, id) => list.find((p) => p.id === id) || list[list.length - 1]

// ── Resolución de configuración ──────────────────────────────────────────────
// Convierte lo guardado en config.json en un objeto listo para usar. Acepta el
// formato antiguo (groqApiKey / transcriptionModel / summaryModel) para que a
// quien ya tenía la app configurada no se le rompa nada al actualizar.

// Los proveedores retiran modelos cada pocos meses, así que un nombre guardado
// hace tiempo puede haber dejado de existir (le pasó a distil-whisper-large-v3-en).
// Al migrar desde el formato antiguo, un nombre desconocido se sustituye por el
// modelo por defecto en vez de dejar que reviente contra la API.
//
// OJO: esto solo aplica a la migración. Un modelo escrito a mano por el usuario
// en Ajustes se respeta tal cual — para eso el campo es libre, y para eso está
// el botón "Probar conexión".
function migrateLegacyModel(preset, model) {
  if (!model) return preset.models[0] || ''
  return preset.models.includes(model) ? model : (preset.models[0] || model)
}

/** Traduce el config.json al formato nuevo {stt, llm}. Si ya está en el formato
 *  nuevo lo devuelve tal cual. Es el único sitio donde vive la migración. */
function migrateConfig(config) {
  const groqStt = findPreset(STT_PRESETS, 'groq')
  const groqLlm = findPreset(LLM_PRESETS, 'groq')
  return {
    stt: config.stt || {
      provider: 'groq',
      apiKey: config.groqApiKey || '',
      model: migrateLegacyModel(groqStt, config.transcriptionModel),
    },
    llm: config.llm || {
      provider: 'groq',
      apiKey: config.groqApiKey || '',
      model: migrateLegacyModel(groqLlm, config.summaryModel),
    },
  }
}

function resolveStt(config) {
  const raw = migrateConfig(config).stt
  const preset = findPreset(STT_PRESETS, raw.provider)
  const model = raw.model || preset.models[0] || ''
  const noSegments = (preset.noSegmentModels || []).includes(model)
  return {
    id: raw.provider || 'groq',
    label: raw.provider === 'custom' ? (raw.label || 'tu servicio') : preset.label,
    dialect: raw.dialect || preset.dialect,
    baseUrl: String(raw.baseUrl || preset.baseUrl || '').replace(/\/+$/, ''),
    apiKey: raw.apiKey || '',
    model,
    maxBytes: preset.maxBytes || DEFAULT_MAX_BYTES,
    canDiarize: !!preset.diarize,
    canSegment: !!preset.segments && !noSegments,
  }
}

function resolveLlm(config) {
  const raw = migrateConfig(config).llm
  const preset = findPreset(LLM_PRESETS, raw.provider)
  return {
    id: raw.provider || 'groq',
    label: raw.provider === 'custom' ? (raw.label || 'tu servicio') : preset.label,
    dialect: raw.dialect || preset.dialect,
    baseUrl: String(raw.baseUrl || preset.baseUrl || '').replace(/\/+$/, ''),
    apiKey: raw.apiKey || '',
    model: raw.model || preset.models[0] || '',
    needsKey: !preset.noKey,
  }
}

// ── Utilidades comunes ───────────────────────────────────────────────────────

async function readError(response, label) {
  let detail = ''
  try { detail = (await response.text()).slice(0, 500) } catch { /* respuesta ilegible */ }
  return new Error(`Error de ${label} (${response.status}): ${detail || 'sin detalle'}`)
}

function withTimeout(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

// Al reconstruir segmentos a partir de palabras sueltas hay que cortar también
// por silencio, no solo por cambio de hablante. Si no, una pista donde habla una
// sola persona (la del audio de sistema) colapsa en UN segmento que abarca de la
// primera palabra a la última, silencios incluidos — y entonces el cruce entre
// pistas cree que esa persona habló todo el rato y descarta la voz del micro.
const GAP_SPLIT_SEC = 0.8

const startsNewSegment = (current, speaker, start) =>
  !current || current.speaker !== speaker || (start ?? 0) - (current.end ?? 0) > GAP_SPLIT_SEC

const mimeForExt = (ext) => ({
  mp3: 'audio/mpeg', wav: 'audio/wav', webm: 'audio/webm',
  m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac',
}[ext] || 'audio/mpeg')

// ── Transcripción ────────────────────────────────────────────────────────────
// Devuelve siempre la misma forma, hable el proveedor el dialecto que hable:
//   { text, segments: [{ start, end, text, speaker? }] }

async function transcribe(provider, { buffer, fileName, language }) {
  if (!provider.baseUrl) throw new Error('No hay URL configurada para el servicio de transcripción.')
  if (provider.dialect === 'deepgram') return transcribeDeepgram(provider, { buffer, fileName, language })
  if (provider.dialect === 'elevenlabs') return transcribeElevenLabs(provider, { buffer, fileName, language })
  return transcribeOpenAiCompatible(provider, { buffer, fileName, language })
}

// ElevenLabs Scribe devuelve palabra a palabra (no frases), con el hablante en
// cada palabra. Se agrupan en tandas del mismo hablante para obtener segmentos
// equivalentes a los de los demás proveedores.
async function transcribeElevenLabs(provider, { buffer, fileName, language }) {
  const ext = (fileName.split('.').pop() || 'mp3').toLowerCase()
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: mimeForExt(ext) }), fileName)
  form.append('model_id', provider.model)
  form.append('timestamps_granularity', 'word')
  // Viene activado por defecto y mete marcas tipo (risas) dentro del texto; en
  // una entrevista eso es ruido que luego acaba en el resumen.
  form.append('tag_audio_events', 'false')
  if (provider.canDiarize) form.append('diarize', 'true')
  if (language && language !== 'auto') form.append('language_code', language)

  const t = withTimeout(300000)
  let response
  try {
    response = await fetch(`${provider.baseUrl}/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': provider.apiKey },
      body: form,
      signal: t.signal,
    })
  } finally { t.done() }

  if (!response.ok) throw await readError(response, provider.label)

  const data = await response.json()
  const words = Array.isArray(data.words) ? data.words : []
  const segments = []
  let current = null
  for (const w of words) {
    if (w.type === 'audio_event') continue
    // Los huecos entre palabras vienen como entradas propias y no traen hablante:
    // se pegan al segmento en curso.
    if (w.type === 'spacing') {
      if (current) current.text += w.text ?? ' '
      continue
    }
    // speaker_id puede venir a null; en ese caso se hereda el hablante anterior
    // en vez de perder la palabra.
    const speaker = w.speaker_id ?? current?.speaker
    if (startsNewSegment(current, speaker, w.start)) {
      current = { start: w.start ?? 0, end: w.end ?? 0, text: w.text ?? '', speaker }
      segments.push(current)
    } else {
      current.text += w.text ?? ''
      current.end = w.end ?? current.end
    }
  }
  for (const s of segments) s.text = s.text.trim()
  const clean = segments.filter((s) => s.text)
  // Se devuelven también las palabras sueltas: permiten recortar la voz del otro
  // interlocutor con precisión, sin descartar frases enteras (ver main.cjs).
  const bare = words
    .filter((w) => w.type === 'word' && (w.text || '').trim())
    .map((w) => ({ start: w.start ?? 0, end: w.end ?? 0, text: w.text.trim(), speaker: w.speaker_id ?? undefined }))
  return { text: data.text || clean.map((s) => s.text).join(' '), segments: clean, words: bare }
}

async function transcribeOpenAiCompatible(provider, { buffer, fileName, language }) {
  const ext = (fileName.split('.').pop() || 'mp3').toLowerCase()
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: mimeForExt(ext) }), fileName)
  form.append('model', provider.model)
  if (language && language !== 'auto') form.append('language', language)
  // verbose_json es lo que trae las marcas de tiempo por frase. Sin ellas no hay
  // separación de hablantes por pistas, así que solo se pide a quien lo soporta.
  if (provider.canSegment) form.append('response_format', 'verbose_json')
  // `diarize` es específico de Groq: a los demás no se les manda.
  if (provider.canDiarize) form.append('diarize', 'true')

  const t = withTimeout(120000)
  let response
  try {
    response = await fetch(`${provider.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      body: form,
      signal: t.signal,
    })
  } finally { t.done() }

  if (!response.ok) throw await readError(response, provider.label)

  const data = await response.json()
  const segments = (Array.isArray(data.segments) ? data.segments : []).map((s) => ({
    start: s.start ?? 0,
    end: s.end ?? 0,
    text: (s.text || '').trim(),
    speaker: s.speaker,
    no_speech_prob: s.no_speech_prob,
    avg_logprob: s.avg_logprob,
    compression_ratio: s.compression_ratio,
  }))
  return { text: data.text || segments.map((s) => s.text).join(' '), segments }
}

async function transcribeDeepgram(provider, { buffer, fileName, language }) {
  const ext = (fileName.split('.').pop() || 'mp3').toLowerCase()
  const params = new URLSearchParams({
    model: provider.model,
    smart_format: 'true',
    punctuate: 'true',
    diarize: 'true',
  })
  if (language && language !== 'auto') params.set('language', language)
  else params.set('detect_language', 'true')

  const t = withTimeout(300000)
  let response
  try {
    response = await fetch(`${provider.baseUrl}/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${provider.apiKey}`, 'Content-Type': mimeForExt(ext) },
      body: buffer,
      signal: t.signal,
    })
  } finally { t.done() }

  if (!response.ok) throw await readError(response, provider.label)

  const data = await response.json()
  const alt = data?.results?.channels?.[0]?.alternatives?.[0]
  if (!alt) return { text: '', segments: [] }

  // Con smart_format Deepgram devuelve párrafos ya agrupados por hablante.
  const paragraphs = alt.paragraphs?.paragraphs
  const segments = []
  if (Array.isArray(paragraphs)) {
    for (const p of paragraphs) {
      for (const s of p.sentences || []) {
        segments.push({
          start: s.start ?? 0,
          end: s.end ?? 0,
          text: (s.text || '').trim(),
          speaker: p.speaker !== undefined ? `speaker_${p.speaker}` : undefined,
        })
      }
    }
  } else {
    // Sin párrafos, se agrupan las palabras en tandas del mismo hablante.
    let current = null
    for (const w of alt.words || []) {
      const speaker = w.speaker !== undefined ? `speaker_${w.speaker}` : undefined
      const word = w.punctuated_word || w.word || ''
      if (startsNewSegment(current, speaker, w.start)) {
        current = { start: w.start ?? 0, end: w.end ?? 0, text: word, speaker }
        segments.push(current)
      } else {
        current.text += ' ' + word
        current.end = w.end ?? current.end
      }
    }
  }
  const bare = (alt.words || [])
    .map((w) => ({
      start: w.start ?? 0,
      end: w.end ?? 0,
      text: (w.punctuated_word || w.word || '').trim(),
      speaker: w.speaker !== undefined ? `speaker_${w.speaker}` : undefined,
    }))
    .filter((w) => w.text)
  return { text: alt.transcript || segments.map((s) => s.text).join(' '), segments, words: bare }
}

// ── Resumen / chat ───────────────────────────────────────────────────────────

async function chat(provider, { system, user, temperature = 0.1, maxTokens = 8000 }) {
  if (!provider.baseUrl) throw new Error('No hay URL configurada para el servicio de resumen.')
  if (provider.dialect === 'anthropic') return chatAnthropic(provider, { system, user, temperature, maxTokens })
  return chatOpenAiCompatible(provider, { system, user, temperature, maxTokens })
}

async function chatOpenAiCompatible(provider, { system, user, temperature, maxTokens }) {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  })
  if (!response.ok) throw await readError(response, provider.label)
  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

async function chatAnthropic(provider, { system, user, temperature, maxTokens }) {
  const response = await fetch(`${provider.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      system,
      messages: [{ role: 'user', content: user }],
      temperature,
      max_tokens: maxTokens,
    }),
  })
  if (!response.ok) throw await readError(response, provider.label)
  const data = await response.json()
  return (data.content || []).map((c) => c.text || '').join('') || ''
}

// ── Prueba de conexión (botón "Probar" en Ajustes) ───────────────────────────

async function testLlm(provider) {
  try {
    const out = await chat(provider, { system: 'Responde solo con la palabra OK.', user: 'ping', maxTokens: 16 })
    return { ok: true, detail: out.trim().slice(0, 40) || 'respuesta vacía' }
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) }
  }
}

// Para transcripción se manda medio segundo de silencio: comprueba clave, URL y
// nombre del modelo sin gastar apenas cuota.
async function testStt(provider, silenceBuffer) {
  try {
    await transcribe(provider, { buffer: silenceBuffer, fileName: 'test.mp3', language: 'es' })
    return { ok: true, detail: 'Conexión correcta' }
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) }
  }
}

module.exports = {
  STT_PRESETS,
  LLM_PRESETS,
  migrateConfig,
  resolveStt,
  resolveLlm,
  transcribe,
  chat,
  testLlm,
  testStt,
}
