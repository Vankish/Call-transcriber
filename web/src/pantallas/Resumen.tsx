import { Fragment, type ReactNode } from 'react'
import { t } from '../i18n'

// El resumen llega en el Markdown sencillo que escribe la IA en el escritorio:
// títulos con ##, listas con - y **negritas**. Un intérprete completo sería una
// dependencia para cuatro reglas; y pintar HTML que viene de fuera no se hace.
function enLinea(texto: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((trozo, i) =>
    trozo.startsWith('**') && trozo.endsWith('**') ? <strong key={i}>{trozo.slice(2, -2)}</strong> : <Fragment key={i}>{trozo}</Fragment>)
}

export function Resumen({ texto }: { texto: string }) {
  if (!texto.trim()) return <p className="panel__vacio">{t('Esta llamada aún no tiene resumen.')}</p>
  const bloques: ReactNode[] = []
  let lista: string[] = []
  const cerrarLista = () => {
    if (lista.length) bloques.push(<ul key={bloques.length}>{lista.map((l, i) => <li key={i}>{enLinea(l)}</li>)}</ul>)
    lista = []
  }
  for (const linea of texto.split('\n')) {
    const l = linea.trim()
    if (/^[-*•]\s+/.test(l)) { lista.push(l.replace(/^[-*•]\s+/, '')); continue }
    cerrarLista()
    if (!l) continue
    if (/^#{1,6}\s/.test(l)) bloques.push(<h3 key={bloques.length}>{enLinea(l.replace(/^#+\s*/, ''))}</h3>)
    else bloques.push(<p key={bloques.length}>{enLinea(l)}</p>)
  }
  cerrarLista()
  return <div className="resumen">{bloques}</div>
}
