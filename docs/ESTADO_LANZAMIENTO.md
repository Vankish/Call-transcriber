# Estado de lanzamiento — Call Transcriber

> Documento de contexto para retomar el trabajo desde cualquier dispositivo.
> Última actualización: 2026-09-04.

## ⚠️ 2026-09-04: SE REESCRIBIÓ EL HISTORIAL DE GIT

**Si tienes un clon en otro PC, `git pull` va a fallar.** No está roto: el historial
del repositorio es distinto al que tenías. Para ponerte al día en el otro equipo:

```powershell
git fetch origin
git reset --hard origin/main
```

**Por qué se hizo:** `.claude/settings.local.json` estaba versionado desde el primer
commit y guardaba un **token personal de Figma** dentro de una regla de permiso. El
repositorio es público, así que el token estuvo a la vista meses. Se revocó en Figma y
se borró el archivo de los 52 commits con `git filter-repo`, forzando el push de `main`,
de la rama `feat/motores-ia-multiproveedor` y de los cuatro tags. Las releases de GitHub
y sus `.exe` sobrevivieron intactas.

⚠️ Reescribir el historial **no borra nada de internet**: GitHub conserva los commits
viejos accesibles por su identificador y quien haya clonado o forkeado el repo se lo
llevó. Lo que repara de verdad es la revocación del token, que ya está hecha.

**A partir de ahora `.claude/` está en `.gitignore`.** Es configuración de cada equipo,
no del proyecto, y `settings.local.json` acumula reglas de permiso que pueden llevar
credenciales dentro.

## ✅ 2026-09-04: el repo ya se puede usar legalmente (MIT)

Se añadió `LICENSE` (MIT) y el campo `license` en `package.json`. Sin ese archivo, un
repositorio público es «todos los derechos reservados»: el código está a la vista pero
nadie puede usarlo, copiarlo ni modificarlo. Con MIT cualquiera puede, manteniendo la
atribución.

## ✅ 2026-09-04: la app ya funciona sin cuenta

Antes `src/App.tsx` cortaba en seco sin sesión, así que quien instalara el `.exe` o
clonara el repo sin credenciales de Supabase no pasaba del login. Ahora la pantalla de
entrada ofrece **«Empezar sin cuenta»** y se entra directo: grabar, transcribir y resumir
funcionan contra el disco de este equipo. La cuenta queda para lo que de verdad la
necesita: sincronizar entre ordenadores y compartir carpetas.

No hizo falta capa de datos nueva — el guardado en `localStorage` sin sesión ya existía,
solo faltaba la puerta. Y al crear la cuenta más tarde, lo creado en local se sube solo.

## 🔴 2026-09-04: el `.exe` publicado lleva TUS claves de Supabase dentro

Vite compila `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` **dentro del bundle**. Como
las releases se han construido siempre con tu `.env` presente, el instalador que hay
publicado en GitHub (v1.0.3) contiene la URL y la clave publicable de tu proyecto. Está
comprobado: la cadena `jqbtrduafmmdnyayewvc` aparece en el JavaScript compilado.

**Qué significa:** cualquiera que se descargue ese `.exe` y se registre crea una cuenta
**en tu proyecto de Supabase**, y los datos de sus candidatos entran en tu base de datos.
Te convierte en responsable del tratamiento de entrevistas de gente que no conoces, y su
consumo cuenta contra tu plan gratuito.

🔲 **Comprobar** en Supabase → Authentication → Users si ya hay cuentas que no sean tuyas.

🔲 **Al publicar la v1.1.0**, compilar **sin `.env`** (renombrarlo o moverlo antes de
`npm run build`). Así el instalador público sale en modo local puro, que es justo lo
decidido. Tu copia personal se compila aparte, con el `.env` en su sitio.

## 🔲 Pendientes de esta tanda (2026-09-04)

- **Falta el permiso `workflow` en `gh`** para poder subir `.github/workflows/ci.yml`,
  que ya está escrito. Ejecutar `gh auth refresh -s workflow` y hacer el push.
- **Ejecutar `supabase/setup.sql`** en el SQL Editor: cubre de una vez las dos migraciones
  que seguían pendientes (audios en la nube y carpetas compartidas).
- **Un par de capturas para el README**, sin datos de candidatos reales.
- **Publicar la v1.1.0** con los 15+ commits sin publicar (ver el punto rojo de arriba).

## ❌ DECIDIDO 2026-08-14: no se compra certificado de firma

David decide no pagar los ~200-400 €/año. Consecuencias, ya aplicadas en el código:

- **La app no se actualiza sola y no lo hará.** `autoDownload` y `autoInstallOnAppQuit`
  están en `false`: antes se bajaban 120 MB en cada arranque para que Windows rechazara
  instalarlos, fallando en silencio. Ahora electron-updater solo sirve para **enterarse**
  de que hay versión nueva.
- **El banner ahora dice la verdad**: "hay una nueva versión, la app no se actualiza sola"
  con un botón **Descargar** que abre la página de releases en el navegador. Instalar es
  manual: descargar el `.exe` y ejecutarlo.
- **SmartScreen seguirá avisando** ("editor desconocido" → `Más información` →
  `Ejecutar de todas formas`). Sin certificado no hay forma de quitarlo.
- Se ha borrado `build.win.signtoolOptions` de `package.json` (era configuración muerta).
  Si algún día se compra el certificado, está en el historial de git.

⚠️ **Ojo si hay más usuarios con la app instalada**: `git pull` solo actualiza los equipos
de desarrollo. Quien tenga el `.exe` instalado se queda donde está hasta que se le avise.

## Resumen

La app está **técnicamente lista para lanzar**. En la sesión del 2026-06-10 se cerraron los
4 bloqueadores de pre-lanzamiento. El auto-update funciona salvo por el paso final, que
sigue **bloqueado por la falta de certificado de firma**.

## Última release: v1.0.3 (2026-07-29)

Publicada SIN firma, como decisión consciente. Se instala a mano (SmartScreen avisa de
"editor desconocido" → `Más información` → `Ejecutar de todas formas`).

**Por qué hizo falta:** la v1.0.2 publicada el 15/07 era anterior a los commits del 20/07 y
22/07, así que los usuarios nunca recibieron el selector Pantalla/Ventana, el fix de CPU en
llamadas largas ni los motores de IA intercambiables. Y como `package.json` seguía diciendo
`1.0.2` —el mismo número que la release publicada— las dos versiones eran indistinguibles
entre sí. **Lección: subir `version` en `package.json` en el mismo commit que se publica.**

⚠️ **Efecto conocido:** los usuarios en v1.0.2 detectarán la v1.0.3 y descargarán el diff,
pero `electron-updater` no lo aplicará (falta firma) y fallará en silencio en cada arranque.
El banner de actualización de `src/App.tsx` nunca llega a mostrarse. Hay que avisarles de
que descarguen el `.exe` a mano hasta que haya certificado.

### ⚠️ Un `git pull` NO actualiza la app en un equipo de desarrollo

Si el acceso directo apunta a `release\win-unpacked\Call Transcriber.exe` (build empaquetada),
el código nuevo no se ve hasta **reconstruir**:

```powershell
git pull
npm install                                        # solo si cambió package.json
npm run build                                      # ⚠️ IMPRESCINDIBLE: tsc + vite → dist/
npx electron-builder --win --dir --publish never   # refresca win-unpacked, sin instalador
```

⚠️ **Trampa clásica:** `electron-builder` **no compila nada**, solo empaqueta lo que ya haya
en `dist/`. Si lo lanzas sin `npm run build` delante, reconstruyes el `.exe` con el código
VIEJO y parece que el `git pull` no ha servido de nada. `npm run package:win` sí hace los dos
pasos (`npm run build && electron-builder`), pero genera además el instalador NSIS.

## Hecho ✅

- **Auto-actualización**: empaquetado migrado de `electron-packager` → **electron-builder (NSIS)**.
  `electron-updater` + `electron-log` integrados en `electron/main.cjs` (chequea 4 s tras arrancar,
  solo en producción). Banner de actualización en `src/App.tsx`. Publish provider = **GitHub Releases**
  (`Vankish/Call-transcriber`, repo **público**).
- **Release v1.0.0 PUBLICADA** en GitHub con `.exe` + `.blockmap` + `latest.yml`.
- **Code signing**: config lista en `package.json` (`build.win.signtoolOptions`). Firma automática si
  se exportan `CSC_LINK` + `CSC_KEY_PASSWORD`. **Falta comprar el certificado OV/EV.**
- **GDPR/RGPD**: consentimiento del candidato (checkbox + badge + aviso al grabar), borrado y
  exportación de datos. Documentos legales (borradores) en `legal/`. Migración de columnas aplicada.
- **Seguridad**: Groq API key fuera de la nube; columna `groq_api_key` eliminada de Supabase.
- **Supabase**: `supabase-migration-launch.sql` **ya ejecutado** en el proyecto
  `jqbtrduafmmdnyayewvc` (añadió `candidates.consent_given/consent_at`, borró `profiles.groq_api_key`).

## Test de auto-update — RESULTADO ✅ (parcial, bloqueado por firma)

Test ejecutado el 2026-06-10 en el mismo equipo de desarrollo (sin segundo dispositivo disponible).

**Lo que funcionó:**
- La v1.0.0 instalada detectó la v1.0.1 en ~4 s ✅
- Descargó el diff (solo 975 KB de 120 MB) ✅
- El mecanismo de update completo funciona técnicamente ✅

**Dónde falló:**
- `electron-updater` rechazó aplicar el update porque el instalador no está firmado digitalmente.
- Error en logs (`AppData\Roaming\call-transcriber-app\logs\main.log`):
  `"New version 1.0.1 is not signed by the application owner"`
- El banner azul de `src/App.tsx` nunca llegó a mostrarse porque el proceso falla antes.

**Conclusión:** el auto-update funciona, está bloqueado SOLO por la falta de certificado de firma.

### Próximos pasos (en orden)

1. ~~**Decidir** qué hacer con la firma~~ → **DECIDIDO 2026-07-29:** publicar sin firma
   (v1.0.3). Instalación manual.
2. ~~**Certificado OV/EV**~~ → **DESCARTADO 2026-08-14:** no se compra. La instalación es
   manual para siempre y el aviso de SmartScreen se queda.
3. **Groq API key en Supabase**: pendiente de reimplementar — se eliminó por seguridad pero
   tiene sentido vincularla a la cuenta del usuario (protegida por RLS) para que no haya que
   reintroducirla en cada dispositivo. Requiere: migración SQL (añadir columna `groq_api_key`
   a `profiles`) + actualizar `src/App.tsx` (Ajustes) para leer/escribir desde Supabase.

### Cómo publicar futuras versiones (desde un equipo de desarrollo)

Requisitos de build: Windows x64, **Modo de desarrollador activado** (para los symlinks de
winCodeSign), `npm install`. Subir `version` en package.json, luego:

```powershell
# Si ya tienes gh CLI autenticado, no hace falta ningún PAT ni gh_token.txt:
$env:GH_TOKEN = (gh auth token).Trim()
npm run release:win
# electron-builder crea la release como BORRADOR. Para publicarla:
gh release edit v1.0.3 --repo Vankish/Call-transcriber --draft=false --latest
```

**Ojo con la sandbox:** `git push` y `gh release edit` son operaciones de escritura y pueden
salir bloqueadas ("Failed to connect to github.com port 443") aunque `git fetch` funcione.
No es un fallo de red ni de credenciales.

## Prueba pendiente tras el commit `bbfd8e3` (2026-07-30) 🔲

Se arregló que la voz del entrevistador salía a trozos: ya no se recorta por silencios,
se usa la separación de hablantes que devuelve ElevenLabs y la pista de sistema solo
decide cuál de los hablantes es el interlocutor.

**Falta confirmarlo con una grabación real**, y solo se puede hacer en el PC donde se grabó
(**PC-Usuari**): re-transcribir la reunión del 30/07 y comprobar que la
voz del entrevistador sale completa. Los `.mp3` / `_system.webm` **no sincronizan** — solo
viajan los metadatos y el texto, así que en el otro PC la entrevista aparece en la lista
pero sin audio con el que trabajar.

Cómo saber si fue por el camino nuevo: en `%APPDATA%\call-transcriber-app\logs` debe aparecer
`separación por hablantes del proveedor` con el % de coincidencia de cada hablante. Si dice
`palabras + audio medido`, cayó al método anterior y hay que mirar por qué.

Instalador ya compilado y firmado: `release\Call Transcriber Setup 1.0.3.exe` (30/07 16:06).
La versión no se subió a propósito — es empaquetado local, no release. Si se publica, subir a
1.0.4 en el mismo commit.

## Audios en la nube (2026-08-14) 🔲 falta correr el SQL

Antes los `.mp3` vivían solo en `Documents\CallTranscriber` del PC que grabó: en el otro
equipo la entrevista salía en la lista pero sin audio, así que no se podía ni escuchar ni
re-transcribir. Ahora se suben a **Supabase Storage** (bucket privado `recordings`).

- **Se suben dos archivos por entrevista**: la mezcla (lo que se transcribe) y la pista de
  sistema (voz limpia del interlocutor, necesaria para separar hablantes). Unos 60-70 MB por
  hora de entrevista entre las dos.
- **El vídeo NO se sube**: ~300 MB por entrevista, llenaría el plan gratuito con dos.
- **Espacio**: 1 GB gratis ≈ **15 entrevistas**. Al borrar una entrevista/perfil/proyecto se
  borran también sus audios de la nube, para no acumular huérfanos.
- **Límite por archivo: 50 MB** en el plan gratuito. Una entrevista de ~2 h no subirá.
- En la lista de grabaciones cada entrevista lleva un distintivo: `☁ En la nube` o
  `↑ Solo en este PC · Subir` (este último es un botón, para las grabaciones antiguas).

🔲 **PENDIENTE: correr el SQL** en el SQL Editor de Supabase. Hasta entonces no existe el
bucket ni las columnas y las subidas fallarán. Desde el 2026-09-04 basta con pasar
**`supabase/setup.sql`**, que incluye esta migración y la de carpetas compartidas en el
orden correcto — las dos de una vez.

## Compartir carpetas con un compañero (2026-08-25) 🔲 falta correr el SQL

Hasta ahora cada usuario solo veía sus propias carpetas: si dos personas entrevistaban para el
mismo puesto, había que pasarse los textos a mano. Ahora el dueño de un proyecto puede **dar
acceso a un compañero por su correo**, y ese compañero lo ve en su propia app etiquetado como
**"Compartido por [nombre]"**.

📄 **Guía completa paso a paso para David: [`docs/COMPARTIR.md`](COMPARTIR.md).**

- **Cómo se comparte**: al editar un proyecto hay una caja **"Compartir con"** → escribes el
  correo → **Buscar** → si esa persona tiene cuenta, sale su nombre y un botón **Dar acceso**.
  Si no la tiene, sale *"No hay ninguna cuenta de Call Transcriber con ese correo"* y no se
  puede añadir: **la app no manda invitaciones**, el compañero se registra él primero.
- **Permisos del invitado**: puede ver y **trabajar** (leer transcripciones y resúmenes,
  escuchar audios, transcribir, generar resúmenes, editar la transcripción, añadir candidatos).
  **No** puede borrar el proyecto, ni compartirlo con otros, ni quitar a nadie. Eso es solo del
  dueño. No hay modo "solo lectura".
- **El vídeo NO viaja** (~300 MB por entrevista contra 1 GB de plan gratis). El compañero ve
  texto y resumen; el vídeo se queda en el PC que grabó.
- **El audio solo viaja si se subió** con el botón `☁` de cada grabación. Si sigue en
  `↑ Solo en este PC`, el compañero verá la entrevista y su texto pero no podrá escucharla ni
  re-transcribirla. **Antes de compartir una carpeta, repasar sus grabaciones y subir las
  locales.**
- **Límites del plan gratis**: 50 MB por archivo (un mp3 de 1 h ≈ 32 MB entra; uno de 2 h no) y
  1 GB en total ≈ 15 entrevistas.

✅ **Código hecho.**
🔲 **PENDIENTE, en este orden:**
1. Correr **`supabase-migration-compartir.sql`** en el SQL Editor de Supabase. Hasta entonces
   el buscador de la app no encontrará a nadie. Es idempotente: se puede ejecutar varias veces.
2. **Empaquetar la app** y distribuirla (`npm run build` + `electron-builder`; ver arriba).
3. **Que el compañero se instale la app y se registre.** Mientras no exista su cuenta, su
   correo no aparece en la búsqueda: es la causa nº 1 de "no me lo encuentra".

## Pendiente (acciones externas) ⏳

- ~~**Certificado de firma**~~ → **DESCARTADO 2026-08-14** (ver arriba). No se compra.
- **Legal**: rellenar huecos `[ ]` de `legal/*.md` + revisión de abogado. Decidir **región de Supabase**
  (recomendado UE) y verificar retención/transferencia de Groq (EE.UU.). ⚠️ Ahora también se
  guardan **audios** de las entrevistas en Supabase, no solo texto: afecta a lo que hay que
  contarle al candidato y a la región donde se alojan.
- ~~**`build/` está en `.gitignore`**~~ → **ya resuelto** (verificado 2026-07-29): `build/icon.ico`
  está versionado en git y `build/` no está ignorado. Un clon limpio compila.

## Archivos clave

- `docs/RELEASE_Y_FIRMA.md` — guía completa de release + firma.
- `docs/COMPARTIR.md` — guía paso a paso para compartir carpetas con un compañero.
- **`supabase/setup.sql` — el único que hay que ejecutar.** Los cinco de abajo encadenados
  en el orden correcto e idempotente: sirve para montar un proyecto nuevo desde cero y
  para poner al día uno existente. ⚠️ Generado el 2026-09-04 a partir de los cinco;
  **no se ha ejecutado todavía contra una base de datos**.
- `supabase-migration-launch.sql` — migración (ya ejecutada).
- `supabase-migration-audio-nube.sql` — audios en la nube (🔲 pendiente de ejecutar).
- `supabase-migration-compartir.sql` — carpetas compartidas (🔲 pendiente de ejecutar).
- `legal/` — documentos RGPD (borradores).
- `electron/main.cjs` — IPC + autoUpdater. `src/App.tsx` — UI (banner update, badge versión, consentimiento).
