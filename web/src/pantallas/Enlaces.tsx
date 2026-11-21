import { useState, type FormEvent } from 'react'
import { useDatos } from '../data/contexto'
import type { Enlace, EnlaceNuevo } from '../data/tipos'
import { t } from '../i18n'
import { fechaHora, relativo } from '../formato'
import { useAhora } from '../reloj'
import { AvisoError, Esqueleto } from './Estados'

/** Enlaces de cliente de una llamada: solo owner y admin llegan aquí. */
export function Enlaces({ interviewId }: { interviewId: string }) {
  const datos = useDatos()
  const enlaces = datos.useEnlaces(interviewId)
  const { create } = datos.useAccionesEnlace()
  const [etiqueta, setEtiqueta] = useState('')
  const [nuevo, setNuevo] = useState<EnlaceNuevo | null>(null)
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function crear(e: FormEvent) {
    e.preventDefault()
    setCreando(true)
    setError(null)
    try {
      setNuevo(await create({ interviewId, label: etiqueta.trim() }))
      setEtiqueta('')
    } catch (err) {
      setError(err)
    } finally {
      setCreando(false)
    }
  }

  return (
    <div className="enlaces">
      <p className="enlaces__intro">
        {t('Un enlace de cliente deja ver esta llamada sin cuenta: vídeo, transcripción y resumen, sin comentarios ni datos de contacto. Caduca a los 7 días.')}
      </p>

      <form className="enlaces__crear" onSubmit={(e) => { void crear(e) }}>
        <label className="campo campo--crece">
          <span className="campo__etiqueta">{t('Para quién es')}</span>
          <input
            value={etiqueta}
            onChange={(e) => setEtiqueta(e.target.value)}
            required
            maxLength={80}
            placeholder={t('Ej.: Laura, directora de compras')}
          />
        </label>
        <button className="boton boton--primario" type="submit" disabled={creando || !etiqueta.trim()}>
          {creando ? t('Creando…') : t('Crear enlace')}
        </button>
      </form>
      <AvisoError error={error} />

      {nuevo && <EnlaceRecienCreado nuevo={nuevo} onCerrar={() => setNuevo(null)} />}

      {enlaces === undefined ? (
        <Esqueleto filas={2} />
      ) : enlaces.length === 0 ? (
        <p className="panel__vacio">{t('Todavía no has compartido esta llamada con ningún cliente.')}</p>
      ) : (
        <ul className="lista-enlaces">
          {enlaces.map((e) => <FilaEnlace key={e._id} e={e} />)}
        </ul>
      )}
    </div>
  )
}

function EnlaceRecienCreado({ nuevo, onCerrar }: { nuevo: EnlaceNuevo; onCerrar: () => void }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(nuevo.url)
      setCopiado(true)
    } catch {
      // Sin permiso de portapapeles (http, iframes): que lo copie a mano.
      setCopiado(false)
    }
  }
  return (
    <div className="enlace-nuevo" role="status">
      <strong>{t('Enlace creado')}</strong>
      <div className="enlace-nuevo__fila">
        <input readOnly value={nuevo.url} onFocus={(e) => e.target.select()} aria-label={t('Enlace')} />
        <button className="boton boton--primario" onClick={() => { void copiar() }}>{copiado ? t('Copiado') : t('Copiar')}</button>
      </div>
      {/* El servidor solo guarda el hash del token: si se pierde, no hay forma
          de volver a enseñarlo y hay que crear otro. */}
      <p className="enlace-nuevo__aviso">{t('Cópialo ahora: por seguridad no se puede volver a ver. Si lo pierdes, crea otro y revoca este.')}</p>
      <button className="enlace" onClick={onCerrar}>{t('Hecho')}</button>
    </div>
  )
}

function FilaEnlace({ e }: { e: Enlace }) {
  const { renew, revoke } = useDatos().useAccionesEnlace()
  const ahora = useAhora()
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const estado = e.revokedAt ? 'revocado' : e.expiresAt < ahora ? 'caducado' : 'activo'

  async function hacer(f: () => Promise<void>) {
    setOcupado(true)
    setError(null)
    try { await f() } catch (err) { setError(err) } finally { setOcupado(false) }
  }

  return (
    <li className={`fila-enlace fila-enlace--${estado}`}>
      <div className="fila-enlace__info">
        <div className="fila-enlace__titulo">
          <strong>{e.label}</strong>
          <span className={`chip chip--${estado}`}>
            {estado === 'activo' ? t('Activo') : estado === 'caducado' ? t('Caducado') : t('Revocado')}
          </span>
        </div>
        <div className="fila-enlace__meta">
          {estado === 'activo' && <span>{t('Caduca {cuando}', { cuando: relativo(e.expiresAt, ahora) })}</span>}
          {estado === 'caducado' && <span>{t('Caducó {cuando}', { cuando: relativo(e.expiresAt, ahora) })}</span>}
          {estado === 'revocado' && e.revokedAt && <span>{t('Revocado {cuando}', { cuando: relativo(e.revokedAt, ahora) })}</span>}
          <span>
            {e.openCount === 0
              ? t('Sin abrir')
              : e.openCount === 1 ? t('Abierto 1 vez') : t('Abierto {n} veces', { n: e.openCount })}
            {e.lastOpenedAt ? ` · ${t('última, {cuando}', { cuando: fechaHora(e.lastOpenedAt) })}` : ''}
          </span>
        </div>
        <AvisoError error={error} />
      </div>
      {estado !== 'revocado' && (
        <div className="fila-enlace__acciones">
          <button className="boton boton--secundario boton--pequeno" disabled={ocupado} onClick={() => void hacer(() => renew({ shareLinkId: e._id }))}>
            {t('Renovar 7 días')}
          </button>
          {estado === 'activo' && (
            <button
              className="boton boton--peligro boton--pequeno"
              disabled={ocupado}
              onClick={() => { if (window.confirm(t('¿Revocar este enlace? Quien lo tenga dejará de poder abrir la llamada.'))) void hacer(() => revoke({ shareLinkId: e._id })) }}
            >
              {t('Revocar')}
            </button>
          )}
        </div>
      )}
    </li>
  )
}
