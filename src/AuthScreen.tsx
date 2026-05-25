import { useState } from 'react'
import { supabase, isSupabaseConfigured } from './lib/supabase'

type Mode = 'login' | 'register'

export function AuthScreen() {
  const [mode, setMode]       = useState<Mode>('login')
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [info, setInfo]       = useState('')

  const reset = () => { setError(''); setInfo('') }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    reset()
    if (!email.trim() || !password.trim()) { setError('Introduce email y contraseña.'); return }
    setLoading(true)
    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setInfo('Revisa tu email para confirmar la cuenta.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(translateError(msg))
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

      if (!window.desktopApp?.openOAuthWindow) {
        setError('OAuth no disponible en esta versión.')
        return
      }
      const callbackUrl = await window.desktopApp.openOAuthWindow(data.url)
      if (!callbackUrl) { setLoading(false); return }

      const parsed = new URL(callbackUrl)
      const code = parsed.searchParams.get('code')
      if (!code) throw new Error('No se recibió código de autorización')
      const { error: sessErr } = await supabase.auth.exchangeCodeForSession(code)
      if (sessErr) throw sessErr
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(translateError(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-root">
      <div className="auth-card">
        <div className="auth-logo-row">
          <div className="auth-logo-dot" />
          <span className="auth-logo-text">Call Transcriber</span>
        </div>

        {!isSupabaseConfigured && (
          <div className="auth-setup-banner">
            <strong>Configuración pendiente</strong>
            <p>Añade tus credenciales de Supabase en el archivo <code>.env</code> y reconstruye la app para activar la sincronización.</p>
          </div>
        )}

        <h1 className="auth-title">
          {mode === 'login' ? 'Bienvenido de vuelta' : 'Crear cuenta'}
        </h1>
        <p className="auth-sub">
          {mode === 'login'
            ? 'Inicia sesión para acceder a tus entrevistas desde cualquier dispositivo.'
            : 'Crea una cuenta para sincronizar tus entrevistas entre dispositivos.'}
        </p>

        <button type="button" className="auth-google-btn" onClick={handleGoogle} disabled={loading || !isSupabaseConfigured}>
          <GoogleLogoIcon />
          Continuar con Google
        </button>

        <div className="auth-divider"><span>o</span></div>

        <form onSubmit={handleSubmit} className="auth-form">
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

          {error && <p className="auth-error">{error}</p>}
          {info  && <p className="auth-info">{info}</p>}

          <button type="submit" className="auth-submit-btn" disabled={loading || !isSupabaseConfigured}>
            {loading ? <span className="spinner" /> : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
          {' '}
          <button type="button" className="link-btn" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); reset() }}>
            {mode === 'login' ? 'Regístrate' : 'Inicia sesión'}
          </button>
        </p>
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
