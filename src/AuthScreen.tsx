import { useState } from 'react'
import { SparkIcon } from './icons'
import { Select } from './Select'
import { supabase, isSupabaseConfigured } from './lib/supabase'

type Mode = 'login' | 'register' | 'forgot'

const COUNTRIES = [
  'Afganistán', 'Albania', 'Alemania', 'Andorra', 'Angola', 'Arabia Saudita',
  'Argelia', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaiyán',
  'Bahréin', 'Bangladesh', 'Bélgica', 'Bielorrusia', 'Bolivia', 'Bosnia y Herzegovina',
  'Brasil', 'Bulgaria', 'Camerún', 'Canadá', 'Chile', 'China', 'Chipre',
  'Colombia', 'Congo', 'Corea del Sur', 'Costa Rica', 'Croacia', 'Cuba',
  'Dinamarca', 'Ecuador', 'Egipto', 'El Salvador', 'Emiratos Árabes Unidos',
  'Eslovaquia', 'Eslovenia', 'España', 'Estados Unidos', 'Estonia', 'Etiopía',
  'Filipinas', 'Finlandia', 'Francia', 'Georgia', 'Ghana', 'Grecia', 'Guatemala',
  'Honduras', 'Hungría', 'India', 'Indonesia', 'Irak', 'Irán', 'Irlanda',
  'Israel', 'Italia', 'Jamaica', 'Japón', 'Jordania', 'Kazajistán', 'Kenia',
  'Kuwait', 'Letonia', 'Líbano', 'Libia', 'Lituania', 'Luxemburgo',
  'Malasia', 'Malta', 'Marruecos', 'México', 'Moldavia', 'Mongolia',
  'Myanmar', 'Nepal', 'Nicaragua', 'Nigeria', 'Noruega', 'Nueva Zelanda',
  'Países Bajos', 'Pakistán', 'Panamá', 'Paraguay', 'Perú', 'Polonia',
  'Portugal', 'Puerto Rico', 'Qatar', 'Reino Unido', 'República Checa',
  'República Dominicana', 'Rumania', 'Rusia', 'Senegal', 'Serbia',
  'Singapur', 'Siria', 'Sri Lanka', 'Sudáfrica', 'Suecia', 'Suiza',
  'Tailandia', 'Tanzania', 'Túnez', 'Turquía', 'Ucrania', 'Uganda',
  'Uruguay', 'Uzbekistán', 'Venezuela', 'Vietnam', 'Yemen', 'Zimbabue',
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    reset()
    if (mode === 'forgot') {
      if (!email.trim()) { setError('Introduce tu email.'); return }
      setLoading(true)
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: 'http://localhost:3000' })
        if (error) throw error
        setInfo('Te hemos enviado un email. Haz clic en el enlace con la app abierta y podrás poner una nueva contraseña.')
      } catch (err: unknown) {
        setError(translateError(err instanceof Error ? err.message : 'Error desconocido'))
      } finally {
        setLoading(false)
      }
      return
    }
    if (!email.trim() || !password.trim()) { setError('Introduce email y contraseña.'); return }
    if (mode === 'register') {
      if (!name.trim())                    { setError('Introduce tu nombre completo.'); return }
      if (password !== confirmPassword)    { setError('Las contraseñas no coinciden.'); return }
      if (!country)                        { setError('Selecciona tu país.'); return }
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
        setInfo('Revisa tu email para confirmar la cuenta.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err: unknown) {
      setError(translateError(err instanceof Error ? err.message : 'Error desconocido'))
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
          <text x="97" y="60" fontFamily="Inter, system-ui, Arial, sans-serif" fontSize="11" fill="rgba(255,255,255,0.5)">Transcribe · Analiza · Decide</text>
        </svg>

        <div className="auth-left-body">
          <h1 className="auth-headline">Entrevistas más<br />inteligentes.</h1>
          <p className="auth-tagline">
            Graba, transcribe y resume tus entrevistas con IA. Todo en un lugar.
          </p>
          <ul className="auth-features">
            <li><SparkIcon /> Grabación de micrófono + sistema</li>
            <li><SparkIcon /> Transcripción automática con IA</li>
            <li><SparkIcon /> Resúmenes IA y sincronización en la nube</li>
          </ul>
        </div>

        <div className="auth-deco-circle" />
      </div>

      {/* ── Panel derecho — formulario ── */}
      <div className="auth-right">
        <div className="auth-card">
          {!isSupabaseConfigured && (
            <div className="auth-setup-banner">
              <strong>La sincronización no está configurada</strong>
              <p>
                No pasa nada: puedes usar la app entera en este equipo. Para sincronizar entre
                ordenadores y compartir carpetas hace falta un proyecto de Supabase — está
                explicado en el README.
              </p>
            </div>
          )}

          <h2 className="auth-title">
            {mode === 'login' ? 'Bienvenido de vuelta' : mode === 'register' ? 'Crear cuenta' : 'Recuperar contraseña'}
          </h2>
          <p className="auth-sub">
            {mode === 'login'
              ? 'Inicia sesión para acceder a tus entrevistas desde cualquier dispositivo.'
              : mode === 'register'
              ? 'Crea una cuenta para sincronizar tus entrevistas entre dispositivos.'
              : 'Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.'}
          </p>

          <form onSubmit={handleSubmit} className="auth-form">
            {mode === 'register' && (
              <label className="auth-label">Nombre completo
                <input
                  type="text"
                  className="auth-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Tu nombre"
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
                placeholder="tu@email.com"
                autoComplete="email"
                disabled={loading}
              />
            </label>

            {mode !== 'forgot' && (
              <label className="auth-label">Contraseña
                <input
                  type="password"
                  className="auth-input"
                  value={password}
                  onChange={e => setPass(e.target.value)}
                  placeholder={mode === 'register' ? 'Mínimo 6 caracteres' : '••••••••'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  disabled={loading}
                />
              </label>
            )}

            {mode === 'register' && (
              <>
                <label className="auth-label">Confirmar contraseña
                  <input
                    type="password"
                    className="auth-input"
                    value={confirmPassword}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Repetir contraseña"
                    autoComplete="new-password"
                    disabled={loading}
                  />
                </label>

                <label className="auth-label">País
                  <Select
                    className="auth-input auth-select"
                    value={country}
                    onChange={setCountry}
                    disabled={loading}
                    placeholder="Selecciona tu país"
                    options={COUNTRIES.map(c => ({ value: c, label: c }))}
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
                : mode === 'login' ? 'Iniciar sesión' : mode === 'register' ? 'Crear cuenta' : 'Enviar enlace'}
            </button>
          </form>

          <p className="auth-switch">
            {mode === 'forgot' ? '¿Recuerdas tu contraseña?' : mode === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
            {' '}
            <button
              type="button"
              className="link-btn"
              onClick={() => switchMode(mode === 'forgot' ? 'login' : mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'forgot' ? 'Inicia sesión' : mode === 'login' ? 'Regístrate' : 'Inicia sesión'}
            </button>
          </p>
          {mode === 'login' && isSupabaseConfigured && (
            <p className="auth-switch" style={{ marginTop: 4 }}>
              <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>
                ¿Olvidaste tu contraseña?
              </button>
            </p>
          )}

          <div className="auth-local">
            <span className="auth-local-sep">o</span>
            <button type="button" className="auth-local-btn" onClick={onUsarSinCuenta}>
              Empezar sin cuenta
            </button>
            <p className="auth-local-note">
              Graba, transcribe y resume igual. Los datos se quedan en este ordenador y no
              viajan a ninguna parte. Puedes crear la cuenta más adelante.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function translateError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.'
  if (msg.includes('Email not confirmed'))       return 'Confirma tu email antes de iniciar sesión.'
  if (msg.includes('User already registered'))   return 'Este email ya está registrado. Inicia sesión.'
  if (msg.includes('Password should be'))        return 'La contraseña debe tener al menos 6 caracteres.'
  if (msg.includes('rate limit'))                return 'Demasiados intentos. Espera un momento.'
  return msg
}
