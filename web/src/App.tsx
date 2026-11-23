import { useDatos } from './data/contexto'
import { t, useIdioma } from './i18n'
import { interpretar, useDireccion } from './ruta'
import { Limite } from './Limite'
import { codigoDe } from './errores'
import { Cabecera } from './pantallas/Cabecera'
import { Entrar } from './pantallas/Entrar'
import { Lista } from './pantallas/Lista'
import { PaginaLlamada } from './pantallas/PaginaLlamada'
import { PaginaCliente } from './pantallas/PaginaCliente'
import { Personas } from './pantallas/Personas'
import { Cargando, CajaError, Vacio } from './pantallas/Estados'

export function App() {
  // Leer el idioma aquí hace que cambiarlo repinte toda la web.
  const idioma = useIdioma()
  const dir = useDireccion()
  const ruta = interpretar(dir)
  const datos = useDatos()
  const sesion = datos.useSesion()

  // El cliente no tiene cuenta: su página no espera a la sesión ni la pide.
  if (ruta.nombre === 'cliente') {
    return (
      <div className="web" key={idioma}>
        <Cabecera soloMarca />
        <Limite clave={dir} fallo={(e) => <CajaError error={e} />}>
          <PaginaCliente token={ruta.token} />
        </Limite>
      </div>
    )
  }

  if (sesion.estado === 'cargando') {
    return <div className="web" key={idioma}><Cargando texto={t('Cargando…')} pantalla /></div>
  }

  if (sesion.estado === 'fuera') {
    return <div className="web" key={idioma}><Entrar /></div>
  }

  let pagina
  if (ruta.nombre === 'inicio') pagina = <Lista proyecto={ruta.proyecto} />
  else if (ruta.nombre === 'llamada') pagina = <PaginaLlamada interviewId={ruta.id} />
  else if (ruta.nombre === 'personas') pagina = <Personas />
  else pagina = <Vacio titulo={t('Esta página no existe')} texto={t('Revisa la dirección o vuelve a la lista de llamadas.')} volver />

  return (
    <div className="web" key={idioma}>
      <Cabecera />
      <Limite
        clave={dir}
        fallo={(e) => <CajaError error={e} titulo={codigoDe(e) === 'NOT_FOUND' ? t('No encontramos esta llamada') : undefined} volver />}
      >
        {pagina}
      </Limite>
    </div>
  )
}
