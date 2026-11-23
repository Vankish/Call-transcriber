import { useState, type FormEvent } from 'react'
import { useDatos } from '../data/contexto'
import { t } from '../i18n'
import { Marca, SelectorIdioma } from './Cabecera'
import { AvisoError } from './Estados'

export function Entrar() {
  const { entrarConGoogle, entrarConCorreo } = useDatos().useAccionesSesion()
  const [flujo, setFlujo] = useState<'signIn' | 'signUp'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ocupado, setOcupado] = useState<'google' | 'correo' | null>(null)
  const [error, setError] = useState<unknown>(null)

  async function conCorreo(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setOcupado('correo')
    try {
      await entrarConCorreo(email.trim(), password, flujo)
    } catch (err) {
      setError(err)
    } finally {
      setOcupado(null)
    }
  }

  async function conGoogle() {
    setError(null)
    setOcupado('google')
    try {
      // Con Convex Auth esto sale de la página hacia Google y vuelve aquí.
      await entrarConGoogle()
    } catch (err) {
      setError(err)
      setOcupado(null)
    }
  }

  return (
    <main className="entrar">
      <div className="entrar__idioma"><SelectorIdioma /></div>
      <div className="entrar__caja">
        <Marca />
        <h1 className="entrar__titulo">{flujo === 'signIn' ? t('Entra para ver tus llamadas') : t('Crea tu cuenta')}</h1>
        <p className="entrar__texto">
          {t('Usa el mismo correo con el que te invitaron. Solo verás las llamadas que te hayan compartido.')}
        </p>

        <button className="boton boton--google" onClick={() => { void conGoogle() }} disabled={ocupado !== null}>
          <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
            <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.8-6z" />
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z" />
          </svg>
          {ocupado === 'google' ? t('Abriendo Google…') : t('Entrar con Google')}
        </button>

        <div className="separador"><span>{t('o con tu correo')}</span></div>

        <form className="formulario" onSubmit={(e) => { void conCorreo(e) }}>
          <label className="campo">
            <span className="campo__etiqueta">{t('Correo')}</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" />
          </label>
          <label className="campo">
            <span className="campo__etiqueta">{t('Contraseña')}</span>
            <input
              type="password"
              autoComplete={flujo === 'signIn' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {flujo === 'signUp' && <span className="campo__ayuda">{t('Mínimo 8 caracteres.')}</span>}
          </label>
          <AvisoError error={error} />
          <button className="boton boton--primario boton--ancho" type="submit" disabled={ocupado !== null}>
            {ocupado === 'correo' ? t('Entrando…') : flujo === 'signIn' ? t('Entrar') : t('Crear cuenta')}
          </button>
        </form>

        <p className="entrar__cambio">
          {flujo === 'signIn' ? t('¿Es la primera vez?') : t('¿Ya tienes cuenta?')}{' '}
          <button className="enlace" onClick={() => { setFlujo(flujo === 'signIn' ? 'signUp' : 'signIn'); setError(null) }}>
            {flujo === 'signIn' ? t('Crea tu cuenta') : t('Entra')}
          </button>
        </p>
      </div>
    </main>
  )
}
