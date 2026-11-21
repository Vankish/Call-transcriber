import { useState, type KeyboardEvent } from 'react'
import { useDatos } from '../data/contexto'
import type { Comentario, Rol } from '../data/tipos'
import { t } from '../i18n'
import { iniciales, relativo, tiempo as fmt } from '../formato'
import { useAhora } from '../reloj'
import { AvisoError, Esqueleto } from './Estados'

/** El formulario de comentario nuevo: `atSec` undefined = comentario general. */
export interface Borrador { atSec?: number }

interface Props {
  interviewId: string
  comentarios: Comentario[] | undefined
  rol: Rol | undefined
  tiempo: number
  borrador: Borrador | null
  onBorrador: (b: Borrador | null) => void
  onSaltar: (seg: number) => void
  /** El comentario de la marca que se acaba de pinchar, para resaltarlo. */
  destacado?: string
}

// Un comentario "suena" durante unos segundos después de su minuto: así se
// resalta en la lista mientras el vídeo pasa por ese momento.
const VENTANA = 6

/** Ordenados por su momento en la llamada; los generales, al final. */
function ordenar(a: Comentario, b: Comentario) {
  if (a.atSec !== undefined && b.atSec !== undefined) return a.atSec - b.atSec || a.createdAt - b.createdAt
  if (a.atSec !== undefined) return -1
  if (b.atSec !== undefined) return 1
  return a.createdAt - b.createdAt
}

export function Comentarios({ interviewId, comentarios, rol, tiempo, borrador, onBorrador, onSaltar, destacado }: Props) {
  const [verResueltos, setVerResueltos] = useState(false)
  const puedeModerar = rol === 'owner' || rol === 'admin'

  if (comentarios === undefined) return <Esqueleto filas={3} />

  const raiz = comentarios.filter((c) => !c.parentId).sort(ordenar)
  const resueltos = raiz.filter((c) => c.resolvedAt).length
  const visibles = verResueltos ? raiz : raiz.filter((c) => !c.resolvedAt)
  const respuestas = (id: string) => comentarios.filter((c) => c.parentId === id).sort((a, b) => a.createdAt - b.createdAt)

  return (
    <div className="comentarios">
      {borrador ? (
        <Formulario
          interviewId={interviewId}
          borrador={borrador}
          onBorrador={onBorrador}
          onSaltar={onSaltar}
        />
      ) : (
        <div className="comentarios__acciones">
          <button className="boton boton--primario" onClick={() => onBorrador({ atSec: tiempo })}>
            {t('Comentar en este momento')} <span className="boton__extra">{fmt(tiempo)}</span>
          </button>
          <button className="boton boton--secundario" onClick={() => onBorrador({})}>{t('Comentario general')}</button>
        </div>
      )}

      {resueltos > 0 && (
        <label className="interruptor">
          <input type="checkbox" checked={verResueltos} onChange={(e) => setVerResueltos(e.target.checked)} />
          {t('Ver también los resueltos ({n})', { n: resueltos })}
        </label>
      )}

      {visibles.length === 0 ? (
        <p className="panel__vacio">
          {raiz.length === 0
            ? t('Aún no hay comentarios. Pausa el vídeo donde quieras comentar y pulsa «Comentar en este momento».')
            : t('Todos los comentarios están resueltos.')}
        </p>
      ) : (
        <ul className="hilos">
          {visibles.map((c) => (
            <Hilo
              key={c._id}
              c={c}
              respuestas={respuestas(c._id)}
              interviewId={interviewId}
              puedeModerar={puedeModerar}
              sonando={c.atSec !== undefined && tiempo >= c.atSec && tiempo < c.atSec + VENTANA}
              destacado={destacado === c._id}
              onSaltar={onSaltar}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function Formulario({ interviewId, borrador, onBorrador, onSaltar }: {
  interviewId: string; borrador: Borrador; onBorrador: (b: Borrador | null) => void; onSaltar: (s: number) => void
}) {
  const { add } = useDatos().useAccionesComentario()
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function enviar() {
    if (!texto.trim()) return
    setEnviando(true)
    setError(null)
    try {
      await add({ interviewId, body: texto.trim(), atSec: borrador.atSec })
      onBorrador(null)
    } catch (e) {
      setError(e)
    } finally {
      setEnviando(false)
    }
  }

  const teclas = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void enviar() }
    if (e.key === 'Escape') onBorrador(null)
  }

  return (
    <div className="formulario-comentario">
      <div className="formulario-comentario__cabeza">
        {borrador.atSec !== undefined ? (
          <>
            <button className="chip chip--tiempo" onClick={() => onSaltar(borrador.atSec!)}>{fmt(borrador.atSec)}</button>
            <span>{t('Comentario en este momento')}</span>
            <button className="enlace" onClick={() => onBorrador({})}>{t('Quitar el minuto')}</button>
          </>
        ) : (
          <span>{t('Comentario general, sin minuto')}</span>
        )}
      </div>
      <textarea
        autoFocus
        rows={3}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={teclas}
        placeholder={t('Qué has visto aquí: tono, ritmo, una pregunta que funcionó…')}
      />
      <AvisoError error={error} />
      <div className="formulario-comentario__pie">
        <span className="formulario-comentario__ayuda">{t('Ctrl + Intro para publicar')}</span>
        <button className="boton boton--fantasma" onClick={() => onBorrador(null)}>{t('Cancelar')}</button>
        <button className="boton boton--primario" disabled={!texto.trim() || enviando} onClick={() => { void enviar() }}>
          {enviando ? t('Publicando…') : t('Publicar')}
        </button>
      </div>
    </div>
  )
}

function Hilo({ c, respuestas, interviewId, puedeModerar, sonando, destacado, onSaltar }: {
  c: Comentario; respuestas: Comentario[]; interviewId: string; puedeModerar: boolean
  sonando: boolean; destacado: boolean; onSaltar: (s: number) => void
}) {
  const { add, resolve } = useDatos().useAccionesComentario()
  const [respondiendo, setRespondiendo] = useState(false)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [ocupado, setOcupado] = useState(false)

  async function hacer(f: () => Promise<void>) {
    setOcupado(true)
    setError(null)
    try { await f() } catch (e) { setError(e) } finally { setOcupado(false) }
  }

  const clases = ['hilo']
  if (c.resolvedAt) clases.push('hilo--resuelto')
  if (sonando) clases.push('hilo--sonando')
  if (destacado) clases.push('hilo--destacado')

  return (
    <li className={clases.join(' ')} id={`comentario-${c._id}`}>
      <Mensaje c={c} onSaltar={onSaltar} />
      {respuestas.length > 0 && (
        <ul className="respuestas">
          {respuestas.map((r) => <li key={r._id}><Mensaje c={r} onSaltar={onSaltar} /></li>)}
        </ul>
      )}
      {respondiendo ? (
        <div className="respuesta-nueva">
          <textarea
            autoFocus
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={t('Escribe una respuesta…')}
          />
          <div className="formulario-comentario__pie">
            <button className="boton boton--fantasma boton--pequeno" onClick={() => { setRespondiendo(false); setTexto('') }}>{t('Cancelar')}</button>
            <button
              className="boton boton--primario boton--pequeno"
              disabled={!texto.trim() || ocupado}
              onClick={() => void hacer(async () => {
                await add({ interviewId, body: texto.trim(), parentId: c._id })
                setTexto('')
                setRespondiendo(false)
              })}
            >
              {t('Responder')}
            </button>
          </div>
        </div>
      ) : (
        <div className="hilo__acciones">
          <button className="enlace" onClick={() => setRespondiendo(true)}>{t('Responder')}</button>
          {(c.esMio || puedeModerar) && (
            <button className="enlace" disabled={ocupado} onClick={() => void hacer(() => resolve({ commentId: c._id, resolved: !c.resolvedAt }))}>
              {c.resolvedAt ? t('Reabrir') : t('Marcar como resuelto')}
            </button>
          )}
        </div>
      )}
      <AvisoError error={error} />
    </li>
  )
}

function Mensaje({ c, onSaltar }: { c: Comentario; onSaltar: (s: number) => void }) {
  const { edit, remove } = useDatos().useAccionesComentario()
  const ahora = useAhora()
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(c.body)
  const [error, setError] = useState<unknown>(null)

  async function guardar() {
    setError(null)
    try {
      await edit({ commentId: c._id, body: texto.trim() })
      setEditando(false)
    } catch (e) { setError(e) }
  }

  async function borrar() {
    if (!window.confirm(t('¿Borrar este comentario?'))) return
    try { await remove({ commentId: c._id }) } catch (e) { setError(e) }
  }

  return (
    <div className="mensaje">
      <span className="avatar" aria-hidden>{iniciales(c.authorName)}</span>
      <div className="mensaje__cuerpo">
        <div className="mensaje__cabeza">
          <strong>{c.authorName || t('Alguien del equipo')}</strong>
          {c.atSec !== undefined && (
            <button className="chip chip--tiempo" onClick={() => onSaltar(c.atSec!)} title={t('Ir a este momento')}>{fmt(c.atSec)}</button>
          )}
          <span className="mensaje__fecha">{relativo(c.createdAt, ahora)}{c.editedAt ? ` · ${t('editado')}` : ''}</span>
          {c.resolvedAt && <span className="chip chip--resuelto">{t('Resuelto')}</span>}
        </div>
        {editando ? (
          <>
            <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
            <div className="formulario-comentario__pie">
              <button className="boton boton--fantasma boton--pequeno" onClick={() => { setEditando(false); setTexto(c.body) }}>{t('Cancelar')}</button>
              <button className="boton boton--primario boton--pequeno" disabled={!texto.trim()} onClick={() => { void guardar() }}>{t('Guardar')}</button>
            </div>
          </>
        ) : (
          <p className="mensaje__texto">{c.body}</p>
        )}
        {c.esMio && !editando && (
          <div className="mensaje__mio">
            <button className="enlace enlace--suave" onClick={() => setEditando(true)}>{t('Editar')}</button>
            <button className="enlace enlace--suave" onClick={() => { void borrar() }}>{t('Borrar')}</button>
          </div>
        )}
        <AvisoError error={error} />
      </div>
    </div>
  )
}
