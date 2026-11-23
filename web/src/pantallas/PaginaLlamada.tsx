import { useDatos } from '../data/contexto'
import { VistaLlamada } from './VistaLlamada'
import { Cargando } from './Estados'
import { t } from '../i18n'

/** /i/{interviewId}: coaches y compañeros, con cuenta. */
export function PaginaLlamada({ interviewId }: { interviewId: string }) {
  const datos = useDatos()
  const llamada = datos.useLlamada(interviewId)
  const membresias = datos.useMembresias()
  const comentarios = datos.useComentarios(interviewId)
  if (!llamada) return <Cargando texto={t('Cargando la llamada…')} pantalla />
  const rol = membresias?.find((m) => m.workspaceId === llamada.workspaceId)?.role
  return <VistaLlamada llamada={llamada} rol={rol} comentarios={comentarios} />
}
