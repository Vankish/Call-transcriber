// ── Compresión del vídeo antes de subirlo ────────────────────────────────────
//
// Grabar vídeo largo ya satura algunos PC, así que recomprimir no puede ser una
// segunda carga igual de pesada. Las reglas, en orden:
//
//  1. El audio no se toca: un mp3 o un webm opus de una hora son 30-60 MB.
//  2. Si el vídeo ya pesa poco por hora (umbral `ASIS_MB_PER_HOUR`), se sube tal
//     cual. Recodificar para ahorrar un 20 % no compensa la CPU que cuesta.
//  3. Si hay que recodificar, primero el codificador de la tarjeta gráfica
//     (NVIDIA, Intel o AMD): casi no usa CPU. Solo si no hay ninguno que funcione,
//     libx264 con 2 hilos y el proceso en prioridad baja, para que Windows le dé
//     la CPU solo cuando nadie más la quiere.
//  4. Nunca durante una grabación: la cola mata el ffmpeg si empieza una y lo
//     repite al acabar.
//
// El original no se toca nunca: la salida es un temporal que la cola borra al
// terminar de subirlo.

const os = require('node:os')
const fsp = require('node:fs/promises')
const { spawn } = require('node:child_process')

// Objetivo: 720p a unos 350 MB/hora (≈ 800 kbit/s en total). Para una pantalla
// de videollamada (caras pequeñas, texto, poco movimiento) se lee bien y deja
// una hora de llamada en lo que antes eran 10-15 minutos.
const TARGET_HEIGHT = 720
const VIDEO_KBPS = 700
const VIDEO_MAX_KBPS = 1000
const AUDIO_KBPS = 96
// Por debajo de esto ya está dentro (o cerca) del objetivo de 200-500 MB/hora.
const ASIS_MB_PER_HOUR = 550

const HW_ENCODERS = ['h264_nvenc', 'h264_qsv', 'h264_amf']

function runFfmpeg(ffmpegPath, args, { signal, lowPriority = false, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true })
    if (lowPriority) {
      // IDLE en Windows: solo corre en los huecos que deja el resto del sistema.
      try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_LOW) } catch { /* sin permiso: sigue normal */ }
    }
    let stderr = ''
    proc.stderr.on('data', (d) => {
      const s = d.toString()
      stderr = (stderr + s).slice(-8000)
      onStderr?.(s)
    })
    const onAbort = () => { try { proc.kill('SIGKILL') } catch { /* ya terminó */ } }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    proc.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err) })
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) {
        const err = new Error('compresión detenida')
        err.name = 'AbortError'
        reject(err)
      } else if (code === 0) resolve({ stderr, pid: proc.pid })
      else reject(new Error(`ffmpeg salió con ${code}: ${stderr.slice(-300)}`))
    })
  })
}

/** Duración (s), alto del vídeo y códec, leyendo la cabecera con `ffmpeg -i`. */
async function probe(ffmpegPath, filePath) {
  // Sin archivo de salida, ffmpeg siempre "falla"; lo que interesa va en su stderr.
  const full = await probeFull(ffmpegPath, filePath)
  const d = full.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const durationSec = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null
  const v = full.match(/Stream #[^\n]*Video:\s*(\w+)[^\n]*?(\d{2,5})x(\d{2,5})/)
  return {
    durationSec: durationSec && durationSec > 0 ? durationSec : null,
    hasVideo: !!v,
    videoCodec: v ? v[1] : null,
    width: v ? Number(v[2]) : null,
    height: v ? Number(v[3]) : null,
  }
}

function probeFull(ffmpegPath, filePath) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', filePath], { windowsHide: true })
    let out = ''
    proc.stderr.on('data', (d) => { out += d.toString() })
    proc.on('error', () => resolve(out))
    proc.on('close', () => resolve(out))
  })
}

/**
 * Qué codificador por hardware funciona de verdad en este PC. `-encoders` los
 * lista todos aunque no haya tarjeta (el ffmpeg de ffmpeg-static trae los tres),
 * así que se prueba cada uno con un segundo de vídeo sintético. Devuelve el
 * primero que arranca, o null. Se cachea: el hardware no cambia entre subidas.
 */
let encoderCache = null
async function detectHardwareEncoder(ffmpegPath, { candidates = HW_ENCODERS } = {}) {
  if (encoderCache !== null) return encoderCache || null
  let listed = ''
  try {
    listed = (await probeOutput(ffmpegPath, ['-hide_banner', '-encoders'])).toLowerCase()
  } catch { listed = '' }
  for (const enc of candidates) {
    if (!listed.includes(enc)) continue
    try {
      await runFfmpeg(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30', '-t', '1',
        '-c:v', enc, '-f', 'null', '-',
      ])
      encoderCache = enc
      return enc
    } catch { /* este no: el siguiente */ }
  }
  encoderCache = ''
  return null
}

function probeOutput(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true })
    let out = ''
    proc.stdout.on('data', (d) => { out += d.toString() })
    proc.on('error', reject)
    proc.on('close', () => resolve(out))
  })
}

/**
 * Decide qué hacer con un archivo antes de subirlo.
 * → { action: 'as-is' | 'transcode', reason, mbPerHour }
 */
function decide({ kind, bytes, durationSec, height }) {
  if (kind !== 'video') return { action: 'as-is', reason: 'audio', mbPerHour: null }
  if (!durationSec) {
    // Sin duración no se sabe si pesa mucho por hora. Un vídeo pequeño se sube
    // tal cual; uno grande se comprime igualmente porque el riesgo es subir 2 GB.
    return bytes < 150 * 1024 * 1024
      ? { action: 'as-is', reason: 'small-unknown-duration', mbPerHour: null }
      : { action: 'transcode', reason: 'large-unknown-duration', mbPerHour: null }
  }
  const mbPerHour = bytes / 1048576 / (durationSec / 3600)
  if (mbPerHour <= ASIS_MB_PER_HOUR && (!height || height <= 1080)) {
    return { action: 'as-is', reason: 'already-small', mbPerHour }
  }
  return { action: 'transcode', reason: 'too-heavy', mbPerHour }
}

/** Argumentos de ffmpeg para recodificar a 720p H.264 + AAC en mp4. */
function transcodeArgs(input, output, encoder) {
  // min(720, alto original): un vídeo ya pequeño no se agranda. El ancho -2
  // mantiene la proporción y lo deja par, que H.264 lo exige.
  const scale = `scale=-2:min(${TARGET_HEIGHT}\\,ih)`
  const video = encoder === 'libx264'
    // crf + tope de bitrate: la pantalla quieta gasta mucho menos del tope, y
    // veryfast es el punto en que x264 deja de mejorar mucho por cada CPU extra.
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
      '-maxrate', `${VIDEO_MAX_KBPS}k`, '-bufsize', `${VIDEO_MAX_KBPS * 2}k`, '-threads', '2']
    : ['-c:v', encoder, '-b:v', `${VIDEO_KBPS}k`, '-maxrate', `${VIDEO_MAX_KBPS}k`, '-bufsize', `${VIDEO_MAX_KBPS * 2}k`]
  return [
    '-hide_banner', '-nostdin', '-y',
    // Decodificar el original y escalarlo gasta más CPU que codificar con la
    // tarjeta: sin tope, ffmpeg abre un hilo por núcleo para eso y el PC entero
    // lo nota. Con 2 hilos tarda algo más pero deja el resto libre.
    '-threads', '2', '-filter_threads', '1',
    '-i', input,
    '-vf', scale,
    // Las grabaciones de pantalla pueden ir a 60 fps; 30 basta para una llamada.
    '-fpsmax', '30',
    ...video,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`, '-ac', '2',
    // El índice al principio: la web puede empezar a reproducir y saltar a un
    // minuto sin descargar el vídeo entero.
    '-movflags', '+faststart',
    '-progress', 'pipe:2', '-stats_period', '1',
    output,
  ]
}

/**
 * Comprime `input` en `output` (mp4). Prueba el hardware y cae a libx264 si el
 * de hardware falla a mitad (drivers viejos, tarjeta ocupada).
 * onProgress({ phase: 'compressing', percent })
 * → { encoder, bytes, durationSec, elapsedMs }
 */
async function compressVideo({ ffmpegPath, input, output, durationSec, signal, onProgress, encoder }) {
  const started = Date.now()
  const hw = encoder === undefined ? await detectHardwareEncoder(ffmpegPath) : encoder
  const order = hw && hw !== 'libx264' ? [hw, 'libx264'] : ['libx264']
  let lastErr
  for (const enc of order) {
    try {
      await runFfmpeg(ffmpegPath, transcodeArgs(input, output, enc), {
        signal,
        // El de hardware casi no usa CPU, pero decodificar el original sí: va en
        // prioridad baja también para no robarle nada a lo que esté haciendo el usuario.
        lowPriority: true,
        onStderr: (chunk) => {
          if (!durationSec || !onProgress) return
          const m = chunk.match(/out_time_us=(\d+)/g)
          if (!m) return
          const us = Number(m[m.length - 1].split('=')[1])
          onProgress({ phase: 'compressing', percent: Math.max(0, Math.min(99, Math.round((us / 1e6 / durationSec) * 100))) })
        },
      })
      const { size } = await fsp.stat(output)
      return { encoder: enc, bytes: size, durationSec, elapsedMs: Date.now() - started }
    } catch (err) {
      lastErr = err
      await fsp.rm(output, { force: true }).catch(() => {})
      if (err?.name === 'AbortError') throw err
    }
  }
  throw lastErr
}

function resetEncoderCache() { encoderCache = null }

module.exports = {
  probe,
  decide,
  compressVideo,
  detectHardwareEncoder,
  transcodeArgs,
  resetEncoderCache,
  ASIS_MB_PER_HOUR,
  HW_ENCODERS,
}
