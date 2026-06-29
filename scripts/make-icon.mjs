import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

// Matches the logo in App.tsx global-top-bar exactly: blue circle + 5 waveform bars
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="256" height="256">
  <rect width="80" height="80" rx="40" fill="#2563eb"/>
  <rect x="13" y="31" width="7" height="18" rx="2" fill="#ffffff"/>
  <rect x="25" y="25" width="7" height="30" rx="2" fill="#ffffff"/>
  <rect x="37" y="18" width="7" height="44" rx="2" fill="#ffffff"/>
  <rect x="49" y="25" width="7" height="30" rx="2" fill="#ffffff"/>
  <rect x="61" y="31" width="7" height="18" rx="2" fill="#ffffff"/>
</svg>`

const sizes = [16, 32, 48, 64, 128, 256]

const pngBuffers = await Promise.all(
  sizes.map(size =>
    sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toBuffer()
  )
)

const ico = await pngToIco(pngBuffers)
writeFileSync(join(root, 'build', 'icon.ico'), ico)
console.log('✓ build/icon.ico generado (círculo azul + barras)')
