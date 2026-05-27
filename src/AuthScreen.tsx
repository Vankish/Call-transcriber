import { useState } from 'react'
import { supabase, isSupabaseConfigured } from './lib/supabase'

type Mode = 'login' | 'register'

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

export function AuthScreen() {
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

  const handleGoogle = async () => {
    reset()
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: 'http://localhost', skipBrowserRedirect: true },
      })
      if (error) throw error
      if (!data.url) throw new Error('No se pudo generar URL de Google')
      if (!window.desktopApp?.openOAuthWindow) { setError('OAuth no disponible en esta versión.'); return }
      const callbackUrl = await window.desktopApp.openOAuthWindow(data.url)
      if (!callbackUrl) { setLoading(false); return }
      const parsed = new URL(callbackUrl)
      const code = parsed.searchParams.get('code')
      if (!code) throw new Error('No se recibió código de autorización')
      const { error: sessErr } = await supabase.auth.exchangeCodeForSession(code)
      if (sessErr) throw sessErr
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
            <li>✦&nbsp; Grabación de micrófono + sistema</li>
            <li>✦&nbsp; Transcripción automática con Groq</li>
            <li>✦&nbsp; Resúmenes IA y sincronización en la nube</li>
          </ul>
        </div>

        <div className="auth-deco-circle" />
      </div>

      {/* ── Panel derecho — formulario ── */}
      <div className="auth-right">
        <div className="auth-card">
          {!isSupabaseConfigured && (
            <div className="auth-setup-banner">
              <strong>Configuración pendiente</strong>
              <p>Añade tus credenciales de Supabase en el archivo <code>.env</code> y reconstruye la app.</p>
            </div>
          )}

          <h2 className="auth-title">
            {mode === 'login' ? 'Bienvenido de vuelta' : 'Crear cuenta'}
          </h2>
          <p className="auth-sub">
            {mode === 'login'
              ? 'Inicia sesión para acceder a tus entrevistas desde cualquier dispositivo.'
              : 'Crea una cuenta para sincronizar tus entrevistas entre dispositivos.'}
          </p>

          <button
            type="button"
            className="auth-google-btn"
            onClick={handleGoogle}
            disabled={loading || !isSupabaseConfigured}
          >
            <GoogleLogoIcon />
            {mode === 'login' ? 'Continuar con Google' : 'Registrarse con Google'}
          </button>

          <div className="auth-divider"><span>o</span></div>

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
                  <select
                    className="auth-input auth-select"
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">Selecciona tu país</option>
                    {COUNTRIES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
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
                : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
            </button>
          </form>

          <p className="auth-switch">
            {mode === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
            {' '}
            <button
              type="button"
              className="link-btn"
              onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? 'Regístrate' : 'Inicia sesión'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

function GoogleLogoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="#FBBC05" d="M10.53 28.58c-.5-1.45-.76-2.99-.76-4.58s.27-3.14.76-4.58V13.23l-7.98-6.19C.92 9.99 0 14.88 0 20c0 5.12.92 10.01 2.55 12.96l7.98-6.38z"/>
      <path fill="#EA4335" d="M24 9.52c3.52 0 6.67 1.21 9.16 3.58l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.55 13.23l7.98 6.19C12.43 13.74 17.74 9.52 24 9.52z"/>
    </svg>
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
