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

Nombres en formato `archivo.funcion`, en la carpeta `convex/`. `convex/_generated` está en
el repositorio (sale de un despliegue local anónimo: `CONVEX_AGENT_MODE=anonymous npx convex
dev --once`). La web llama con `api` tipado a través de `web/src/data/convex-api.ts`, así que
si cambia una firma, `npm run web:build` falla. El escritorio no puede usar el paquete
`convex` (no va en el instalador) y llama por HTTP con el nombre en texto
(`electron/cloud/convex-http.cjs`, `'sync:pushProjects'`).

Al lado de cada función se dice si es consulta, mutación o acción: el escritorio lo necesita
para llamar al punto de la API que toca.

### Sesión y espacio

- `workspace.ensureMine()` → `{ workspaceId, memberId }`. Mutación. Crea el espacio y su
  member `owner` si no existe. La llama el escritorio al iniciar sesión.
- `workspace.mine()` → `{ workspaceId, memberId, role } | null`. Consulta.
- `workspace.memberships()` → lista de `{ workspaceId, workspaceName, memberId, role, projectIds }`.
  Consulta. Para la web: un coach puede estar en varios espacios. `memberId` sirve para
  saber qué es suyo en cada espacio.
- `project.list({ workspaceId? })` → `[{ _id, workspaceId, name, company, kind, status }]`.
  Consulta. Las carpetas a las que llega quien pregunta, también las que aún no tienen
  llamadas; sin `workspaceId`, las de todos sus espacios. *(Añadida al juntar: sin ella la
  web solo podía deducir las carpetas de las llamadas.)*
- Al entrar por primera vez con un correo que tiene invitaciones `pending`, se aceptan solas
  (en el callback de Convex Auth, como `admitSignIn` en Orbit).

### Personas (solo owner/admin)

- `member.invite({ email, role, projectIds, workspaceId? })` → `invitationId`. Mutación.
  `role` es `admin`, `editor` o `coach` (dueño hay uno y no se reparte). Invitar otra vez
  al mismo correo corrige la invitación pendiente en vez de crear otra. Si esa persona ya
  tiene cuenta, se acepta en el acto.
- `member.revokeInvitation({ invitationId })`. Mutación.
- `member.list({ workspaceId? })` → `{ members, invitations }` (solo las pendientes). Consulta.
- `member.update({ memberId, role?, projectIds?, status? })`. Mutación. Al dueño no se le
  cambia nada (`owner_locked`).

`workspaceId` es opcional en `invite` y `list`: sin él se usa el espacio propio, o el único
en el que se es admin. Un admin de **varios** espacios sin espacio propio recibe
`workspace_required`, así que **la web lo pasa siempre** (la página `/personas` deja elegir
espacio). `revokeInvitation` y `update` lo sacan del registro que tocan.

### Sincronización desde el escritorio

Todas son mutaciones, reciben **lotes de hasta 100 filas** (`batch_too_large` si no), hacen
upsert por `localId` y ganan las de `updatedAt` mayor (si llega una fila más vieja que la
que hay, se ignora y se dice en la respuesta). Responden `{ applied: string[], skipped:
string[] }` con los `localId`. Solo se sube al espacio propio.

Reglas que se fijaron al construirlo:

- Un **empate** de `updatedAt` se aplica: reintentar un lote que ya llegó (porque se cortó
  la respuesta) tiene que salir como aplicado.
- Lo **borrado no resucita** con un push: un `localId` no se reutiliza, así que un push a
  algo borrado solo puede venir de un PC que aún no se ha enterado. Sale en `skipped`.
- Una fila cuyo **padre no está arriba** (un perfil sin su proyecto) se salta en vez de
  tirar el lote: un huérfano local no bloquea al resto.

- `sync.pushProjects({ items })`
- `sync.pushCandidates({ items })`: cada fila lleva `projectLocalId` en vez de `projectId`
- `sync.pushInterviews({ items })`: lleva `candidateLocalId`
- `sync.pushTranscript({ interviewLocalId, original, edited, segments?, updatedAt })`
- `sync.markDeleted({ kind: "project" | "candidate" | "interview", localIds, deletedAt })`
- `sync.pull({ since })` → `{ projects, candidates, interviews, transcripts, until, hasMore }`.
  Consulta, **paginada**: lo que cambió en el espacio desde `since` (ms), incluidos los
  borrados, hasta 200 filas por tabla y 25 transcripciones por página. Si `hasMore`, se pide
  otra vez con `since = until`. Para el segundo PC (el escritorio aún no la usa).

Qué se sube de cada entrevista: los campos de la tabla `interview`. Las rutas locales
(`recordingFilePath`, `systemAudioFilePath`, `videoFilePath`), los dispositivos y el estado
de la grabación en curso **no se suben**.

### Archivos (audio y vídeo)

Subida por partes a R2 (multipart S3), reanudable. Partes de 8 MB.

- `media.startUpload({ interviewLocalId, kind, mimeType, bytes, sha256, localRelPath, durationSec? })`
  → `{ mediaId, alreadyUploaded, partSize, partsDone }`. **Acción** (abre el multipart en R2). Si ya hay un `media` con ese
  `sha256` subido, devuelve `alreadyUploaded: true` y no hay que subir nada. Si había una
  subida a medias, devuelve las partes que ya están para seguir desde ahí.
- `media.signParts({ mediaId, partNumbers })` → `[{ partNumber, url }]`. Acción. URLs PUT
  firmadas, válidas 1 hora.
- `media.completePart({ mediaId, partNumber, etag })`. Mutación. Se llama tras cada parte
  subida, para poder reanudar.
- `media.complete({ mediaId })` → cierra el multipart en R2 y pone `done`. Acción.
- `media.abort({ mediaId })`. Acción.
- `media.listForInterview({ interviewId })` → archivos sin URL. Consulta.

Si el despliegue no tiene R2 configurado (falta alguna `R2_*`), las funciones de archivos
responden `storage_not_configured` antes de apuntar nada. La app y la web lo enseñan como
"Falta configurar el almacenamiento en la nube"; la cola del escritorio deja ese archivo en
error **sin reintentarlo sola** (no se arregla esperando) y se vuelve a lanzar con
"Reintentar" cuando el dueño haya configurado R2.

Si la llamada aún no está sincronizada, `startUpload` responde `not_found`; si R2 falla,
`storage_error`. Esos sí son pasajeros: la cola reintenta más tarde. También se rinde con
`invalid_argument`, `too_large`, `forbidden` y `read_only`.
- `media.playbackUrl({ mediaId, shareToken? })` → `{ url, expiresAt }`. Acción. URL GET
  firmada de 1 hora; comprueba acceso (member con lectura, o enlace de cliente válido) y
  apunta en `accessLog`.

`localRelPath` es la ruta dentro de `Documentos\CallTranscriber`, con la carpeta: es lo que
mantiene la estructura de carpetas al descargar en otro PC. `r2Key` lo decide el servidor:
`{workspaceId}/{interviewId}/{kind}.{ext}`.

### Web: ver y comentar

- `viewer.myInterviews({ projectId? })` → llamadas a las que llego, las recientes primero
  (hasta 200). Consulta. Filas planas: `{ _id, workspaceId, projectId, projectName,
  projectKind, projectCompany, candidateName, sessionName, interviewerName, durationSec,
  transcriptionStatus, summaryContext, createdAt, hasVideo }`.
- `viewer.interview({ interviewId })` → `{ interview, candidate, project, transcript, media,
  access: { role, canComment, canWrite } }`. **Consulta**, para que la página se actualice
  sola cuando llega la transcripción o un archivo; por eso **no escribe** en `accessLog`.
- `viewer.markViewed({ interviewId })`. Mutación. Apunta el `view` en `accessLog`. La web la
  llama **una vez** al abrir una llamada, cuando ya ha cargado (sin acceso fallaría igual).
- `comment.list({ interviewId })` → cada comentario trae además `authorName` y `isMine`.
  Consulta.
- `comment.add({ interviewId, body, atSec?, parentId? })`: necesita permiso `comment`
- `comment.edit({ commentId, body })` y `comment.remove({ commentId })`: solo su autor
- `comment.resolve({ commentId, resolved })`: autor, owner o admin

### Enlaces de cliente

- `share.create({ interviewId, label })` → `{ shareLinkId, url, expiresAt }`. El token sale
  **una sola vez** en la respuesta; se guarda su hash. URL: `{WEB_URL}/l/{token}`.
- `share.renew({ shareLinkId })` → otros 7 días desde ahora.
- `share.revoke({ shareLinkId })`
- `share.list({ interviewId })`
- `share.open({ token })` → `{ expired: false, interview, candidate, project, transcript,
  media, expiresAt }`: lo de `viewer.interview` sin comentarios ni datos de contacto del
  perfil (del perfil solo `name` y `role`). **Mutación**, no consulta: suma `openCount`,
  apunta la visita y lleva el límite de peticiones, y una consulta no puede escribir. La web
  la pide una vez al abrir (el cliente ve una foto, no se actualiza sola). Pública, sin
  sesión. Caducado o revocado devuelve `{ expired: true }`, sin decir más.

`share.*` y `comment.*` (menos `list`) son mutaciones; `share.list` es consulta.

### Errores

Todo error que tenga que ver la persona sale como `ConvexError({ code, message })`
(`convex/errors.ts`). El `code` es estable, en inglés y en minúsculas; el `message`, en
español, solo para cuando la interfaz no conoce el código. La web los traduce en
`web/src/errores.ts`, el escritorio en `CloudPanel.tsx` (vía `classifySignInError` en
`electron/cloud/session.cjs`).

Códigos: `unauthenticated`, `not_found`, `forbidden`, `read_only`, `no_workspace`,
`workspace_required`, `invalid_argument`, `batch_too_large`, `already_member`,
`owner_locked`, `not_pending`, `too_large`, `upload_state`, `storage_error`,
`not_configured` (falta `WEB_URL`), `storage_not_configured` (falta R2), `rate_limited`, `invalid_redirect`, y los de entrar con contraseña:
`invalid_credentials`, `account_exists`, `too_many_attempts`, `weak_password` (mínimo 8
caracteres).

Los de contraseña existen porque Convex Auth lanza errores normales y, en producción, Convex
cambia su texto por "Server Error": sin `code`, la app no distinguiría "contraseña mal" de
"ese correo ya tiene cuenta". Correo desconocido y contraseña mal dan el mismo código a
propósito, para que la pantalla de entrar no sirva para averiguar quién tiene cuenta.

### Entrar con Google desde el escritorio

La app abre Google en el navegador del sistema con `redirectTo =
http://localhost:3000/convex-auth` y escucha la vuelta en su servidor local. El callback
`redirect` de Convex Auth (`convex/authRedirect.ts`) solo deja volver a esa dirección exacta
(ninguna otra de localhost), a rutas relativas de la web y a direcciones que empiecen por
`SITE_URL`.

## Rutas de la web

- `/`: entrar (Google o correo y contraseña) y lista de llamadas
- `/i/{interviewId}`: llamada para coaches y compañeros
- `/l/{token}`: llamada para un cliente, sin cuenta
- `/personas`: invitar y gestionar coaches y compañeros (solo owner/admin; si se administra
  más de un espacio, se elige cuál arriba a la derecha)

Es una web de una sola página: el servidor tiene que devolver `index.html` para cualquier
ruta (ver `PUESTA-EN-MARCHA.md`).

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
