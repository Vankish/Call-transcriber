import { useSyncExternalStore } from 'react'

// "Caduca en 3 días" depende de la hora, y pintar tiene que ser puro (sin
// Date.now() dentro de un render). La hora vive aquí y se adelanta cada medio
// minuto: suficiente para fechas que se cuentan en horas y días.
let ahora = Date.now()
const oyentes = new Set<() => void>()
setInterval(() => {
  ahora = Date.now()
  oyentes.forEach((o) => o())
}, 30_000)

export function useAhora(): number {
  return useSyncExternalStore((o) => { oyentes.add(o); return () => { oyentes.delete(o) } }, () => ahora)
}
