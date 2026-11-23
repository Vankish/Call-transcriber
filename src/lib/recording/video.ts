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
// apenas cambia, así que es un techo, no lo que ocupa siempre. Medido con una
// escena tipo Meet (RTX 2070): 1080p pasa de 463 a 234 MB/h y 720p ocupa 147 MB/h.
// Menos kbps también es menos memoria: los trozos que entrega MediaRecorder viven
// en memoria hasta que la ventana hace limpieza, y crecen al ritmo del vídeo.
export const videoBitsPerSecond = (quality: VideoQuality) => quality === '1080p' ? 1_800_000 : 900_000

// H.264 siempre que Chromium lo acepte. Con tarjeta gráfica lo comprime ella; sin
// ella cae a OpenH264, que sigue gastando menos procesador que VP8 (medido a 720p:
// 0,34 núcleos frente a 0,39, mismo tamaño). VP8 solo queda por si no hay H.264.
export const pickVideoMimeType = () =>
  MediaRecorder.isTypeSupported('video/webm;codecs=h264') ? 'video/webm;codecs=h264' : 'video/webm;codecs=vp8'
