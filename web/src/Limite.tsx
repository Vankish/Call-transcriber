import { Component, type ReactNode } from 'react'

// Las consultas de Convex lanzan el error (sin acceso, no existe) en vez de
// devolverlo: lo recoge este límite y la pantalla enseña qué ha pasado en vez
// de quedarse en blanco. `clave` lo reinicia al cambiar de página.
interface Props { clave: string; fallo: (e: unknown) => ReactNode; children: ReactNode }
interface Estado { error: unknown; clave: string }

export class Limite extends Component<Props, Estado> {
  state: Estado = { error: null, clave: this.props.clave }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, estado: Estado) {
    return props.clave !== estado.clave ? { error: null, clave: props.clave } : null
  }

  render() {
    return this.state.error ? this.props.fallo(this.state.error) : this.props.children
  }
}
