import { useState, type FormEvent } from 'react'
import { useDatos } from '../data/contexto'
import type { Invitacion, Miembro, Proyecto, Rol, RolInvitable } from '../data/tipos'
import { k, t } from '../i18n'
import { relativo } from '../formato'
import { useAhora } from '../reloj'
import { AvisoError, Esqueleto, Vacio } from './Estados'

const PAPELES: Record<Rol, { nombre: string; que: string }> = {
  owner: { nombre: k('Dueño'), que: k('Todo, incluido repartir accesos.') },
  admin: { nombre: k('Administrador'), que: k('Todo menos borrar el espacio. Llega a todos los proyectos.') },
  editor: { nombre: k('Compañero'), que: k('Ve, comenta y edita en sus proyectos.') },
  coach: { nombre: k('Coach'), que: k('Ve el vídeo y comenta en sus proyectos. No edita nada.') },
}
const INVITABLES: RolInvitable[] = ['coach', 'editor', 'admin']

/** Dueño y admin llegan a todo: elegir proyectos solo tiene sentido para el resto. */
const usaProyectos = (r: Rol) => r === 'coach' || r === 'editor'

export function Personas() {
  const datos = useDatos()
  const membresias = datos.useMembresias()
  // Los espacios que se pueden gestionar desde aquí: el propio primero. Un admin
  // de varios espacios elige cuál; el elegido va en todas las llamadas de
  // member.*, porque sin él el backend no sabe de cuál se habla.
  const gestionables = (membresias ?? [])
    .filter((m) => m.role === 'owner' || m.role === 'admin')
    .sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'))
  const [elegido, setElegido] = useState<string | null>(null)
  const espacio = gestionables.find((m) => m.workspaceId === elegido) ?? gestionables[0]
  const proyectos = datos.useProyectos(espacio?.workspaceId)

  if (membresias && !espacio) {
    return (
      <main className="pagina">
        <Vacio titulo={t('Solo el dueño del espacio puede ver esta página')} texto={t('Desde aquí se invita a coaches y compañeros.')} volver />
      </main>
    )
  }

  return (
    <main className="pagina pagina--estrecha">
      <div className="pagina__cabeza">
        <div>
          <h1 className="pagina__titulo">{t('Personas')}</h1>
          {gestionables.length > 1 ? null : <p className="pagina__sub">{espacio?.workspaceName}</p>}
        </div>
        {gestionables.length > 1 && (
          <label className="filtro">
            <span className="filtro__etiqueta">{t('Espacio')}</span>
            <select value={espacio?.workspaceId ?? ''} onChange={(e) => setElegido(e.target.value)}>
              {gestionables.map((m) => <option key={m.workspaceId} value={m.workspaceId}>{m.workspaceName}</option>)}
            </select>
          </label>
        )}
      </div>
      {/* key: al cambiar de espacio, el formulario y la lista empiezan de cero. */}
      <Invitar key={`i-${espacio?.workspaceId}`} workspaceId={espacio?.workspaceId} proyectos={proyectos ?? []} />
      <ListaPersonas key={`l-${espacio?.workspaceId}`} workspaceId={espacio?.workspaceId} proyectos={proyectos ?? []} />
    </main>
  )
}

function Invitar({ workspaceId, proyectos }: { workspaceId: string | undefined; proyectos: Proyecto[] }) {
  const { invite } = useDatos().useAccionesPersonas()
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState<RolInvitable>('coach')
  const [elegidos, setElegidos] = useState<string[]>([])
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [hecho, setHecho] = useState('')

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    setHecho('')
    try {
      await invite({ email: email.trim(), role: rol, projectIds: usaProyectos(rol) ? elegidos : [], workspaceId })
      setHecho(email.trim())
      setEmail('')
      setElegidos([])
    } catch (err) {
      setError(err)
    } finally {
      setEnviando(false)
    }
  }

  const sinProyectos = usaProyectos(rol) && elegidos.length === 0

  return (
    <section className="tarjeta-seccion">
      <h2 className="tarjeta-seccion__titulo">{t('Invitar a alguien')}</h2>
      <p className="tarjeta-seccion__texto">
        {t('Cuando esa persona entre con Google o con contraseña usando este correo, tendrá acceso. No hace falta que tenga cuenta todavía.')}
      </p>
      <form className="formulario" onSubmit={(e) => { void enviar(e) }}>
        <div className="formulario__fila">
          <label className="campo campo--crece">
            <span className="campo__etiqueta">{t('Correo')}</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" />
          </label>
          <label className="campo">
            <span className="campo__etiqueta">{t('Papel')}</span>
            <select value={rol} onChange={(e) => setRol(e.target.value as RolInvitable)}>
              {INVITABLES.map((r) => <option key={r} value={r}>{t(PAPELES[r].nombre)}</option>)}
            </select>
          </label>
        </div>
        <p className="campo__ayuda">{t(PAPELES[rol].que)}</p>
        {usaProyectos(rol) && (
          <SelectorProyectos proyectos={proyectos} elegidos={elegidos} onCambio={setElegidos} />
        )}
        <AvisoError error={error} />
        {hecho && <p className="aviso-ok" role="status">{t('Invitación lista para {email}. Avísale de que ya puede entrar.', { email: hecho })}</p>}
        <div className="formulario__pie">
          {sinProyectos && <span className="campo__ayuda">{t('Elige al menos un proyecto: sin proyectos no vería nada.')}</span>}
          <button className="boton boton--primario" type="submit" disabled={enviando || !email.trim() || sinProyectos}>
            {enviando ? t('Invitando…') : t('Invitar')}
          </button>
        </div>
      </form>
    </section>
  )
}

function SelectorProyectos({ proyectos, elegidos, onCambio }: { proyectos: Proyecto[]; elegidos: string[]; onCambio: (ids: string[]) => void }) {
  if (proyectos.length === 0) return <p className="campo__ayuda">{t('Todavía no hay proyectos subidos desde el escritorio.')}</p>
  return (
    <fieldset className="proyectos">
      <legend className="campo__etiqueta">{t('Proyectos a los que llega')}</legend>
      {proyectos.map((p) => (
        <label key={p._id} className="proyectos__opcion">
          <input
            type="checkbox"
            checked={elegidos.includes(p._id)}
            onChange={(e) => onCambio(e.target.checked ? [...elegidos, p._id] : elegidos.filter((x) => x !== p._id))}
          />
          <span>{p.name}</span>
          <span className="proyectos__tipo">{p.kind === 'clientes' ? t('Clientes') : t('Entrevistas')}</span>
        </label>
      ))}
    </fieldset>
  )
}

function ListaPersonas({ workspaceId, proyectos }: { workspaceId: string | undefined; proyectos: Proyecto[] }) {
  const personas = useDatos().usePersonas(workspaceId)
  if (!personas) return <Esqueleto filas={4} />
  const activos = personas.members.filter((m) => m.status === 'active')
  const desactivados = personas.members.filter((m) => m.status === 'disabled')
  return (
    <>
      {personas.invitations.length > 0 && (
        <section className="tarjeta-seccion">
          <h2 className="tarjeta-seccion__titulo">{t('Invitaciones pendientes')} <span className="cuenta">{personas.invitations.length}</span></h2>
          <ul className="personas">
            {personas.invitations.map((i) => <FilaInvitacion key={i._id} i={i} proyectos={proyectos} />)}
          </ul>
        </section>
      )}
      <section className="tarjeta-seccion">
        <h2 className="tarjeta-seccion__titulo">{t('Con acceso')} <span className="cuenta">{activos.length}</span></h2>
        <ul className="personas">
          {activos.map((m) => <FilaMiembro key={m._id} m={m} proyectos={proyectos} />)}
        </ul>
      </section>
      {desactivados.length > 0 && (
        <section className="tarjeta-seccion">
          <h2 className="tarjeta-seccion__titulo">{t('Desactivados')} <span className="cuenta">{desactivados.length}</span></h2>
          <ul className="personas">
            {desactivados.map((m) => <FilaMiembro key={m._id} m={m} proyectos={proyectos} />)}
          </ul>
        </section>
      )}
    </>
  )
}

const nombresDe = (ids: string[], proyectos: Proyecto[]) =>
  ids.map((id) => proyectos.find((p) => p._id === id)?.name).filter(Boolean).join(', ')

function FilaInvitacion({ i, proyectos }: { i: Invitacion; proyectos: Proyecto[] }) {
  const { revokeInvitation } = useDatos().useAccionesPersonas()
  const ahora = useAhora()
  const [error, setError] = useState<unknown>(null)
  return (
    <li className="persona">
      <span className="avatar avatar--vacio" aria-hidden>@</span>
      <div className="persona__info">
        <strong>{i.email}</strong>
        <span className="persona__meta">
          {t(PAPELES[i.role].nombre)}
          {usaProyectos(i.role) && i.projectIds.length > 0 && ` · ${nombresDe(i.projectIds, proyectos)}`}
          {` · ${t('invitado {cuando}', { cuando: relativo(i.createdAt, ahora) })}`}
        </span>
        <AvisoError error={error} />
      </div>
      <button
        className="boton boton--fantasma boton--pequeno"
        onClick={() => { revokeInvitation({ invitationId: i._id }).catch(setError) }}
      >
        {t('Anular')}
      </button>
    </li>
  )
}

function FilaMiembro({ m, proyectos }: { m: Miembro; proyectos: Proyecto[] }) {
  const { update } = useDatos().useAccionesPersonas()
  const [editando, setEditando] = useState(false)
  const [rol, setRol] = useState<Rol>(m.role)
  const [elegidos, setElegidos] = useState(m.projectIds)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function hacer(cambios: { role?: Rol; projectIds?: string[]; status?: 'active' | 'disabled' }) {
    setOcupado(true)
    setError(null)
    try {
      await update({ memberId: m._id, ...cambios })
      setEditando(false)
    } catch (e) {
      setError(e)
    } finally {
      setOcupado(false)
    }
  }

  const esDueno = m.role === 'owner'

  return (
    <li className={m.status === 'disabled' ? 'persona persona--desactivada' : 'persona'}>
      <span className="avatar" aria-hidden>{(m.name || m.email).slice(0, 1).toUpperCase()}</span>
      <div className="persona__info">
        <strong>{m.name || m.email}</strong>
        <span className="persona__meta">
          {m.name && `${m.email} · `}{t(PAPELES[m.role].nombre)}
          {usaProyectos(m.role) && ` · ${nombresDe(m.projectIds, proyectos) || t('ningún proyecto')}`}
        </span>
        {editando && (
          <div className="persona__edicion">
            <label className="campo">
              <span className="campo__etiqueta">{t('Papel')}</span>
              <select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
                {INVITABLES.map((r) => <option key={r} value={r}>{t(PAPELES[r].nombre)}</option>)}
              </select>
            </label>
            {usaProyectos(rol) && <SelectorProyectos proyectos={proyectos} elegidos={elegidos} onCambio={setElegidos} />}
            <div className="formulario__pie">
              <button className="boton boton--fantasma boton--pequeno" onClick={() => { setEditando(false); setRol(m.role); setElegidos(m.projectIds) }}>{t('Cancelar')}</button>
              <button
                className="boton boton--primario boton--pequeno"
                disabled={ocupado}
                onClick={() => void hacer({ role: rol, projectIds: usaProyectos(rol) ? elegidos : [] })}
              >
                {t('Guardar')}
              </button>
            </div>
          </div>
        )}
        <AvisoError error={error} />
      </div>
      {esDueno ? (
        null
      ) : !editando && (
        <div className="persona__acciones">
          {m.status === 'active' && <button className="boton boton--secundario boton--pequeno" onClick={() => setEditando(true)}>{t('Cambiar')}</button>}
          <button
            className={m.status === 'active' ? 'boton boton--fantasma boton--pequeno' : 'boton boton--secundario boton--pequeno'}
            disabled={ocupado}
            onClick={() => void hacer({ status: m.status === 'active' ? 'disabled' : 'active' })}
          >
            {m.status === 'active' ? t('Desactivar') : t('Reactivar')}
          </button>
        </div>
      )}
    </li>
  )
}
