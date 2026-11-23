import { useDatos } from '../data/contexto'
import { t } from '../i18n'
import { VistaLlamada } from './VistaLlamada'
import { Cargando } from './Estados'

/** /l/{token}: el cliente, sin cuenta. */
export function PaginaCliente({ token }: { token: string }) {
  const llamada = useDatos().useLlamadaCliente(token)
  if (!llamada) return <Cargando texto={t('Abriendo la llamada…')} pantalla />
  if ('expired' in llamada) return <Caducado />
  return <VistaLlamada llamada={llamada} shareToken={token} />
}

// share.open no dice si el enlace caducó, se revocó o nunca existió (así nadie
// puede ir probando enlaces), y esta página tampoco: solo qué hacer.
function Caducado() {
  return (
    <main className="caducado">
      <div className="caducado__caja">
        <div className="caducado__icono" aria-hidden>⏳</div>
        <h1>{t('Este enlace ya no está activo')}</h1>
        <p>{t('Los enlaces para ver una llamada duran 7 días, y quien te lo mandó también puede desactivarlo antes.')}</p>
        <p>{t('Si todavía necesitas verla, pide a esa persona que te mande un enlace nuevo. Tardará un momento.')}</p>
      </div>
    </main>
  )
}
