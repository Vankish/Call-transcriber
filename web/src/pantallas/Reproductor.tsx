import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useDatos } from '../data/contexto'
import type { Archivo, UrlFirmada } from '../data/tipos'
import { t } from '../i18n'
import { tiempo as fmt } from '../formato'
import { mensajeDeError } from '../errores'

export interface Marca { id: string; atSec: number; resuelto: boolean; texto: string }

interface Props {
  archivos: Archivo[]
  duracionSec: number
  shareToken?: string
  mediaRef: RefObject<HTMLMediaElement | null>
  marcas: Marca[]
  onMarca?: (id: string) => void
  onTiempo: (seg: number) => void
}

const VELOCIDADES = [0.75, 1, 1.25, 1.5, 1.75, 2]
// Las URL firmadas duran una hora. Se pide otra cinco minutos antes, y si el
// vídeo está sonando se cambia como muy tarde un minuto antes de que caduque.
const RENOVAR_ANTES = 5 * 60_000
const CAMBIAR_ANTES = 60_000

const listo = (a?: Archivo) => a?.uploadStatus === 'done'

/** Vídeo si está subido; si no, el audio mezclado; si no, el del interlocutor. */
function elegirArchivo(archivos: Archivo[]) {
  const video = archivos.find((a) => a.kind === 'video')
  const elegido = listo(video)
    ? video
    : archivos.find((a) => a.kind === 'mix' && listo(a)) ?? archivos.find((a) => a.kind === 'system' && listo(a))
  return { elegido, videoSubiendo: Boolean(video && !listo(video)) }
}

/**
 * La URL del archivo, renovada sola antes de caducar.
 *
 * Cambiar el `src` de un vídeo lo recarga desde el principio, así que antes de
 * cambiarlo se apunta dónde iba (segundo, velocidad, si sonaba) y se restaura
 * en cuanto el nuevo tiene sus metadatos: para quien mira es un parpadeo, no un
 * corte. Si aun así caduca (el portátil estuvo suspendido una hora, p. ej.), el
 * error del vídeo dispara una renovación con el mismo truco.
 */
function useUrlFirmada(mediaId: string | undefined, shareToken: string | undefined, mediaRef: RefObject<HTMLMediaElement | null>) {
  const pedir = useDatos().usePedirUrl()
  const [firma, setFirma] = useState<(UrlFirmada & { mediaId: string }) | null>(null)
  const [error, setError] = useState<unknown>(null)
  const restaurar = useRef<{ t: number; sonando: boolean; velocidad: number } | null>(null)
  const ultimoReintento = useRef(0)

  const aplicar = useCallback((nueva: UrlFirmada & { mediaId: string }) => {
    const el = mediaRef.current
    if (el && el.currentSrc) restaurar.current = { t: el.currentTime, sonando: !el.paused && !el.ended, velocidad: el.playbackRate }
    setFirma(nueva)
  }, [mediaRef])

  // La primera URL, y otra cada vez que cambia el archivo.
  useEffect(() => {
    if (!mediaId) return
    let vivo = true
    pedir(mediaId, shareToken).then(
      (u) => { if (vivo) { setError(null); setFirma({ ...u, mediaId }) } },
      (e) => { if (vivo) setError(e) },
    )
    return () => { vivo = false }
    // `pedir` cambia de identidad en cada render; lo que importa es el archivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId, shareToken])

  // Renovación antes de caducar.
  useEffect(() => {
    if (!firma) return
    let vivo = true
    const timers: number[] = []
    const renovar = () => {
      pedir(firma.mediaId, shareToken).then((u) => {
        if (!vivo) return
        const nueva = { ...u, mediaId: firma.mediaId }
        const el = mediaRef.current
        if (!el || el.paused || el.ended) { aplicar(nueva); return }
        // Sonando: se espera a una pausa, o al último minuto si no la hay.
        const alPausar = () => { if (vivo) aplicar(nueva) }
        el.addEventListener('pause', alPausar, { once: true })
        timers.push(window.setTimeout(() => {
          el.removeEventListener('pause', alPausar)
          if (vivo) aplicar(nueva)
        }, Math.max(0, firma.expiresAt - Date.now() - CAMBIAR_ANTES)))
      }, () => { /* se reintenta con el error del vídeo si de verdad caduca */ })
    }
    timers.push(window.setTimeout(renovar, Math.max(0, firma.expiresAt - Date.now() - RENOVAR_ANTES)))
    return () => { vivo = false; timers.forEach((x) => clearTimeout(x)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma, shareToken, aplicar])

  /** El vídeo no carga: casi siempre es la URL caducada. Se pide otra una vez. */
  const alFallar = useCallback(() => {
    if (!firma) return
    if (Date.now() - ultimoReintento.current < 15_000) {
      setError(new Error('media'))
      return
    }
    ultimoReintento.current = Date.now()
    pedir(firma.mediaId, shareToken).then((u) => aplicar({ ...u, mediaId: firma.mediaId }), setError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma, shareToken, aplicar])

  /** Al tener metadatos el archivo nuevo, se vuelve a donde iba. */
  const alCargar = useCallback(() => {
    const el = mediaRef.current
    const r = restaurar.current
    if (!el || !r) return
    restaurar.current = null
    el.currentTime = r.t
    el.playbackRate = r.velocidad
    if (r.sonando) void el.play().catch(() => {})
  }, [mediaRef])

  return { url: firma && firma.mediaId === mediaId ? firma.url : undefined, error, alFallar, alCargar }
}

export function Reproductor({ archivos, duracionSec, shareToken, mediaRef, marcas, onMarca, onTiempo }: Props) {
  const { elegido, videoSubiendo } = elegirArchivo(archivos)
  const { url, error, alFallar, alCargar } = useUrlFirmada(elegido?._id, shareToken, mediaRef)
  const marco = useRef<HTMLDivElement>(null)
  const [sonando, setSonando] = useState(false)
  const [esperando, setEsperando] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(duracionSec)
  const [velocidad, setVelocidad] = useState(1)

  const esVideo = elegido?.kind === 'video'
  const total = dur || duracionSec || 1

  const alternar = () => {
    const el = mediaRef.current
    if (!el) return
    if (el.paused) void el.play().catch(() => {})
    else el.pause()
  }
  const ir = (s: number) => {
    const el = mediaRef.current
    if (!el) return
    el.currentTime = Math.min(Math.max(0, s), total)
    setPos(el.currentTime)
    onTiempo(el.currentTime)
  }
  const cambiarVelocidad = (v: number) => {
    setVelocidad(v)
    if (mediaRef.current) mediaRef.current.playbackRate = v
  }
  const teclas = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); alternar() }
    if (e.key === 'ArrowLeft') { e.preventDefault(); ir(pos - 5) }
    if (e.key === 'ArrowRight') { e.preventDefault(); ir(pos + 5) }
  }

  if (!elegido) {
    return (
      <div className="reproductor reproductor--vacio">
        <div className="reproductor__aviso">
          <strong>{videoSubiendo ? t('El vídeo todavía se está subiendo') : t('Esta llamada no tiene grabación en la nube')}</strong>
          <span>{videoSubiendo ? t('Se sube desde el ordenador de quien grabó. Vuelve en un rato.') : t('Puedes leer la transcripción y el resumen.')}</span>
        </div>
      </div>
    )
  }

  const eventos = {
    src: url,
    preload: 'metadata' as const,
    onPlay: () => setSonando(true),
    onPause: () => setSonando(false),
    onEnded: () => setSonando(false),
    onWaiting: () => setEsperando(true),
    onPlaying: () => setEsperando(false),
    onCanPlay: () => setEsperando(false),
    onTimeUpdate: (e: { currentTarget: HTMLMediaElement }) => { setPos(e.currentTarget.currentTime); onTiempo(e.currentTarget.currentTime) },
    onLoadedMetadata: (e: { currentTarget: HTMLMediaElement }) => {
      if (Number.isFinite(e.currentTarget.duration)) setDur(e.currentTarget.duration)
      e.currentTarget.playbackRate = velocidad
      alCargar()
    },
    onError: alFallar,
  }

  const pct = (s: number) => `${Math.min(100, (s / total) * 100)}%`

  return (
    <div className="reproductor" ref={marco} tabIndex={0} onKeyDown={teclas} aria-label={t('Reproductor')}>
      <div className={esVideo ? 'reproductor__pantalla' : 'reproductor__pantalla reproductor__pantalla--audio'}>
        {esVideo
          ? <video ref={mediaRef as RefObject<HTMLVideoElement | null>} playsInline onClick={alternar} {...eventos} />
          : (
            <>
              <audio ref={mediaRef as RefObject<HTMLAudioElement | null>} {...eventos} />
              <div className="reproductor__onda" aria-hidden>
                {Array.from({ length: 28 }, (_, i) => <span key={i} style={{ height: `${20 + ((i * 37) % 60)}%` }} className={sonando ? 'sonando' : ''} />)}
              </div>
              <span className="reproductor__solo-audio">{videoSubiendo ? t('Solo audio por ahora: el vídeo se está subiendo') : t('Solo audio')}</span>
            </>
          )}
        {(!url || esperando) && !error && <span className="reproductor__rueda" aria-label={t('Cargando…')} />}
        {error ? (
          <div className="reproductor__error" role="alert">
            <strong>{t('No se puede reproducir')}</strong>
            <span>{mensajeDeError(error)}</span>
          </div>
        ) : null}
        {!sonando && url && !error && esVideo && (
          <button className="reproductor__grande" onClick={alternar} aria-label={t('Reproducir')}>▶</button>
        )}
      </div>

      <div className="controles">
        <div className="barra">
          <div className="barra__marcas">
            {marcas.map((m) => (
              <button
                key={m.id}
                className={m.resuelto ? 'barra__marca barra__marca--resuelta' : 'barra__marca'}
                style={{ left: pct(m.atSec) }}
                title={`${fmt(m.atSec)} · ${m.texto}`}
                aria-label={t('Comentario en {t}', { t: fmt(m.atSec) })}
                onClick={() => { ir(m.atSec); onMarca?.(m.id) }}
              />
            ))}
          </div>
          <div className="barra__pista">
            <div className="barra__hecho" style={{ width: pct(pos) }} />
          </div>
          <input
            className="barra__rango"
            type="range"
            min={0}
            max={total}
            step={0.1}
            value={pos}
            aria-label={t('Posición')}
            onChange={(e) => ir(Number(e.target.value))}
          />
        </div>
        <div className="controles__fila">
          <button className="control" onClick={alternar} aria-label={sonando ? t('Pausa') : t('Reproducir')}>
            {sonando ? '❚❚' : '▶'}
          </button>
          <button className="control" onClick={() => ir(pos - 10)} aria-label={t('Atrás 10 segundos')}>↺10</button>
          <button className="control" onClick={() => ir(pos + 10)} aria-label={t('Adelante 10 segundos')}>10↻</button>
          <span className="controles__tiempo">{fmt(pos)} <span>/ {fmt(total)}</span></span>
          <span className="controles__hueco" />
          <select className="control control--velocidad" value={velocidad} onChange={(e) => cambiarVelocidad(Number(e.target.value))} aria-label={t('Velocidad')}>
            {VELOCIDADES.map((v) => <option key={v} value={v}>{v.toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0 })}×</option>)}
          </select>
          {esVideo && (
            <button className="control" onClick={() => { void marco.current?.requestFullscreen?.() }} aria-label={t('Pantalla completa')}>⛶</button>
          )}
        </div>
      </div>
    </div>
  )
}
