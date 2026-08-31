// Desplegable propio.
//
// Antes se usaba el <select> del sistema. El recuadro cerrado se puede estilar,
// pero la lista que se abre la dibuja Windows: cantos duros, tipografía del
// sistema y ni rastro del azul de la marca. No hay CSS que llegue ahí, así que
// la lista se pinta aquí.
//
// La lista va en un portal a <body> con posición fija: dentro de una fila con
// scroll o de un modal se recortaría contra el borde del contenedor.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type SelectOption = { value: string; label: string; disabled?: boolean }

type Props = {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  /** Las clases del recuadro cerrado, para que cada sitio conserve su tamaño. */
  className?: string
  title?: string
  disabled?: boolean
  /** Qué poner cuando el valor no está entre las opciones. */
  placeholder?: string
  id?: string
}

type Pos = { top: number; left: number; width: number; maxHeight: number; arriba: boolean }

const MARGEN = 4
const ALTO_MAX = 280

export function Select({ value, onChange, options, className = '', title, disabled, placeholder, id }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [marcada, setMarcada] = useState(-1)
  const [pos, setPos] = useState<Pos | null>(null)
  const botonRef = useRef<HTMLButtonElement | null>(null)
  const listaRef = useRef<HTMLDivElement | null>(null)

  const seleccionada = options.find(o => o.value === value)
  const etiqueta = seleccionada?.label ?? placeholder ?? ''

  const medir = useCallback(() => {
    const el = botonRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const debajo = window.innerHeight - r.bottom - 12
    const encima = r.top - 12
    const arriba = debajo < 160 && encima > debajo
    setPos({
      top: arriba ? r.top - MARGEN : r.bottom + MARGEN,
      left: r.left,
      width: r.width,
      maxHeight: Math.min(ALTO_MAX, Math.max(120, arriba ? encima : debajo)),
      arriba,
    })
  }, [])

  useLayoutEffect(() => { if (abierto) medir() }, [abierto, medir])

  // Al hacer scroll o cambiar el tamaño, la lista tiene que seguir al recuadro.
  useEffect(() => {
    if (!abierto) return
    const recolocar = () => medir()
    window.addEventListener('scroll', recolocar, true)
    window.addEventListener('resize', recolocar)
    return () => {
      window.removeEventListener('scroll', recolocar, true)
      window.removeEventListener('resize', recolocar)
    }
  }, [abierto, medir])

  // Cerrar al pulsar fuera o con Escape.
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node
      if (botonRef.current?.contains(t) || listaRef.current?.contains(t)) return
      setAbierto(false)
    }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAbierto(false); botonRef.current?.focus() } }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  // Que la opción marcada quede siempre a la vista al moverse con el teclado.
  useEffect(() => {
    if (!abierto || marcada < 0) return
    listaRef.current?.querySelectorAll('.select-option')[marcada]?.scrollIntoView({ block: 'nearest' })
  }, [abierto, marcada])

  const abrir = () => {
    if (disabled) return
    const i = options.findIndex(o => o.value === value)
    setMarcada(i >= 0 ? i : 0)
    setAbierto(true)
  }

  const elegir = (o: SelectOption) => {
    if (o.disabled) return
    onChange(o.value)
    setAbierto(false)
    botonRef.current?.focus()
  }

  const mover = (paso: number) => {
    if (!options.length) return
    setMarcada(i => {
      let n = i
      for (let k = 0; k < options.length; k++) {
        n = (n + paso + options.length) % options.length
        if (!options[n].disabled) return n
      }
      return i
    })
  }

  const teclado = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!abierto) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); abrir() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); mover(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1) }
    else if (e.key === 'Home') { e.preventDefault(); setMarcada(0) }
    else if (e.key === 'End') { e.preventDefault(); setMarcada(options.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const o = options[marcada]
      if (o) elegir(o)
    } else if (e.key === 'Tab') setAbierto(false)
  }

  return (
    <>
      <button
        type="button"
        id={id}
        ref={botonRef}
        title={title}
        disabled={disabled}
        className={`select-trigger${abierto ? ' select-trigger--open' : ''}${className ? ' ' + className : ''}`}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        // Varios de estos van dentro de un <label>. Sin cortar el evento, el
        // label reenvia el clic al boton y se abre y se cierra en el mismo gesto.
        onClick={e => { e.preventDefault(); e.stopPropagation(); if (abierto) setAbierto(false); else abrir() }}
        onKeyDown={teclado}
      >
        <span className={`select-trigger-label${seleccionada ? '' : ' select-trigger-label--placeholder'}`}>{etiqueta}</span>
      </button>

      {abierto && pos && createPortal(
        <div
          ref={listaRef}
          className={`select-panel${pos.arriba ? ' select-panel--arriba' : ''}`}
          role="listbox"
          style={{
            top: pos.arriba ? undefined : pos.top,
            bottom: pos.arriba ? window.innerHeight - pos.top : undefined,
            left: pos.left,
            minWidth: pos.width,
            maxHeight: pos.maxHeight,
          }}
        >
          {options.map((o, i) => (
            <div
              key={o.value + i}
              role="option"
              aria-selected={o.value === value}
              className={`select-option${o.value === value ? ' is-selected' : ''}${i === marcada ? ' is-marked' : ''}${o.disabled ? ' is-disabled' : ''}`}
              onMouseEnter={() => !o.disabled && setMarcada(i)}
              onClick={() => elegir(o)}
            >
              <span className="select-option-label">{o.label}</span>
              {o.value === value && (
                <svg className="select-option-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
