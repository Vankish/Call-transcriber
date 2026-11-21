// ── Datos inventados para la web sin backend ─────────────────────────────────
//
// Sirven para dos cosas: trabajar en las pantallas mientras el backend de Convex
// se construye en paralelo, y sacar capturas. El repo es público, así que todo
// es inventado: nombres, empresas y correos (@ejemplo.com, reservado para esto).
// Nada sale de grabaciones reales.

import type { Comentario, Enlace, Invitacion, LlamadaDetalle, Membresia, Miembro, Proyecto, Segmento } from './tipos'

const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA

// Las fechas se fijan respecto a cuando se abre la página y no a un día
// concreto: así "caduca en 5 días" y "caducó hace 3" siguen siendo ciertos
// dentro de un año, cuando alguien vuelva a sacar capturas.
const ahora = Date.now()

export const YO = { memberId: 'm-marta', nombre: 'Marta Ríos', email: 'marta@ejemplo.com' }

export const membresias: Membresia[] = [
  { workspaceId: 'w-rios', workspaceName: 'Estudio Ríos', role: 'owner', projectIds: [] },
  { workspaceId: 'w-norte', workspaceName: 'Academia Comercial Norte', role: 'coach', projectIds: ['p-ventas'] },
]

export const proyectos: Proyecto[] = [
  { _id: 'p-frontend', workspaceId: 'w-rios', name: 'Desarrollo frontend', company: 'Nimbo Software', kind: 'entrevistas' },
  { _id: 'p-clientes', workspaceId: 'w-rios', name: 'Clientes Q4', company: 'Estudio Ríos', kind: 'clientes' },
  { _id: 'p-ventas', workspaceId: 'w-norte', name: 'Equipo de ventas', company: 'Academia Comercial Norte', kind: 'clientes' },
]

// ── Conversaciones ───────────────────────────────────────────────────────────

type Linea = [hablante: 0 | 1, texto: string]

// Una llamada comercial completa, de la presentación al siguiente paso. Las
// duraciones se reparten en proporción a lo largo de cada frase hasta llenar
// los 40 minutos: así la transcripción cubre todo el vídeo sin repetirse.
const VENTA: Linea[] = [
  [0, 'Hola, Ana, buenos días. ¿Me oyes bien?'],
  [1, 'Sí, perfectamente. Buenos días, Marta.'],
  [0, 'Genial. Antes de empezar, te cuento cómo había pensado la llamada: unos minutos para entender cómo trabajáis hoy, luego te enseño lo que hemos hecho con otros hoteles pequeños y al final vemos si tiene sentido un siguiente paso. ¿Te parece?'],
  [1, 'Me parece bien. Tengo hasta las once y media.'],
  [0, 'Perfecto, nos sobra. La última vez me dijiste que las reservas os entran por tres sitios distintos. ¿Sigue siendo así?'],
  [1, 'Sí. Por la web, por teléfono y por las plataformas. Y cada una tiene su calendario, así que alguien tiene que cuadrarlo a mano cada mañana.'],
  [0, '¿Quién se encarga de eso ahora mismo?'],
  [1, 'Normalmente yo, o Carlos cuando estoy fuera. Nos lleva fácilmente una hora al día, y en temporada alta más.'],
  [0, 'Una hora al día es mucho. ¿Os ha pasado alguna vez que se cruzaran dos reservas para la misma habitación?'],
  [1, 'Dos veces este verano. Una la arreglamos con una mejora de habitación, pero la otra fue un disgusto: una familia con dos niños y no teníamos nada libre.'],
  [0, '¿Y qué pasó con esa familia?'],
  [1, 'Les buscamos sitio en otro hotel del pueblo y les pagamos la diferencia. Nos dejaron una reseña de dos estrellas que todavía sale la primera.'],
  [0, 'Entiendo. O sea que no es solo la hora diaria, también os está costando reputación.'],
  [1, 'Exacto. Y la reseña nos ha bajado la nota media justo antes de la temporada de invierno.'],
  [0, 'Si esto siguiera igual el año que viene, con la temporada alta entera por delante, ¿qué crees que pasaría?'],
  [1, 'Pues que tendríamos que contratar a alguien solo para esto, y no nos lo podemos permitir. O que yo seguiría sin vacaciones, que es lo que hay ahora.'],
  [0, 'Vale. Déjame que te enseñe cómo lo resolvió un hostal parecido al vuestro, en la costa, con catorce habitaciones.'],
  [1, 'Venga.'],
  [0, 'Aquí ves el calendario único. Todas las reservas entran aquí, vengan de donde vengan, y cuando una habitación se ocupa se cierra sola en las demás plataformas en menos de un minuto.'],
  [1, '¿Y las reservas por teléfono? Esas las apuntamos en una libreta.'],
  [0, 'Las metéis desde el móvil, en esta pantalla. Tarda lo mismo que apuntarlo en la libreta, y a partir de ahí ya cuenta para todo.'],
  [1, 'Eso estaría bien. Carlos no es muy de ordenadores, pero el móvil lo usa para todo.'],
  [0, 'Es lo que nos dicen casi todos. En el hostal de la costa la persona de recepción tenía sesenta y dos años y a la semana ya no usaba otra cosa.'],
  [1, '¿Y cuánto tardaron en tenerlo funcionando?'],
  [0, 'Dos semanas desde que firmaron. La primera semana conectamos las plataformas y pasamos las reservas que ya tenían; la segunda la usaron en paralelo con su sistema de siempre, para ganar confianza.'],
  [1, 'Me gusta lo de tenerlo en paralelo. Me da miedo cambiar en mitad de diciembre y que se nos caiga todo.'],
  [0, 'Tiene todo el sentido. Por eso lo hacemos así: nadie apaga lo viejo hasta que lo nuevo ha funcionado una semana entera sin fallos.'],
  [1, 'Vale. ¿Y el precio? Porque esto es lo que me va a preguntar mi socio lo primero.'],
  [0, 'Te lo cuento, pero antes quiero entender una cosa: ¿cuánto os ha costado, más o menos, cada reserva cruzada de este verano?'],
  [1, 'La de la familia, entre la diferencia del otro hotel y la noche que les regalamos, unos cuatrocientos euros. Sin contar la reseña.'],
  [0, 'Y la hora diaria, ¿a cuánto la valoras?'],
  [1, 'Si la tuviera que pagar, unos quince euros. Al mes serían unos cuatrocientos cincuenta.'],
  [0, 'Entonces hoy, sin contar la reputación, el problema os cuesta alrededor de quinientos euros al mes. Nuestro plan para catorce habitaciones son ciento veinte al mes, sin permanencia.'],
  [1, 'Visto así, sale a cuenta. Aunque tendría que verlo con mi socio.'],
  [0, 'Claro. ¿Qué crees que le preocupará a él?'],
  [1, 'Sobre todo que no sea otro programa que pagamos y luego no usamos. Ya nos pasó con uno de facturas.'],
  [0, '¿Qué pasó con ese programa?'],
  [1, 'Era muy completo, pero nadie nos enseñó a usarlo. Al tercer mes volvimos a las hojas de cálculo y lo seguimos pagando medio año sin darnos cuenta.'],
  [0, 'Eso es justo lo que queremos evitar. Por eso el primer mes lo hacemos con vosotros: una llamada corta cada semana para ver qué se atasca.'],
  [1, 'Eso le va a gustar. ¿Podría estar él en la siguiente llamada?'],
  [0, 'Por supuesto, es lo mejor. ¿Qué día os viene bien la semana que viene?'],
  [1, 'El martes por la tarde solemos estar los dos. A partir de las cinco.'],
  [0, 'Perfecto. Te mando ahora una invitación para el martes a las cinco y media, y te dejo por escrito lo que hemos hablado de los números para que se lo puedas enseñar antes.'],
  [1, 'Genial. Así ya llega con las preguntas hechas.'],
  [0, 'Eso es. ¿Hay algo más que quieras que preparemos para el martes?'],
  [1, 'Si puedes, un ejemplo de cómo se ve el calendario con las fechas de Navidad. Es cuando más lío tenemos.'],
  [0, 'Hecho, lo preparo con catorce habitaciones y las fechas de Navidad. Muchas gracias por tu tiempo, Ana.'],
  [1, 'Gracias a ti. Hasta el martes.'],
]

const ENTREVISTA: Linea[] = [
  [0, 'Hola, Lucía, gracias por venir. ¿Qué tal todo?'],
  [1, 'Muy bien, gracias. Con ganas de contaros lo que he estado haciendo.'],
  [0, 'Te cuento cómo va a ir: primero hablamos de tu experiencia, luego hacemos un ejercicio corto y al final tienes tiempo para preguntarnos lo que quieras.'],
  [1, 'Perfecto.'],
  [0, 'Cuéntame el último proyecto del que estés más orgullosa.'],
  [1, 'Rehicimos el panel de reservas de una cadena de gimnasios. Era una aplicación de hace ocho años y tardaba casi diez segundos en cargar la agenda del día.'],
  [0, '¿Qué parte llevaste tú?'],
  [1, 'La agenda entera. Separé la carga de datos de la interfaz y pinté solo lo que se veía en pantalla. Bajamos de diez segundos a menos de uno.'],
  [0, '¿Cómo supisteis que el problema estaba ahí y no en el servidor?'],
  [1, 'Medimos primero. El servidor respondía en trescientos milisegundos; el resto era el navegador pintando dos mil filas de golpe.'],
  [0, 'Muy bien. ¿Y qué harías distinto si lo volvieras a hacer?'],
  [1, 'Escribiría las pruebas antes. Al final tuvimos dos fallos en producción con los cambios de hora, y los habríamos visto con una prueba sencilla.'],
  [0, 'Vamos con el ejercicio. Tienes una lista de llamadas y hay que filtrarla por proyecto sin recargar la página.'],
  [1, 'Vale. Lo primero que haría es guardar el filtro en la dirección, para que se pueda compartir y que el botón de atrás funcione.'],
  [0, 'Interesante, ¿por qué te parece importante?'],
  [1, 'Porque si alguien manda el enlace a un compañero, el compañero tiene que ver lo mismo. Si el filtro vive solo en memoria, se pierde.'],
  [0, 'Muy bien. ¿Tienes alguna pregunta para nosotros?'],
  [1, 'Sí, ¿cómo es un día normal en el equipo, y cómo os repartís el trabajo de diseño?'],
  [0, 'Diseñamos primero en Figma y luego implementamos. Cada semana hay una revisión con todo el equipo.'],
  [1, 'Me encaja mucho esa forma de trabajar. Gracias por el tiempo.'],
]

function segmentos(lineas: Linea[], hablantes: [string, string], totalSec: number): Segmento[] {
  // Las pausas entre frases hacen que no todo segundo tenga a alguien hablando,
  // como en una llamada de verdad; el resto se reparte por longitud del texto.
  const pausa = 1.2
  const peso = lineas.reduce((s, [, texto]) => s + texto.length, 0)
  const porLetra = (totalSec - pausa * lineas.length) / peso
  let t = 2
  return lineas.map(([h, texto]) => {
    const dur = Math.max(2, texto.length * porLetra)
    const seg = { startSec: Math.round(t * 10) / 10, endSec: Math.round((t + dur) * 10) / 10, speaker: hablantes[h], text: texto }
    t += dur + pausa
    return seg
  })
}

const texto = (segs: Segmento[]) => segs.map((s) => `[${s.speaker}] ${s.text}`).join('\n')

// ── Llamadas ─────────────────────────────────────────────────────────────────

const VIDEO = { mimeType: 'video/mp4', uploadStatus: 'done' as const }

function llamada(d: Omit<LlamadaDetalle, 'transcript'> & { lineas: Linea[]; hablantes: [string, string] }): LlamadaDetalle {
  const { lineas, hablantes, ...resto } = d
  const segs = segmentos(lineas, hablantes, d.durationSec)
  return { ...resto, transcript: { text: texto(segs), segments: segs } }
}

const proyecto = (id: string) => {
  const p = proyectos.find((x) => x._id === id)!
  return { _id: p._id, name: p.name, company: p.company, kind: p.kind }
}

export const llamadas: LlamadaDetalle[] = [
  llamada({
    _id: 'i-brisa',
    workspaceId: 'w-rios',
    sessionName: 'Seguimiento con Hostal Brisa Marina',
    durationSec: 2412,
    createdAt: ahora - 2 * DIA - 3 * HORA,
    interviewerName: 'Marta Ríos',
    project: proyecto('p-clientes'),
    candidate: { name: 'Ana Soler', role: 'Gerente, Hostal Brisa Marina', email: 'ana.soler@ejemplo.com', phone: '+34 600 000 001' },
    media: [
      { _id: 'f-brisa-video', kind: 'video', durationSec: 2412, ...VIDEO },
      { _id: 'f-brisa-mix', kind: 'mix', mimeType: 'audio/mp4', durationSec: 2412, uploadStatus: 'done' },
    ],
    summaryText:
      '## Situación\nHostal de 14 habitaciones. Las reservas entran por la web, el teléfono y las plataformas, cada una con su calendario. Cuadrarlo a mano les lleva una hora al día.\n\n'
      + '## Problema\nDos reservas cruzadas este verano. Una acabó en reubicar a una familia (unos 400 €) y en una reseña de dos estrellas que sigue saliendo la primera.\n\n'
      + '## Implicación\nCalculan que el problema les cuesta unos 500 € al mes sin contar la reputación. Sin cambio, tendrían que contratar a alguien o Ana sigue sin vacaciones.\n\n'
      + '## Objeciones\nMiedo a cambiar en temporada alta y a pagar otro programa que no usen (ya les pasó con uno de facturas).\n\n'
      + '## Siguiente paso\nLlamada el martes a las 17:30 con el socio. Preparar el calendario con las fechas de Navidad y los números por escrito.',
    lineas: VENTA,
    hablantes: ['Marta', 'Ana'],
  }),
  llamada({
    _id: 'i-taller',
    workspaceId: 'w-norte',
    sessionName: 'Demo con Talleres Ebro',
    durationSec: 2100,
    createdAt: ahora - 3 * DIA,
    interviewerName: 'Marta Ríos',
    project: proyecto('p-ventas'),
    candidate: { name: 'Raúl Gil', role: 'Jefe de taller', email: 'raul.gil@ejemplo.com' },
    media: [{ _id: 'f-taller-video', kind: 'video', durationSec: 2100, ...VIDEO }],
    summaryText: '## Situación\nTaller con seis mecánicos. Quieren dejar de dar citas por teléfono.\n\n## Siguiente paso\nPrueba de dos semanas con la agenda en línea.',
    lineas: VENTA.slice(0, 30),
    hablantes: ['Marta', 'Raúl'],
  }),
  llamada({
    _id: 'i-lucia',
    workspaceId: 'w-rios',
    sessionName: 'Entrevista técnica',
    durationSec: 1830,
    createdAt: ahora - 4 * DIA - 6 * HORA,
    interviewerName: 'Irene Campos',
    project: proyecto('p-frontend'),
    candidate: { name: 'Lucía Ferrer', role: 'Desarrolladora frontend', email: 'lucia.ferrer@ejemplo.com' },
    media: [{ _id: 'f-lucia-video', kind: 'video', durationSec: 1830, ...VIDEO }],
    summaryText: '## Puntos fuertes\nMide antes de optimizar. Explica bien sus decisiones.\n\n## A revisar\nPoca experiencia con pruebas automáticas.\n\n## Recomendación\nPasar a la entrevista final.',
    lineas: ENTREVISTA,
    hablantes: ['Irene', 'Lucía'],
  }),
  llamada({
    _id: 'i-javier',
    workspaceId: 'w-rios',
    sessionName: 'Primera entrevista',
    durationSec: 1260,
    createdAt: ahora - 9 * DIA,
    interviewerName: 'Irene Campos',
    project: proyecto('p-frontend'),
    candidate: { name: 'Javier Ortega', role: 'Desarrollador frontend' },
    // Sin vídeo: la llamada se grabó solo con el micro y el audio del sistema.
    media: [{ _id: 'f-javier-mix', kind: 'mix', mimeType: 'audio/mp4', durationSec: 1260, uploadStatus: 'done' }],
    summaryText: '',
    lineas: ENTREVISTA.slice(0, 12),
    hablantes: ['Irene', 'Javier'],
  }),
  llamada({
    _id: 'i-clinica',
    workspaceId: 'w-rios',
    sessionName: 'Descubrimiento con Clínica Dental Sur',
    durationSec: 1500,
    createdAt: ahora - 16 * DIA,
    interviewerName: 'Marta Ríos',
    project: proyecto('p-clientes'),
    candidate: { name: 'Elena Prieto', role: 'Directora', email: 'elena.prieto@ejemplo.com' },
    // El vídeo aún se está subiendo desde el PC: la web tiene que decirlo y
    // no ofrecer un reproductor que no va a cargar.
    media: [{ _id: 'f-clinica-video', kind: 'video', durationSec: 1500, mimeType: 'video/mp4', uploadStatus: 'uploading' }],
    summaryText: '## Situación\nClínica con dos sillones. Pierden citas por no confirmar el día antes.',
    lineas: VENTA.slice(0, 16),
    hablantes: ['Marta', 'Elena'],
  }),
]

// ── Comentarios, enlaces y personas ──────────────────────────────────────────

export const comentarios: Record<string, Comentario[]> = {
  'i-brisa': [
    { _id: 'c1', authorName: 'Pablo Núñez', esMio: false, atSec: 26, body: 'Buen arranque: has dicho la agenda en voz alta antes de entrar en materia y ella ha confirmado el tiempo.', createdAt: ahora - DIA - 5 * HORA },
    { _id: 'c2', authorName: 'Pablo Núñez', esMio: false, atSec: 1252, body: 'Aquí hablas bastante rápido. Respira antes de dar el precio y deja que lo digan los números.', createdAt: ahora - DIA - 4 * HORA },
    { _id: 'c3', authorName: YO.nombre, esMio: true, parentId: 'c2', body: 'Cierto, me puse nerviosa con la pregunta del socio.', createdAt: ahora - DIA - 2 * HORA },
    { _id: 'c4', authorName: 'Pablo Núñez', esMio: false, atSec: 540, body: 'Muy buena pregunta de implicación. Fíjate en cómo cambia el tono de Ana a partir de aquí.', resolvedAt: ahora - DIA, createdAt: ahora - DIA - 4 * HORA },
    { _id: 'c5', authorName: 'Pablo Núñez', esMio: false, body: 'En general, buen tono y buen ritmo. Para la próxima: menos muletillas ("vale", "o sea") y más silencio después de cada pregunta.', createdAt: ahora - DIA - 3 * HORA },
    { _id: 'c6', authorName: YO.nombre, esMio: true, atSec: 2210, body: 'Revisar cómo cerré el siguiente paso: ¿debería haber puesto ya la hora?', createdAt: ahora - 20 * HORA },
  ],
  'i-taller': [
    { _id: 'c7', authorName: 'Rocío Vidal', esMio: false, atSec: 180, body: 'Bien presentado el problema del teléfono.', createdAt: ahora - 2 * DIA },
  ],
}

export const enlaces: Record<string, (Enlace & { token: string })[]> = {
  'i-brisa': [
    { _id: 'e1', token: 'demo-activo', label: 'Ana Soler (Hostal Brisa Marina)', expiresAt: ahora + 5 * DIA, openCount: 3, lastOpenedAt: ahora - 6 * HORA, createdAt: ahora - 2 * DIA },
    { _id: 'e2', token: 'demo-caducado', label: 'Socio de Ana', expiresAt: ahora - 3 * DIA, openCount: 1, lastOpenedAt: ahora - 8 * DIA, createdAt: ahora - 10 * DIA },
    { _id: 'e3', token: 'demo-revocado', label: 'Correo equivocado', expiresAt: ahora + 4 * DIA, revokedAt: ahora - DIA, openCount: 0, createdAt: ahora - 3 * DIA },
  ],
}

export const miembros: Miembro[] = [
  { _id: YO.memberId, name: YO.nombre, email: YO.email, role: 'owner', status: 'active', projectIds: [] },
  { _id: 'm-pablo', name: 'Pablo Núñez', email: 'pablo.nunez@ejemplo.com', role: 'coach', status: 'active', projectIds: ['p-clientes'] },
  { _id: 'm-irene', name: 'Irene Campos', email: 'irene.campos@ejemplo.com', role: 'editor', status: 'active', projectIds: ['p-frontend'] },
  { _id: 'm-diego', name: 'Diego Lara', email: 'diego.lara@ejemplo.com', role: 'coach', status: 'disabled', projectIds: ['p-frontend'] },
]

export const invitaciones: Invitacion[] = [
  { _id: 'v1', email: 'sofia.mendez@ejemplo.com', role: 'coach', projectIds: ['p-clientes'], createdAt: ahora - 2 * DIA },
  { _id: 'v2', email: 'equipo@ejemplo.org', role: 'editor', projectIds: ['p-frontend', 'p-clientes'], createdAt: ahora - 6 * HORA },
]

/** Donde vive el vídeo de prueba (`npm run web:video`). */
export const VIDEO_DEMO = '/demo/llamada-prueba.mp4'
