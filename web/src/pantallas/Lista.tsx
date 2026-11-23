import { useDatos } from '../data/contexto'
import type { LlamadaFila, Membresia, Proyecto } from '../data/tipos'
import { t } from '../i18n'
import { duracion, fecha } from '../formato'
import { navegar } from '../ruta'
import { Esqueleto, Vacio } from './Estados'

export function Lista({ proyecto }: { proyecto?: string }) {
  const datos = useDatos()
  const membresias = datos.useMembresias()
  const proyectos = datos.useProyectos(undefined)
  const llamadas = datos.useMisLlamadas(proyecto)

  // Registrarse no da acceso a nada: sin espacio, la lista vacía confundiría.
  if (membresias && membresias.length === 0) {
    return (
      <main className="pagina">
        <Vacio
          icono="✉"
          titulo={t('Aún no tienes acceso a ninguna llamada')}
          texto={t('Pide a quien te quiera compartir sus llamadas que te invite con este mismo correo. En cuanto lo haga, aparecerán aquí.')}
        />
      </main>
    )
  }

  const filtrar = (id: string) => navegar(id ? `/?proyecto=${encodeURIComponent(id)}` : '/', { reemplazar: true })

  return (
    <main className="pagina">
      <div className="pagina__cabeza">
        <div>
          <h1 className="pagina__titulo">{t('Llamadas')}</h1>
          <p className="pagina__sub">{t('Las más recientes primero.')}</p>
        </div>
        <FiltroProyecto proyectos={proyectos} membresias={membresias} valor={proyecto ?? ''} onCambio={filtrar} />
      </div>

      {llamadas === undefined ? (
        <Esqueleto filas={4} />
      ) : llamadas.length === 0 ? (
        proyecto ? (
          <Vacio titulo={t('Este proyecto no tiene llamadas')} texto={t('Prueba con otro proyecto o quita el filtro.')}>
            <button className="boton boton--secundario" onClick={() => filtrar('')}>{t('Ver todas')}</button>
          </Vacio>
        ) : (
          <Vacio titulo={t('Todavía no hay llamadas')} texto={t('Cuando te compartan una llamada, aparecerá aquí.')} />
        )
      ) : (
        <ul className="tarjetas">
          {llamadas.map((l) => <Tarjeta key={l._id} l={l} />)}
        </ul>
      )}
    </main>
  )
}

function FiltroProyecto({ proyectos, membresias, valor, onCambio }: {
  proyectos: Proyecto[] | undefined; membresias: Membresia[] | undefined; valor: string; onCambio: (id: string) => void
}) {
  if (!proyectos || proyectos.length < 2) return null
  // Un coach puede estar en varios espacios: si es así, se agrupan por espacio
  // para que dos proyectos con el mismo nombre no se confundan.
  const espacios = [...new Set(proyectos.map((p) => p.workspaceId))]
  const nombre = (w: string) => membresias?.find((m) => m.workspaceId === w)?.workspaceName ?? ''
  const opcion = (p: Proyecto) => <option key={p._id} value={p._id}>{p.name}</option>
  return (
    <label className="filtro">
      <span className="filtro__etiqueta">{t('Proyecto')}</span>
      <select value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">{t('Todos los proyectos')}</option>
        {espacios.length > 1
          ? espacios.map((w) => (
            <optgroup key={w} label={nombre(w)}>
              {proyectos.filter((p) => p.workspaceId === w).map(opcion)}
            </optgroup>
          ))
          : proyectos.map(opcion)}
      </select>
    </label>
  )
}

function Tarjeta({ l }: { l: LlamadaFila }) {
  const a = `/i/${encodeURIComponent(l._id)}`
  return (
    <li>
      <a className="tarjeta" href={a} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); navegar(a) } }}>
        <div className={l.tieneVideo ? 'tarjeta__miniatura' : 'tarjeta__miniatura tarjeta__miniatura--audio'} aria-hidden>
          {l.tieneVideo ? '▶' : '♪'}
          <span className="tarjeta__duracion">{duracion(l.durationSec)}</span>
        </div>
        <div className="tarjeta__cuerpo">
          <div className="tarjeta__titulo">{l.candidateName || l.sessionName}</div>
          <div className="tarjeta__sesion">{l.candidateName ? l.sessionName : ''}</div>
          <div className="tarjeta__pie">
            <span className={l.projectKind === 'clientes' ? 'chip chip--cliente' : 'chip chip--entrevista'}>
              {l.projectKind === 'clientes' ? t('Cliente') : t('Entrevista')}
            </span>
            <span className="tarjeta__proyecto">{l.projectName}</span>
            <span className="tarjeta__fecha">{fecha(l.createdAt)}</span>
          </div>
        </div>
      </a>
    </li>
  )
}
