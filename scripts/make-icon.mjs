import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFileSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

const svg = readFileSync(join(root, 'public', 'favicon.svg'))

const sizes = [16, 32, 48, 64, 128, 256]

const pngBuffers = await Promise.all(
  sizes.map(size =>
    sharp(svg)
      .resize(size, size)
      .png()
      .toBuffer()
  )
)

const ico = await pngToIco(pngBuffers)
writeFileSync(join(root, 'build', 'icon.ico'), ico)
console.log('✓ build/icon.ico generado desde favicon.svg')
