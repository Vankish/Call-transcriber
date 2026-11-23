import { useDatos } from '../data/contexto'
import { getIdioma, setIdioma, t, type Idioma } from '../i18n'
import { interpretar, navegar, useDireccion } from '../ruta'

export function Marca() {
  return (
    <span className="marca">
      <svg className="marca__icono" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="currentColor" />
        <path d="M9 12v8M13 9v14M17 13v6M21 10v12M25 14v4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span className="marca__nombre">Call Transcriber</span>
    </span>
  )
}

export function SelectorIdioma() {
  return (
    <select
      className="selector-idioma"
      aria-label={t('Idioma')}
      value={getIdioma()}
      onChange={(e) => setIdioma(e.target.value as Idioma)}
    >
      <option value="es">Español</option>
      <option value="en">English</option>
    </select>
  )
}

/** Barra de arriba. `soloMarca` para el cliente: no tiene cuenta ni a dónde ir. */
export function Cabecera({ soloMarca }: { soloMarca?: boolean }) {
  return (
    <header className="cabecera">
      <div className="cabecera__dentro">
        {soloMarca ? <Marca /> : <a href="/" className="cabecera__inicio" onClick={(e) => { e.preventDefault(); navegar('/') }}><Marca /></a>}
        {!soloMarca && <Navegacion />}
        <div className="cabecera__fin">
          <SelectorIdioma />
          {!soloMarca && <BotonSalir />}
        </div>
      </div>
    </header>
  )
}

function Navegacion() {
  const datos = useDatos()
  const membresias = datos.useMembresias()
  const ruta = interpretar(useDireccion())
  const esAdmin = membresias?.some((m) => m.role === 'owner' || m.role === 'admin')
  const enlace = (a: string, texto: string, activo: boolean) => (
    <a href={a} className={activo ? 'nav__enlace nav__enlace--activo' : 'nav__enlace'} onClick={(e) => { e.preventDefault(); navegar(a) }}>
      {texto}
    </a>
  )
  return (
    <nav className="nav">
      {enlace('/', t('Llamadas'), ruta.nombre === 'inicio' || ruta.nombre === 'llamada')}
      {esAdmin && enlace('/personas', t('Personas'), ruta.nombre === 'personas')}
    </nav>
  )
}

function BotonSalir() {
  const { salir } = useDatos().useAccionesSesion()
  return (
    <button className="boton boton--fantasma boton--pequeno" onClick={() => { void salir().then(() => navegar('/', { reemplazar: true })) }}>
      {t('Salir')}
    </button>
  )
}
