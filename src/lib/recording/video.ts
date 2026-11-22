// Ajustes del vídeo de la llamada. Los números salen del banco de pruebas
// (scripts/bench-grabacion-video.cjs); ahí se explica cómo repetir la medida.

export type VideoQuality = '720p' | '1080p'

const SIZE: Record<VideoQuality, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
}

// Lo que se pide a getDisplayMedia. El tamaño va con tope: sin él Chromium captura
// la pantalla a su resolución nativa (en un portátil con escalado o un monitor 2K/4K,
// muchos más píxeles que codificar en cada fotograma) y "720p" solo cambiaba los
// kbps. Con el tope reduce él mismo la imagen al capturar, que apenas cuesta.
// frameRate bajo a propósito: es vídeo de referencia de una llamada, no de acción.
export const displayVideoConstraints = (quality: VideoQuality): MediaTrackConstraints => ({
  frameRate: { ideal: 8, max: 12 },
  width: { max: SIZE[quality].width },
  height: { max: SIZE[quality].height },
})

// Kbps de vídeo. Antes eran 2 Mbps (720p) y 4 Mbps (1080p): hasta 0,9 y 1,8 GB por
// hora, y el vídeo se sube a la nube y se guarda para siempre. A 8 fps una llamada
// se ve bien con mucho menos; el codificador gasta menos de esto cuando la imagen
// apenas cambia, así que es un techo, no lo que ocupa siempre.
export const videoBitsPerSecond = (quality: VideoQuality) => quality === '1080p' ? 1_800_000 : 900_000

// ¿Hay codificador H.264 en la tarjeta gráfica? MediaRecorder.isTypeSupported dice
// que sí aunque no lo haya (cae a OpenH264, que es por procesador), así que se
// pregunta a WebCodecs, que sí distingue el hardware.
const hasHardwareH264 = async (quality: VideoQuality) => {
  try {
    if (typeof VideoEncoder === 'undefined') return false
    const { width, height } = SIZE[quality]
    const r = await VideoEncoder.isConfigSupported({ codec: 'avc1.42002a', width, height, bitrate: videoBitsPerSecond(quality), framerate: 8, hardwareAcceleration: 'prefer-hardware' })
    return !!r.supported
  } catch { return false }
}

// H.264 por la tarjeta gráfica cuando la hay; si no, VP8 (los dos por procesador
// cuestan parecido, y VP8 es el formato propio de webm, sin trucos al reempaquetar).
export const pickVideoMimeType = async (quality: VideoQuality) =>
  MediaRecorder.isTypeSupported('video/webm;codecs=h264') && await hasHardwareH264(quality)
    ? 'video/webm;codecs=h264'
    : 'video/webm;codecs=vp8'
