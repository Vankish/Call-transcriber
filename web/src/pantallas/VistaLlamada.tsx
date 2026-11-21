import { useRef, useState, useSyncExternalStore } from 'react'
import type { Comentario, LlamadaDetalle, Rol } from '../data/tipos'
import { k, t } from '../i18n'
import { duracion, fecha } from '../formato'
import { navegar } from '../ruta'
import { Reproductor, type Marca } from './Reproductor'
import { Transcripcion } from './Transcripcion'
import { Comentarios, type Borrador } from './Comentarios'
import { Resumen } from './Resumen'
import { Enlaces } from './Enlaces'

// Por debajo de este ancho la transcripción deja de ir al lado y pasa a ser una
// pestaña más, debajo del vídeo (en el móvil no caben dos columnas).
const ESTRECHO = '(max-width: 960px)'

function useEstrecho() {
  return useSyncExternalStore(
    (o) => {
      const m = matchMedia(ESTRECHO)
      m.addEventListener('change', o)
      return () => m.removeEventListener('change', o)
    },
    () => matchMedia(ESTRECHO).matches,
  )
}

type Pestana = 'transcripcion' | 'comentarios' | 'resumen' | 'enlaces'
const NOMBRES: Record<Pestana, string> = {
  transcripcion: k('Transcripción'),
  comentarios: k('Comentarios'),
  resumen: k('Resumen'),
  enlaces: k('Compartir con el cliente'),
}

interface Props {
  llamada: LlamadaDetalle
  rol?: Rol
  /** Solo en la vista del cliente: sin comentarios, sin compartir, solo lectura. */
  shareToken?: string
  comentarios?: Comentario[]
}

export function VistaLlamada({ llamada, rol, shareToken, comentarios }: Props) {
  const cliente = Boolean(shareToken)
  const puedeComentar = !cliente && rol !== undefined
  const puedeCompartir = !cliente && (rol === 'owner' || rol === 'admin')
  const estrecho = useEstrecho()

  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const [tiempo, setTiempo] = useState(0)
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [destacado, setDestacado] = useState<string | undefined>()

  const pestanas: Pestana[] = [
    ...(estrecho ? ['transcripcion' as const] : []),
    ...(puedeComentar ? ['comentarios' as const] : []),
    'resumen',
    ...(puedeCompartir ? ['enlaces' as const] : []),
  ]
  const [elegida, setElegida] = useState<Pestana | null>(null)
  // Si la elegida deja de existir (se estrecha la ventana), vale la primera.
  const pestana = elegida && pestanas.includes(elegida) ? elegida : pestanas[0]!

  const saltar = (s: number) => {
    const el = mediaRef.current
    setTiempo(s)
    if (!el) return
    el.currentTime = s
    void el.play().catch(() => { /* el navegador puede pedir un gesto antes */ })
  }

  const marcas: Marca[] = (comentarios ?? [])
    .filter((c) => c.atSec !== undefined && !c.parentId)
    .map((c) => ({ id: c._id, atSec: c.atSec!, resuelto: Boolean(c.resolvedAt), texto: c.body }))

  const abrirComentario = () => {
    mediaRef.current?.pause()
    setBorrador({ atSec: mediaRef.current?.currentTime ?? tiempo })
    setElegida('comentarios')
  }

  const alPincharMarca = (id: string) => {
    setDestacado(id)
    setElegida('comentarios')
    // Tras pintar la pestaña: el comentario a la vista, dentro de su lista.
    requestAnimationFrame(() => document.getElementById(`comentario-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  const transcripcion = (
    <Transcripcion
      segmentos={llamada.transcript?.segments}
      texto={llamada.transcript?.text ?? ''}
      tiempo={tiempo}
      onSaltar={saltar}
      comentados={marcas.map((m) => m.atSec)}
    />
  )

  return (
    <main className="llamada">
      <div className="llamada__cabeza">
        {!cliente && (
          <button className="enlace llamada__volver" onClick={() => navegar('/')}>← {t('Llamadas')}</button>
        )}
        <h1 className="llamada__titulo">{llamada.candidate.name || llamada.sessionName}</h1>
        <div className="llamada__meta">
          {llamada.candidate.name && <span>{llamada.sessionName}</span>}
          {llamada.candidate.role && <span>{llamada.candidate.role}</span>}
          <span>{llamada.project.name}</span>
          <span>{fecha(llamada.createdAt)}</span>
          <span>{duracion(llamada.durationSec)}</span>
          {llamada.interviewerName && <span>{t('Con {nombre}', { nombre: llamada.interviewerName })}</span>}
        </div>
        {cliente && <p className="llamada__aviso-cliente">{t('Te han compartido esta llamada para que la veas. Es solo lectura.')}</p>}
      </div>

      <div className={estrecho ? 'llamada__rejilla llamada__rejilla--estrecha' : 'llamada__rejilla'}>
        <section className="llamada__principal">
          <div className="llamada__video">
            <Reproductor
              archivos={llamada.media}
              duracionSec={llamada.durationSec}
              shareToken={shareToken}
              mediaRef={mediaRef}
              marcas={marcas}
              onMarca={alPincharMarca}
              onTiempo={setTiempo}
            />
            {puedeComentar && (
              <button className="boton boton--secundario boton--ancho llamada__comentar" onClick={abrirComentario}>
                + {t('Comentar en este momento')}
              </button>
            )}
          </div>

          <div className="pestanas" role="tablist">
            {pestanas.map((p) => (
              <button
                key={p}
                role="tab"
                aria-selected={p === pestana}
                className={p === pestana ? 'pestana pestana--activa' : 'pestana'}
                onClick={() => setElegida(p)}
              >
                {t(NOMBRES[p])}
                {p === 'comentarios' && comentarios && comentarios.length > 0 && (
                  <span className="pestana__cuenta">{comentarios.filter((c) => !c.resolvedAt && !c.parentId).length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="panel" role="tabpanel">
            {pestana === 'transcripcion' && transcripcion}
            {pestana === 'comentarios' && (
              <Comentarios
                interviewId={llamada._id}
                comentarios={comentarios}
                rol={rol}
                tiempo={tiempo}
                borrador={borrador}
                onBorrador={setBorrador}
                onSaltar={saltar}
                destacado={destacado}
              />
            )}
            {pestana === 'resumen' && <Resumen texto={llamada.summaryText} />}
            {pestana === 'enlaces' && <Enlaces interviewId={llamada._id} />}
          </div>
        </section>

        {!estrecho && (
          <aside className="llamada__lateral">
            <h2 className="lateral__titulo">{t('Transcripción')}</h2>
            {transcripcion}
          </aside>
        )}
      </div>
    </main>
  )
}
