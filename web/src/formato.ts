import { locale, t } from './i18n'

/** 75 → "1:15"; 3725 → "1:02:05". Como en cualquier reproductor. */
export function tiempo(seg: number): string {
  const s = Math.max(0, Math.floor(seg))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

/** 2412 → "40 min". Para listas, donde los segundos sobran. */
export function duracion(seg: number): string {
  const min = Math.round(seg / 60)
  if (min < 60) return t('{n} min', { n: Math.max(1, min) })
  return t('{h} h {m} min', { h: Math.floor(min / 60), m: min % 60 })
}

export function fecha(ms: number): string {
  return new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fechaHora(ms: number): string {
  return new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** "hace 3 días", "en 5 días": Intl ya sabe decirlo en cada idioma. */
export function relativo(ms: number, ahora: number): string {
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  const dif = ms - ahora
  const abs = Math.abs(dif)
  if (abs < 60 * 60_000) return rtf.format(Math.round(dif / 60_000), 'minute')
  if (abs < 24 * 60 * 60_000) return rtf.format(Math.round(dif / (60 * 60_000)), 'hour')
  return rtf.format(Math.round(dif / (24 * 60 * 60_000)), 'day')
}

/** Iniciales para el circulito del autor de un comentario. */
export function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'
}
