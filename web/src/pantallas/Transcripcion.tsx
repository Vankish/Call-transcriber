import { useEffect, useMemo, useRef, useState } from 'react'
import type { Segmento } from '../data/tipos'
import { t } from '../i18n'
import { tiempo as fmt } from '../formato'

interface Props {
  segmentos?: Segmento[]
  texto: string
  tiempo: number
  onSaltar: (seg: number) => void
  /** Segundos con comentario, para marcar las frases comentadas. */
  comentados?: number[]
}

/** El último segmento que ha empezado: búsqueda binaria, porque se llama en
 *  cada `timeupdate` (cuatro veces por segundo) con cientos de frases. */
function activoEn(segs: Segmento[], seg: number): number {
  let lo = 0
  let hi = segs.length - 1
  let r = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segs[mid]!.startSec <= seg) { r = mid; lo = mid + 1 } else hi = mid - 1
  }
  return r
}

// Tras mover la lista a mano, se deja de seguir al vídeo un rato: si no, la
// lista saltaría de vuelta mientras alguien lee más adelante.
const PAUSA_SEGUIR = 6000

// Desplaza la caja de la transcripción, no la página: con scrollIntoView el
// móvil movería toda la pantalla y el vídeo se iría de la vista.
function centrar(c: HTMLElement | null, i: number) {
  const el = c?.querySelector<HTMLElement>(`[data-i="${i}"]`)
  if (!c || !el) return
  c.scrollTo({ top: el.offsetTop - c.clientHeight * 0.3, behavior: 'smooth' })
}

export function Transcripcion({ segmentos, texto, tiempo, onSaltar, comentados = [] }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const pausadoHasta = useRef(0)
  const [suelto, setSuelto] = useState(false)
  const temporizador = useRef<number | undefined>(undefined)

  const activo = segmentos ? activoEn(segmentos, tiempo) : -1

  // Cada hablante, un color, por orden de aparición.
  const colores = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of segmentos ?? []) if (!m.has(s.speaker)) m.set(s.speaker, m.size % 4)
    return m
  }, [segmentos])

  const conComentario = useMemo(() => {
    const set = new Set<number>()
    if (!segmentos) return set
    for (const c of comentados) {
      const i = activoEn(segmentos, c)
      if (i >= 0) set.add(i)
    }
    return set
  }, [segmentos, comentados])

  useEffect(() => {
    if (activo < 0 || Date.now() < pausadoHasta.current) return
    centrar(caja.current, activo)
  }, [activo])

  const aMano = () => {
    pausadoHasta.current = Date.now() + PAUSA_SEGUIR
    setSuelto(true)
    clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => setSuelto(false), PAUSA_SEGUIR)
  }
  useEffect(() => () => clearTimeout(temporizador.current), [])

  if (!segmentos || segmentos.length === 0) {
    if (!texto.trim()) return <p className="transcripcion__vacia">{t('Esta llamada aún no tiene transcripción.')}</p>
    return (
      <div className="transcripcion">
        <p className="transcripcion__nota">{t('Esta transcripción no tiene tiempos: no se puede saltar al vídeo desde las frases.')}</p>
        <div className="transcripcion__texto">{texto}</div>
      </div>
    )
  }

  return (
    <div className="transcripcion">
      <div className="transcripcion__caja" ref={caja} onWheel={aMano} onTouchMove={aMano}>
        {segmentos.map((s, i) => (
          <button
            key={i}
            data-i={i}
            className={i === activo ? 'frase frase--activa' : 'frase'}
            onClick={() => { pausadoHasta.current = 0; setSuelto(false); onSaltar(s.startSec) }}
            aria-current={i === activo ? 'true' : undefined}
          >
            <span className="frase__cabeza">
              <span className={`frase__hablante frase__hablante--${colores.get(s.speaker) ?? 0}`}>{s.speaker}</span>
              <span className="frase__tiempo">{fmt(s.startSec)}</span>
              {conComentario.has(i) && <span className="frase__comentada" title={t('Hay un comentario en este momento')}>●</span>}
            </span>
            <span className="frase__texto">{s.text}</span>
          </button>
        ))}
      </div>
      {suelto && activo >= 0 && (
        <button className="transcripcion__volver" onClick={() => { pausadoHasta.current = 0; setSuelto(false); centrar(caja.current, activo) }}>
          {t('Volver a lo que suena')}
        </button>
      )}
    </div>
  )
}
