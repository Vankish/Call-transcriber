import type { ReactNode } from 'react'
import { t } from '../i18n'
import { mensajeDeError } from '../errores'
import { navegar } from '../ruta'

export function Cargando({ texto, pantalla }: { texto?: string; pantalla?: boolean }) {
  return (
    <div className={pantalla ? 'cargando cargando--pantalla' : 'cargando'} role="status">
      <span className="cargando__rueda" aria-hidden />
      <span>{texto ?? t('Cargando…')}</span>
    </div>
  )
}

/** Hueco gris con la forma de lo que va a llegar: la página no "salta" al cargar. */
export function Esqueleto({ filas = 3 }: { filas?: number }) {
  return (
    <div className="esqueleto" aria-hidden>
      {Array.from({ length: filas }, (_, i) => <div key={i} className="esqueleto__fila" />)}
    </div>
  )
}

export function Vacio({ titulo, texto, icono = '○', volver, children }: {
  titulo: string; texto?: string; icono?: string; volver?: boolean; children?: ReactNode
}) {
  return (
    <div className="vacio">
      <div className="vacio__icono" aria-hidden>{icono}</div>
      <h2 className="vacio__titulo">{titulo}</h2>
      {texto && <p className="vacio__texto">{texto}</p>}
      {children}
      {volver && <button className="boton boton--secundario" onClick={() => navegar('/')}>{t('Ir a mis llamadas')}</button>}
    </div>
  )
}

export function CajaError({ error, titulo, volver }: { error: unknown; titulo?: string; volver?: boolean }) {
  return (
    <Vacio icono="!" titulo={titulo ?? t('No se ha podido cargar')} texto={mensajeDeError(error)} volver={volver}>
      <button className="boton boton--secundario" onClick={() => location.reload()}>{t('Volver a probar')}</button>
    </Vacio>
  )
}

/** Mensaje de error en línea, debajo de un formulario o de un botón. */
export function AvisoError({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="aviso-error" role="alert">{mensajeDeError(error)}</p>
}
