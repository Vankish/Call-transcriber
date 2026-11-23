// Genera el vídeo de prueba de la web con datos falsos: carta de ajuste de
// ffmpeg (testsrc, con su contador de segundos) y un tono, 40 minutos como la
// llamada inventada. Nunca se usan grabaciones de verdad: el repo es público.
//
// Va a web/public/demo/, que no se versiona (pesa unos MB y se regenera en
// segundos). Pocos fotogramas por segundo y poca resolución: basta para
// comprobar saltos, marcas y renovación de la URL, y así no ocupa nada.
//
// Uso: npm run web:video

import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ffmpeg from 'ffmpeg-static'

const carpeta = fileURLToPath(new URL('../public/demo/', import.meta.url))
const salida = carpeta + 'llamada-prueba.mp4'
const segundos = Number(process.env.DURACION ?? 2412)

if (existsSync(salida) && !process.argv.includes('--forzar')) {
  console.log(`Ya existe ${salida} (usa --forzar para rehacerlo).`)
  process.exit(0)
}
mkdirSync(carpeta, { recursive: true })

execFileSync(ffmpeg, [
  '-y', '-loglevel', 'error',
  '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=4:duration=${segundos}`,
  // Un tono suave que cambia de nota cada pocos segundos, para oír que suena.
  '-f', 'lavfi', '-i', `sine=frequency=330:beep_factor=2:duration=${segundos}`,
  '-filter:a', 'volume=0.15',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p', '-g', '8',
  '-c:a', 'aac', '-b:a', '32k', '-ac', '1',
  // moov al principio: sin esto el navegador no puede saltar a un minuto sin
  // haber descargado antes el archivo entero.
  '-movflags', '+faststart',
  salida,
], { stdio: 'inherit' })

console.log(`Vídeo de prueba listo: ${salida}`)
