# Contrato de la nube

Este documento y `convex/schema.ts` son el punto de encuentro de todos los que trabajan en
la nube. La app de escritorio, el backend de Convex y la web de coaches y clientes se
construyen a la vez y por separado: cada uno trabaja contra lo que pone aquí, no contra lo
que haya hecho el otro. **Si necesitas cambiar algo de este contrato, no lo cambies por tu
cuenta: anótalo en tu informe y se decide al juntar.**

## Las piezas

- **App de escritorio (Electron).** Graba, transcribe y resume en el PC, como siempre. El
  PC sigue siendo el original: si la nube falla o no hay sesión, la app funciona igual que
  hoy. Encima de eso, sincroniza una copia con la nube.
- **Convex.** Base de datos, cuentas y permisos. Un proyecto de Convex propio, separado del
  CRM de Orbit.
- **Cloudflare R2.** Audio y vídeo. La app los sube directamente a R2 con direcciones
  firmadas que da Convex; los bytes nunca pasan por las funciones de Convex.
- **Web (`web/`).** Página estática para coaches y clientes. Vídeo con la transcripción al
  lado, comentarios por segundo y la página del enlace del cliente.

Lo que no cambia: las claves de IA siguen en el `config.json` local, la transcripción y el
resumen siguen saliendo del PC, y el envío al CRM sigue saliendo de `electron/crm.cjs`. La
nube no habla con Orbit.

## Personas y permisos

Cuentas con Convex Auth: **Google** o **correo y contraseña**, igual que el CRM de Orbit
(`orbit/packages/orbit-gtm/convex/auth.ts`). Registrarse no da acceso a nada: solo se ve lo
de un espacio en el que se es `member` activo.

- **owner**: el dueño del espacio. Todo.
- **admin**: lo mismo menos borrar el espacio.
- **editor**: compañero. Lee y escribe en los proyectos de su `projectIds`.
- **coach**: lee, ve el vídeo y comenta en los proyectos de su `projectIds`. No edita.
- **enlace de cliente**: sin cuenta. Una sola llamada, solo lectura, vídeo incluido, sin
  comentarios. Caduca a los **7 días** y el dueño lo puede renovar otros 7 o revocar.

Toda función pública comprueba el acceso al principio, con un único ayudante
(`requireAccess(ctx, { interviewId | projectId }, "read" | "write" | "comment")`), igual que
`getAccessContext` + `loadRecord` en Orbit. Nunca se confía en un id que mande el cliente sin
pasar por ahí.

## Ids y fechas

- El escritorio identifica todo por `localId`, el id que ya tiene en
  `call-transcriber-datos.json`. Las funciones de sincronización reciben y devuelven
  `localId`; la web trabaja con los `_id` de Convex.
- Fechas en milisegundos. El escritorio guarda texto ISO: convierte la capa de
  sincronización.
- Borrar es poner `deletedAt`. Las consultas de la web filtran lo borrado.

## Funciones

Nombres en formato `archivo.funcion`, en la carpeta `convex/`. Mientras no exista
`convex/_generated` (sale al conectar con un despliegue), la app y la web pueden llamarlas
con `anyApi` de `convex/server` a través de un módulo propio que las envuelva, para cambiarlo
por `api` tipado sin tocar el resto.

### Sesión y espacio

- `workspace.ensureMine()` → `{ workspaceId, memberId }`. Mutación. Crea el espacio y su
  member `owner` si no existe. La llama el escritorio al iniciar sesión.
- `workspace.mine()` → `{ workspaceId, memberId, role } | null`. Consulta.
- `workspace.memberships()` → lista de `{ workspaceId, workspaceName, role, projectIds }`.
  Para la web: un coach puede estar en varios espacios.
- Al entrar por primera vez con un correo que tiene invitaciones `pending`, se aceptan solas
  (en el callback de Convex Auth, como `admitSignIn` en Orbit).

### Personas (solo owner/admin)

- `member.invite({ email, role, projectIds })` → `invitationId`
- `member.revokeInvitation({ invitationId })`
- `member.list()` → members e invitaciones pendientes del espacio
- `member.update({ memberId, role?, projectIds?, status? })`

### Sincronización desde el escritorio

Todas reciben **lotes de hasta 100 filas**, hacen upsert por `localId` y ganan las de
`updatedAt` mayor (si llega una fila más vieja que la que hay, se ignora y se dice en la
respuesta). Responden `{ applied: string[], skipped: string[] }` con los `localId`.

- `sync.pushProjects({ items })`
- `sync.pushCandidates({ items })`: cada fila lleva `projectLocalId` en vez de `projectId`
- `sync.pushInterviews({ items })`: lleva `candidateLocalId`
- `sync.pushTranscript({ interviewLocalId, original, edited, segments?, updatedAt })`
- `sync.markDeleted({ kind: "project" | "candidate" | "interview", localIds, deletedAt })`
- `sync.pull({ since })` → todo lo que cambió en el espacio desde `since` (ms), proyectos,
  perfiles, entrevistas y transcripciones, incluidos los borrados. Para el segundo PC.

Qué se sube de cada entrevista: los campos de la tabla `interview`. Las rutas locales
(`recordingFilePath`, `systemAudioFilePath`, `videoFilePath`), los dispositivos y el estado
de la grabación en curso **no se suben**.

### Archivos (audio y vídeo)

Subida por partes a R2 (multipart S3), reanudable. Partes de 8 MB.

- `media.startUpload({ interviewLocalId, kind, mimeType, bytes, sha256, localRelPath, durationSec? })`
  → `{ mediaId, alreadyUploaded, partSize, partsDone }`. Si ya hay un `media` con ese
  `sha256` subido, devuelve `alreadyUploaded: true` y no hay que subir nada. Si había una
  subida a medias, devuelve las partes que ya están para seguir desde ahí.
- `media.signParts({ mediaId, partNumbers })` → `[{ partNumber, url }]`. Acción. URLs PUT
  firmadas, válidas 1 hora.
- `media.completePart({ mediaId, partNumber, etag })`. Mutación. Se llama tras cada parte
  subida, para poder reanudar.
- `media.complete({ mediaId })` → cierra el multipart en R2 y pone `done`.
- `media.abort({ mediaId })`
- `media.listForInterview({ interviewId })` → archivos sin URL.
- `media.playbackUrl({ mediaId, shareToken? })` → `{ url, expiresAt }`. Acción. URL GET
  firmada de 1 hora; comprueba acceso (member con lectura, o enlace de cliente válido) y
  apunta en `accessLog`.

`localRelPath` es la ruta dentro de `Documentos\CallTranscriber`, con la carpeta: es lo que
mantiene la estructura de carpetas al descargar en otro PC. `r2Key` lo decide el servidor:
`{workspaceId}/{interviewId}/{kind}.{ext}`.

### Web: ver y comentar

- `viewer.myInterviews({ projectId? })` → llamadas a las que llego, las recientes primero.
- `viewer.interview({ interviewId })` → entrevista + perfil + proyecto + transcripción +
  lista de archivos. Apunta un `view` en `accessLog`.
- `comment.list({ interviewId })`
- `comment.add({ interviewId, body, atSec?, parentId? })`: necesita permiso `comment`
- `comment.edit({ commentId, body })` y `comment.remove({ commentId })`: solo su autor
- `comment.resolve({ commentId, resolved })`: autor, owner o admin

### Enlaces de cliente

- `share.create({ interviewId, label })` → `{ shareLinkId, url, expiresAt }`. El token sale
  **una sola vez** en la respuesta; se guarda su hash. URL: `{WEB_URL}/l/{token}`.
- `share.renew({ shareLinkId })` → otros 7 días desde ahora.
- `share.revoke({ shareLinkId })`
- `share.list({ interviewId })`
- `share.open({ token })` → lo mismo que `viewer.interview` sin comentarios ni datos de
  contacto del perfil (correo, teléfono, notas, CRM). Pública, sin sesión, con límite de
  peticiones. Caducado o revocado devuelve `{ expired: true }`, sin decir más.

## Rutas de la web

- `/`: entrar (Google o correo y contraseña) y lista de llamadas
- `/i/{interviewId}`: llamada para coaches y compañeros
- `/l/{token}`: llamada para un cliente, sin cuenta

## Dónde vive cada cosa

- `convex/`: backend. Frente A.
- `electron/cloud/` y `src/lib/cloud/`: sesión y sincronización del escritorio. Frente B.
- `electron/cloud/upload*`: compresión y subida de archivos, y migración de las grabaciones
  antiguas. Frente C.
- `web/`: la web, con su propio `vite.web.config.ts`, compilada a `dist-web/`. Frente E.
- `src/App.tsx` se toca lo mínimo: el código nuevo va en sus propios archivos y `App.tsx`
  solo los importa y los llama.

Las dependencias ya están instaladas (todas en `devDependencies`, porque o se ejecutan en
Convex o las empaqueta Vite, y así no engordan el instalador): `convex`,
`@convex-dev/auth`, `@auth/core`, `@convex-dev/r2`, `@aws-sdk/client-s3`,
`@aws-sdk/s3-request-presigner`, `convex-test`, `vitest` y `@edge-runtime/vm`. Si necesitas
otra, dilo en el informe en vez de instalarla: los frentes trabajan en copias separadas y el
`package-lock.json` chocaría.

## Variables

En el despliegue de Convex: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `SITE_URL`,
`JWT_PRIVATE_KEY`, `JWKS`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `WEB_URL`.

En la app y la web, solo la dirección pública: `VITE_CONVEX_URL`. Ninguna clave va en el
código ni en el repositorio.
