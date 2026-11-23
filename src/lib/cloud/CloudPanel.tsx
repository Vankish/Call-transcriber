import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { k, locale, t } from '../../i18n'
import './CloudPanel.css'

// ── Nube: sesión, sincronización y subida de grabaciones ─────────────────────
//
// Vive aparte de App.tsx a propósito: App.tsx solo lo pinta en Configuración.
// Todo lo que hace pasa por el proceso principal (window.desktopApp.cloud*): la
// sesión, los tokens, la sincronización y la cola de subidas viven allí, y esta
// pantalla solo enseña su estado y manda órdenes. Si la app se compiló sin
// VITE_CONVEX_URL, no pinta nada.

const ERRORS: Record<string, string> = {
  'not-configured': k('Esta versión de la app no tiene la nube configurada.'),
  network: k('No hay conexión con la nube. Revisa internet y prueba otra vez.'),
  'invalid-credentials': k('Correo o contraseña incorrectos.'),
  'account-exists': k('Ya hay una cuenta con ese correo. Entra en vez de registrarte.'),
  'weak-password': k('La contraseña tiene que tener al menos 8 caracteres.'),
  'signup-failed': k('No se pudo crear la cuenta. Puede que ese correo ya esté registrado.'),
  'redirect-not-allowed': k('La nube todavía no acepta la vuelta de Google a esta app.'),
  'rate-limited': k('Demasiados intentos. Espera un minuto y prueba otra vez.'),
  'oauth-timeout': k('Se acabó el tiempo para entrar con Google. Prueba otra vez.'),
  expired: k('La sesión ha caducado. Vuelve a entrar.'),
  failed: k('No se pudo iniciar sesión.'),
}
const errorText = (code: string | null | undefined) => (code ? t(ERRORS[code] ?? ERRORS.failed) : '')

const PHASES: Record<string, string> = {
  preparing: k('Preparando'),
  compressing: k('Comprimiendo el vídeo'),
  hashing: k('Comprobando el archivo'),
  uploading: k('Subiendo'),
  finishing: k('Terminando'),
}

const MIN_PASSWORD = 8

function formatBytes(bytes: number): string {
  const nf = (n: number, d = 1) => n.toLocaleString(locale(), { maximumFractionDigits: d })
  if (bytes >= 1e9) return `${nf(bytes / 1e9)} GB`
  if (bytes >= 1e6) return `${nf(bytes / 1e6, 0)} MB`
  return `${nf(bytes / 1e3, 0)} KB`
}

const formatTime = (ms: number) =>
  new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function CloudPanel() {
  const desk = window.desktopApp
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [upload, setUpload] = useState<CloudUploadStatus | null>(null)
  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<null | 'password' | 'google' | 'signout' | 'sync'>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [plan, setPlan] = useState<CloudMigrationPlan | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [includeExternal, setIncludeExternal] = useState(false)
  const [migrationNote, setMigrationNote] = useState<string | null>(null)

  useEffect(() => {
    if (!desk?.cloudStatus) return
    let alive = true
    void desk.cloudStatus().then(s => { if (alive) setStatus(s) }).catch(() => {})
    void desk.cloudUploadStatus?.().then(s => { if (alive) setUpload(s) }).catch(() => {})
    const offStatus = desk.onCloudStatus?.(s => setStatus(s))
    const offUpload = desk.onCloudUploadProgress?.(s => setUpload(s))
    return () => { alive = false; offStatus?.(); offUpload?.() }
  }, [desk])

  if (!desk?.cloudStatus || !status?.configured) return null

  const session = status.session
  const sync = status.sync
  const signedIn = session?.state === 'signed-in'

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!email.trim() || !password) { setFormError(t('Escribe el correo y la contraseña.')); return }
    if (flow === 'signUp' && password.length < MIN_PASSWORD) { setFormError(errorText('weak-password')); return }
    setBusy('password')
    const r = await desk.cloudSignInPassword?.({ email, password, flow, name: name.trim() || undefined }).catch(() => null)
    setBusy(null)
    if (r?.ok) { setPassword(''); return }
    setFormError(errorText(r?.errorCode || 'failed'))
  }

  const signInGoogle = async () => {
    setFormError(null)
    setBusy('google')
    const r = await desk.cloudSignInGoogle?.().catch(() => null)
    setBusy(null)
    if (!r?.ok && r?.errorCode && r.errorCode !== 'oauth-cancelled') setFormError(errorText(r.errorCode))
  }

  const signOut = async () => {
    setBusy('signout')
    await desk.cloudSignOut?.().catch(() => null)
    setBusy(null)
    setPlan(null)
  }

  const syncNow = async () => {
    setBusy('sync')
    await desk.cloudSyncNow?.().catch(() => null)
    setBusy(null)
  }

  const loadPlan = async () => {
    setMigrationNote(null)
    setPlanBusy(true)
    const p = await desk.cloudMigrationPlan?.().catch(() => null)
    setPlanBusy(false)
    if (p) { setPlan(p); setIncludeExternal(false) } else setMigrationNote(t('No se pudo revisar la carpeta de grabaciones.'))
  }

  const runMigration = async () => {
    setPlanBusy(true)
    const r = await desk.cloudMigrationRun?.({ includeExternal }).catch(() => null)
    setPlanBusy(false)
    setPlan(null)
    setMigrationNote(r
      ? t('{n} archivos añadidos a la cola de subida.', { n: r.added + r.updated })
      : t('No se pudieron añadir los archivos a la cola.'))
  }

  // ── Estado de arriba ──────────────────────────────────────────────────────
  let headline: string
  let tone: 'off' | 'ok' | 'busy' | 'error' = 'off'
  if (!signedIn) {
    headline = session?.state === 'signing-in' ? t('Entrando…') : t('Sin sesión')
    if (session?.state === 'signing-in') tone = 'busy'
  } else if (sync?.state === 'syncing') {
    tone = 'busy'
    headline = sync.progress?.total
      ? t('Sincronizando {done}/{total}', { done: sync.progress.done, total: sync.progress.total })
      : t('Sincronizando…')
  } else if (sync?.state === 'error' || sync?.state === 'offline') {
    tone = 'error'
    headline = sync.state === 'offline' ? t('Sin conexión con la nube') : t('Error al sincronizar')
  } else {
    tone = 'ok'
    headline = t('Conectado como {cuenta}', { cuenta: session?.email || session?.name || t('tu cuenta') })
  }

  return (
    <div className="settings-section cloud-panel">
      <div className="settings-section-label">{t('NUBE')}</div>
      <div className="settings-section-divider" />
      <p className="cfg-field-desc">{t('Guarda una copia de tus carpetas, llamadas y grabaciones en la nube, para verlas desde la web y compartirlas con tu coach. Este PC sigue siendo el original: sin sesión o sin internet la app funciona igual.')}</p>

      <div className={`cloud-status cloud-status--${tone}`}>
        <span className="cloud-dot" />
        <span className="cloud-status-text">{headline}</span>
      </div>

      {!signedIn && (
        <div className="cloud-signin">
          {busy === 'google' ? (
            <div className="cloud-google-wait">
              <span>{t('Termina de entrar en la ventana del navegador que se ha abierto.')}</span>
              <button type="button" className="secondary-btn" onClick={() => void desk.cloudCancelGoogle?.()}>{t('Cancelar')}</button>
            </div>
          ) : (
            <button type="button" className="secondary-btn cloud-google-btn" disabled={busy !== null} onClick={() => void signInGoogle()}>
              <GoogleMark /> {t('Entrar con Google')}
            </button>
          )}

          <div className="cloud-or"><span>{t('o con correo')}</span></div>

          <div className="cfg-format-toggle">
            <button type="button" className={`cfg-fmt-btn${flow === 'signIn' ? ' is-active' : ''}`} onClick={() => { setFlow('signIn'); setFormError(null) }}>{t('Entrar')}</button>
            <button type="button" className={`cfg-fmt-btn${flow === 'signUp' ? ' is-active' : ''}`} onClick={() => { setFlow('signUp'); setFormError(null) }}>{t('Crear cuenta')}</button>
          </div>

          <form className="cloud-form" onSubmit={e => void submitPassword(e)}>
            {flow === 'signUp' && (
              <label className="cfg-field">
                <span className="cfg-field-label">{t('Nombre')}</span>
                <input className="cfg-input" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
              </label>
            )}
            <label className="cfg-field">
              <span className="cfg-field-label">{t('Correo')}</span>
              <input className="cfg-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
            </label>
            <label className="cfg-field">
              <span className="cfg-field-label">{t('Contraseña')}</span>
              <input className="cfg-input" type="password" autoComplete={flow === 'signUp' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} />
              {flow === 'signUp' && <span className="cfg-field-desc">{t('Al menos 8 caracteres.')}</span>}
            </label>
            <div>
              <button type="submit" className="primary-btn pill-btn" disabled={busy !== null}>
                {busy === 'password' ? t('Entrando…') : flow === 'signIn' ? t('Entrar') : t('Crear cuenta')}
              </button>
            </div>
          </form>

          {(formError || session?.error) && <p className="warning-note">{formError || errorText(session?.error)}</p>}
        </div>
      )}

      {signedIn && (
        <>
          <div className="cloud-row">
            <span className="cloud-muted">
              {sync?.state === 'error' || sync?.state === 'offline'
                ? t('Se reintentará sola.') + (sync.nextRetryAt ? ' ' + t('Próximo intento: {hora}.', { hora: formatTime(sync.nextRetryAt) }) : '')
                : sync?.lastSyncAt ? t('Última sincronización: {hora}', { hora: formatTime(sync.lastSyncAt) }) : t('Todavía no se ha sincronizado nada.')}
            </span>
            <div className="cloud-actions">
              <button type="button" className="secondary-btn" disabled={busy !== null || sync?.state === 'syncing'} onClick={() => void syncNow()}>{t('Sincronizar ahora')}</button>
              <button type="button" className="secondary-btn" disabled={busy !== null} onClick={() => void signOut()}>{t('Cerrar sesión')}</button>
            </div>
          </div>
          {sync?.state === 'error' && sync.error && <p className="warning-note">{sync.error}</p>}

          <UploadProgress upload={upload} />

          <div className="cloud-migration">
            {!plan && (
              <div className="cloud-row">
                <span className="cloud-muted">{t('Las llamadas que grabes a partir de ahora se suben solas. Las de antes, cuando tú digas.')}</span>
                <button type="button" className="secondary-btn" disabled={planBusy} onClick={() => void loadPlan()}>
                  {planBusy ? t('Revisando…') : t('Subir grabaciones antiguas')}
                </button>
              </div>
            )}
            {plan && <MigrationPlanView plan={plan} includeExternal={includeExternal} setIncludeExternal={setIncludeExternal} busy={planBusy} onRun={() => void runMigration()} onCancel={() => setPlan(null)} />}
            {migrationNote && <p className="cloud-muted">{migrationNote}</p>}
          </div>
        </>
      )}
    </div>
  )
}

function UploadProgress({ upload }: { upload: CloudUploadStatus | null }) {
  const desk = window.desktopApp
  if (!upload || upload.batch.total === 0) return null
  const { batch, percent, current, pausedBy } = upload
  const allDone = upload.state === 'idle' && batch.done + batch.failed >= batch.total

  let line: string
  if (allDone) line = t('Subidos {done} de {total}', { done: batch.done, total: batch.total })
  else if (upload.state === 'paused' && pausedBy === 'recording') line = t('En pausa mientras grabas')
  else if (upload.state === 'paused' && pausedBy === 'no-session') line = t('Esperando sesión')
  else if (upload.state === 'paused') line = t('Subida en pausa')
  else if (upload.state === 'waiting') line = t('Esperando para reintentar')
  else line = t('Subiendo {index}/{total}', { index: batch.index, total: batch.total })

  return (
    <div className="cloud-upload">
      <div className="cloud-row">
        <span className="cloud-upload-line">{line} · {percent} %</span>
        <div className="cloud-actions">
          {batch.failed > 0 && <button type="button" className="secondary-btn" onClick={() => void desk?.cloudUploadRetry?.()}>{t('Reintentar ({n})', { n: batch.failed })}</button>}
          {!allDone && (upload.state === 'paused' && pausedBy === 'user'
            ? <button type="button" className="secondary-btn" onClick={() => void desk?.cloudUploadResume?.()}>{t('Reanudar')}</button>
            : <button type="button" className="secondary-btn" onClick={() => void desk?.cloudUploadPause?.()}>{t('Pausar')}</button>)}
        </div>
      </div>
      <div className="cloud-bar"><div className="cloud-bar-fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>
      {current && (
        <span className="cloud-muted">{t(PHASES[current.phase] ?? PHASES.uploading)}: {current.fileName} ({current.percent} %)</span>
      )}
      {upload.bytes.total > 0 && <span className="cloud-muted">{formatBytes(upload.bytes.done)} / {formatBytes(upload.bytes.total)}</span>}
      {upload.storageNotConfigured && <p className="warning-note">{t('Falta configurar el almacenamiento en la nube')}</p>}
    </div>
  )
}

function MigrationPlanView({ plan, includeExternal, setIncludeExternal, busy, onRun, onCancel }: {
  plan: CloudMigrationPlan
  includeExternal: boolean
  setIncludeExternal: (v: boolean) => void
  busy: boolean
  onRun: () => void
  onCancel: () => void
}) {
  const { totals } = plan
  const files = totals.files + (includeExternal ? totals.external.files : 0)
  const bytes = totals.bytes + (includeExternal ? totals.external.bytes : 0)
  return (
    <div className="cloud-plan">
      <p className="cloud-plan-title">{t('Se subirían {n} archivos ({tam}).', { n: files, tam: formatBytes(bytes) })}</p>
      <ul className="cloud-plan-list">
        <li>{t('Audio: {n} archivos ({tam})', { n: totals.byKind.mix.files + totals.byKind.system.files, tam: formatBytes(totals.byKind.mix.bytes + totals.byKind.system.bytes) })}</li>
        <li>{t('Vídeo: {n} archivos ({tam}). Se comprimen antes de subir.', { n: totals.byKind.video.files, tam: formatBytes(totals.byKind.video.bytes) })}</li>
        {totals.orphans.files > 0 && <li>{t('{n} archivos sin llamada a la que pertenezcan ({tam}): no se suben.', { n: totals.orphans.files, tam: formatBytes(totals.orphans.bytes) })}</li>}
        {totals.missing > 0 && <li>{t('{n} grabaciones que ya no están en este PC: no se pueden subir.', { n: totals.missing })}</li>}
      </ul>
      {totals.external.files > 0 && (
        <label className="cloud-check">
          <input type="checkbox" checked={includeExternal} onChange={e => setIncludeExternal(e.target.checked)} />
          {t('Incluir también {n} archivos guardados fuera de la carpeta de grabaciones ({tam})', { n: totals.external.files, tam: formatBytes(totals.external.bytes) })}
        </label>
      )}
      <p className="cloud-muted">{t('Se suben en segundo plano, de uno en uno, y se paran mientras grabas. No se mueve ni se cambia ningún archivo de este PC.')}</p>
      <div className="cloud-actions">
        <button type="button" className="primary-btn pill-btn" disabled={busy || files === 0} onClick={onRun}>{t('Subir {n} archivos', { n: files })}</button>
        <button type="button" className="secondary-btn" disabled={busy} onClick={onCancel}>{t('Cancelar')}</button>
      </div>
    </div>
  )
}

const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 7.2-9.6 7.2-16.9z" />
    <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.2-8.8 2.2-6.3 0-11.6-4.2-13.5-10l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
  </svg>
)
