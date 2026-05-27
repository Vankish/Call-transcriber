import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

// Icon SVG — blue circle + 5 waveform bars (exact match to Figma "Logo 1 — Signal")
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" rx="58" fill="#2563eb"/>
  <rect x="42"  y="109" width="22" height="56" rx="6" fill="#ffffff"/>
  <rect x="80"  y="90"  width="22" height="96" rx="6" fill="#ffffff"/>
  <rect x="118" y="67"  width="22" height="140" rx="6" fill="#ffffff"/>
  <rect x="156" y="90"  width="22" height="96" rx="6" fill="#ffffff"/>
  <rect x="194" y="109" width="22" height="56" rx="6" fill="#ffffff"/>
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
console.log('✓ build/icon.ico generado')
