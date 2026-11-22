// Banco de pruebas de la compresión antes de subir (frente C).
//
// Genera un vídeo sintético parecido a lo que graba la app (1080p, VP8 en webm a
// unos 2,5 Mbit/s, como MediaRecorder con una pantalla) y lo comprime con cada
// codificador disponible, igual que lo hará la cola: misma función, misma
// prioridad baja. Mide tiempo, velocidad respecto al tiempo real, CPU del PC
// (media y pico, restando lo que ya gastaba antes de empezar) y MB por hora.
//
// No toca grabaciones reales: todo va a una carpeta temporal que se borra.
//
// Uso: node scripts/bench-compresion-subida.cjs [segundos=180]

const os = require('node:os')
const path = require('node:path')
const fsp = require('node:fs/promises')
const { spawnSync } = require('node:child_process')
const ffmpegPath = require('ffmpeg-static')
const compress = require('../electron/cloud/upload-compress.cjs')
const { sha256File } = require('../electron/cloud/upload-file.cjs')

const seconds = Number(process.argv[2]) || 180

function cpuSampler() {
  let prev = os.cpus().map((c) => c.times)
  const samples = []
  const t = setInterval(() => {
    const cur = os.cpus().map((c) => c.times)
    let total = 0; let idle = 0
    cur.forEach((c, i) => {
      const p = prev[i]
      const sum = (x) => x.user + x.nice + x.sys + x.idle + x.irq
      total += sum(c) - sum(p)
      idle += c.idle - p.idle
    })
    prev = cur
    if (total > 0) samples.push(100 * (1 - idle / total))
  }, 500)
  return {
    stop() {
      clearInterval(t)
      const avg = samples.reduce((s, x) => s + x, 0) / (samples.length || 1)
      return { avg, peak: Math.max(0, ...samples) }
    },
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mb = (b) => b / 1048576
const fmt = (n, d = 1) => n.toFixed(d)

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ct-bench-subida-'))
  try {
    console.log(`CPU: ${os.cpus()[0].model} (${os.cpus().length} hilos)`)
    const input = path.join(dir, 'sintetico_video.webm')
    console.log(`Generando ${seconds} s de vídeo sintético 1080p VP8 ~2,5 Mbit/s...`)
    const gen = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30',
      '-f', 'lavfi', '-i', 'sine=f=440:sample_rate=48000',
      '-t', String(seconds), '-c:v', 'libvpx', '-b:v', '2500k', '-deadline', 'realtime', '-cpu-used', '8',
      '-c:a', 'libopus', '-b:a', '96k', input], { stdio: 'inherit' })
    if (gen.status !== 0) throw new Error('no se pudo generar el vídeo')
    const inSize = (await fsp.stat(input)).size
    const info = await compress.probe(ffmpegPath, input)
    console.log(`Original: ${fmt(mb(inSize))} MB, ${fmt(info.durationSec)} s → ${fmt(mb(inSize) / (info.durationSec / 3600), 0)} MB/hora`)
    console.log('Decisión de la cola:', compress.decide({ kind: 'video', bytes: inSize, durationSec: info.durationSec, height: info.height }))

    const t0 = Date.now()
    await sha256File(input)
    console.log(`sha256: ${fmt(mb(inSize) / ((Date.now() - t0) / 1000), 0)} MB/s`)

    // Lo que gasta el PC sin hacer nada nuestro, para restarlo.
    const base = cpuSampler(); await sleep(3000); const idle = base.stop()
    console.log(`CPU de fondo antes de empezar: ${fmt(idle.avg)} %`)

    const hw = await compress.detectHardwareEncoder(ffmpegPath)
    console.log(`Codificador por hardware detectado: ${hw || 'ninguno'}`)
    const encoders = [...new Set([hw, 'libx264'].filter(Boolean))]
    for (const encoder of encoders) {
      const out = path.join(dir, `salida_${encoder}.mp4`)
      const s = cpuSampler()
      const r = await compress.compressVideo({ ffmpegPath, input, output: out, durationSec: info.durationSec, encoder })
      const cpu = s.stop()
      const o = await compress.probe(ffmpegPath, out)
      console.log([
        `· ${encoder}: ${fmt(r.elapsedMs / 1000)} s (${fmt(info.durationSec / (r.elapsedMs / 1000))}x tiempo real)`,
        `CPU media ${fmt(cpu.avg)} % (≈ +${fmt(Math.max(0, cpu.avg - idle.avg))} sobre el fondo), pico ${fmt(cpu.peak)} %`,
        `${fmt(mb(r.bytes))} MB → ${fmt(mb(r.bytes) / (info.durationSec / 3600), 0)} MB/hora, ${o.width}x${o.height} ${o.videoCodec}`,
        `ahorro ${fmt(100 * (1 - r.bytes / inSize), 0)} %`,
        `una hora tardaría ≈ ${fmt((3600 / info.durationSec) * r.elapsedMs / 60000)} min`,
      ].join(' · '))
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
