import { useState } from 'react'
import { SparkIcon } from './icons'
import { Select } from './Select'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import { locale, t } from './i18n'

type Mode = 'login' | 'register' | 'forgot'

// Códigos ISO y no nombres: el nombre lo pone el navegador en el idioma de la
// interfaz. Lo que se guarda en la cuenta sigue siendo el nombre en español, como
// hasta ahora, para no mezclar "Spain" y "España" en la misma tabla.
const COUNTRY_CODES = [
  'AF', 'AL', 'DE', 'AD', 'AO', 'SA', 'DZ', 'AR', 'AM', 'AU', 'AT', 'AZ',
  'BH', 'BD', 'BE', 'BY', 'BO', 'BA', 'BR', 'BG', 'CM', 'CA', 'CL', 'CN', 'CY',
  'CO', 'CG', 'KR', 'CR', 'HR', 'CU', 'DK', 'EC', 'EG', 'SV', 'AE',
  'SK', 'SI', 'ES', 'US', 'EE', 'ET', 'PH', 'FI', 'FR', 'GE', 'GH', 'GR', 'GT',
  'HN', 'HU', 'IN', 'ID', 'IQ', 'IR', 'IE', 'IL', 'IT', 'JM', 'JP', 'JO', 'KZ', 'KE',
  'KW', 'LV', 'LB', 'LY', 'LT', 'LU', 'MY', 'MT', 'MA', 'MX', 'MD', 'MN',
  'MM', 'NP', 'NI', 'NG', 'NO', 'NZ', 'NL', 'PK', 'PA', 'PY', 'PE', 'PL',
  'PT', 'PR', 'QA', 'GB', 'CZ', 'DO', 'RO', 'RU', 'SN', 'RS',
  'SG', 'SY', 'LK', 'ZA', 'SE', 'CH', 'TH', 'TZ', 'TN', 'TR', 'UA', 'UG',
  'UY', 'UZ', 'VE', 'VN', 'YE', 'ZW',
]

// `onUsarSinCuenta` es la puerta al modo local: la app funciona entera contra el
// disco de este equipo, sin cuenta. La nube es lo opcional, no al reves.
export function AuthScreen({ onUsarSinCuenta }: { onUsarSinCuenta: () => void }) {
  const [mode, setMode]               = useState<Mode>('login')
  const [name, setName]               = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPass]           = useState('')
  const [confirmPassword, setConfirm] = useState('')
  const [country, setCountry]         = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [info, setInfo]               = useState('')

  const reset = () => { setError(''); setInfo('') }

  // Se ve el nombre en el idioma de la interfaz y se guarda en español.
  const paises = (() => {
    const verlo = new Intl.DisplayNames([locale()], { type: 'region' })
    const guardarlo = new Intl.DisplayNames(['es-ES'], { type: 'region' })
    return COUNTRY_CODES
      .map(code => ({ value: guardarlo.of(code) ?? code, label: verlo.of(code) ?? code }))
      .sort((a, b) => a.label.localeCompare(b.label, locale()))
  })()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    reset()
    if (mode === 'forgot') {
      if (!email.trim()) { setError(t('Introduce tu email.')); return }
      setLoading(true)
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: 'http://localhost:3000' })
        if (error) throw error
        setInfo(t('Te hemos enviado un email. Haz clic en el enlace con la app abierta y podrás poner una nueva contraseña.'))
      } catch (err: unknown) {
        setError(translateError(err instanceof Error ? err.message : t('Error desconocido')))
      } finally {
        setLoading(false)
      }
      return
    }
    if (!email.trim() || !password.trim()) { setError(t('Introduce email y contraseña.')); return }
    if (mode === 'register') {
      if (!name.trim())                    { setError(t('Introduce tu nombre completo.')); return }
      if (password !== confirmPassword)    { setError(t('Las contraseñas no coinciden.')); return }
      if (!country)                        { setError(t('Selecciona tu país.')); return }
    }
    setLoading(true)
    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name.trim(), country } },
        })
        if (error) throw error
        setInfo(t('Revisa tu email para confirmar la cuenta.'))
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err: unknown) {
      setError(translateError(err instanceof Error ? err.message : t('Error desconocido')))
    } finally {
      setLoading(false)
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m); reset()
    setName(''); setConfirm(''); setCountry('')
  }

  return (
    <div className="auth-root">
      {/* ── Panel izquierdo — branding ── */}
      <div className="auth-left">
        <svg viewBox="0 0 270 86" xmlns="http://www.w3.org/2000/svg" className="auth-logo-svg">
          {/* Circle icon */}
          <rect x="0" y="3" width="80" height="80" rx="40" fill="#2563eb"/>
          {/* Waveform bars */}
          <rect x="13" y="34" width="7" height="18" rx="2" fill="#ffffff"/>
          <rect x="25" y="28" width="7" height="30" rx="2" fill="#ffffff"/>
          <rect x="37" y="21" width="7" height="44" rx="2" fill="#ffffff"/>
          <rect x="49" y="28" width="7" height="30" rx="2" fill="#ffffff"/>
          <rect x="61" y="34" width="7" height="18" rx="2" fill="#ffffff"/>
          {/* Wordmark */}
          <text x="96" y="40" fontFamily="Inter, system-ui, Arial, sans-serif" fontSize="22" fontWeight="700" fill="#ffffff">Call Transcriber</text>
          {/* Tagline */}
          <text x="97" y="60" fontFamily="Inter, system-ui, Arial, sans-serif" fontSize="11" fill="rgba(255,255,255,0.5)">{t('Transcribe · Analiza · Decide')}</text>
        </svg>

        <div className="auth-left-body">
          <h1 className="auth-headline">{t('Entrevistas más')}<br />{t('inteligentes.')}</h1>
          <p className="auth-tagline">
            {t('Graba, transcribe y resume tus entrevistas con IA. Todo en un lugar.')}
          </p>
          <ul className="auth-features">
            <li><SparkIcon /> {t('Grabación de micrófono + sistema')}</li>
            <li><SparkIcon /> {t('Transcripción automática con IA')}</li>
            <li><SparkIcon /> {t('Resúmenes IA y sincronización en la nube')}</li>
          </ul>
        </div>

        <div className="auth-deco-circle" />
      </div>

      {/* ── Panel derecho — formulario ── */}
      <div className="auth-right">
        <div className="auth-card">
          {!isSupabaseConfigured && (
            <div className="auth-setup-banner">
              <strong>{t('La sincronización no está configurada')}</strong>
              <p>
                {t('No pasa nada: puedes usar la app entera en este equipo. Para sincronizar entre ordenadores y compartir carpetas hace falta un proyecto de Supabase — está explicado en el README.')}
              </p>
            </div>
          )}

          <h2 className="auth-title">
            {mode === 'login' ? t('Bienvenido de vuelta') : mode === 'register' ? t('Crear cuenta') : t('Recuperar contraseña')}
          </h2>
          <p className="auth-sub">
            {mode === 'login'
              ? t('Inicia sesión para acceder a tus entrevistas desde cualquier dispositivo.')
              : mode === 'register'
              ? t('Crea una cuenta para sincronizar tus entrevistas entre dispositivos.')
              : t('Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.')}
          </p>

          <form onSubmit={handleSubmit} className="auth-form">
            {mode === 'register' && (
              <label className="auth-label">{t('Nombre completo')}
                <input
                  type="text"
                  className="auth-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('Tu nombre')}
                  autoComplete="name"
                  disabled={loading}
                />
              </label>
            )}

            <label className="auth-label">Email
              <input
                type="email"
                className="auth-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('tu@email.com')}
                autoComplete="email"
                disabled={loading}
              />
            </label>

            {mode !== 'forgot' && (
              <label className="auth-label">{t('Contraseña')}
                <input
                  type="password"
                  className="auth-input"
                  value={password}
                  onChange={e => setPass(e.target.value)}
                  placeholder={mode === 'register' ? t('Mínimo 6 caracteres') : '••••••••'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  disabled={loading}
                />
              </label>
            )}

            {mode === 'register' && (
              <>
                <label className="auth-label">{t('Confirmar contraseña')}
                  <input
                    type="password"
                    className="auth-input"
                    value={confirmPassword}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder={t('Repetir contraseña')}
                    autoComplete="new-password"
                    disabled={loading}
                  />
                </label>

                <label className="auth-label">{t('País')}
                  <Select
                    className="auth-input auth-select"
                    value={country}
                    onChange={setCountry}
                    disabled={loading}
                    placeholder={t('Selecciona tu país')}
                    options={paises}
                  />
                </label>
              </>
            )}

            {error && <p className="auth-error">{error}</p>}
            {info  && <p className="auth-info">{info}</p>}

            <button
              type="submit"
              className="auth-submit-btn"
              disabled={loading || !isSupabaseConfigured}
            >
              {loading
                ? <span className="spinner" />
                : mode === 'login' ? t('Iniciar sesión') : mode === 'register' ? t('Crear cuenta') : t('Enviar enlace')}
            </button>
          </form>

          <p className="auth-switch">
            {mode === 'forgot' ? t('¿Recuerdas tu contraseña?') : mode === 'login' ? t('¿No tienes cuenta?') : t('¿Ya tienes cuenta?')}
            {' '}
            <button
              type="button"
              className="link-btn"
              onClick={() => switchMode(mode === 'forgot' ? 'login' : mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'forgot' ? t('Inicia sesión') : mode === 'login' ? t('Regístrate') : t('Inicia sesión')}
            </button>
          </p>
          {mode === 'login' && isSupabaseConfigured && (
            <p className="auth-switch" style={{ marginTop: 4 }}>
              <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>
                {t('¿Olvidaste tu contraseña?')}
              </button>
            </p>
          )}

          <div className="auth-local">
            <span className="auth-local-sep">{t('o')}</span>
            <button type="button" className="auth-local-btn" onClick={onUsarSinCuenta}>
              {t('Empezar sin cuenta')}
            </button>
            <p className="auth-local-note">
              {t('Graba, transcribe y resume igual. Los datos se quedan en este ordenador y no viajan a ninguna parte. Puedes crear la cuenta más adelante.')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function translateError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return t('Email o contraseña incorrectos.')
  if (msg.includes('Email not confirmed'))       return t('Confirma tu email antes de iniciar sesión.')
  if (msg.includes('User already registered'))   return t('Este email ya está registrado. Inicia sesión.')
  if (msg.includes('Password should be'))        return t('La contraseña debe tener al menos 6 caracteres.')
  if (msg.includes('rate limit'))                return t('Demasiados intentos. Espera un momento.')
  return msg
}
