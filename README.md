# Call Transcriber

Graba, transcribe y resume entrevistas de trabajo con IA. Aplicación de escritorio para
Windows: captura tu micrófono **y** el audio de la videollamada, separa quién dice qué,
transcribe y genera un resumen de evaluación.

**Los datos se quedan en tu ordenador.** No hay servidor nuestro, no hay cuenta obligatoria
y no hay suscripción. Pones tu propia clave de un servicio de IA (Groq es gratis y no pide
tarjeta) y listo.

> **Solo Windows 10/11.** La captura del audio del sistema usa `loopback`, que en la
> práctica es de Windows. En macOS y Linux compila, pero no graba.

---

## Qué hace

- **Graba micrófono + audio del sistema a la vez**, o solo micrófono. Opcionalmente, vídeo
  de la pantalla o de una ventana concreta.
- **Separa hablantes**: usa la pista limpia del interlocutor para saber cuál de las voces
  es la suya, en vez de adivinar por los silencios.
- **Transcribe** con el servicio que elijas y te deja editar el texto a mano.
- **Resume** en dos formatos: ejecutivo (por secciones) o descriptivo (prosa), y con dos
  contextos: entrevista de selección o reunión de negocio.
- **Organiza** por proyectos, candidatos y entrevistas, con criterios de evaluación y
  entrevistadores por proyecto.
- **Consentimiento del candidato** (RGPD): casilla, aviso al grabar, exportación y borrado
  de datos.
- **Exporta a PDF**.

## Instalación

1. Descarga el instalador de la [última versión](https://github.com/Vankish/Call-transcriber/releases/latest)
   (`Call-Transcriber-Setup-X.Y.Z.exe`).
2. Ejecútalo. **Windows te va a avisar de que el editor es desconocido**: pulsa
   `Más información` → `Ejecutar de todas formas`.

   No es un fallo ni una alarma real: ese aviso se quita comprando un certificado de firma
   de código (200-400 €/año) y este proyecto no lo tiene. Por lo mismo, **la app no se
   actualiza sola**: te avisa cuando hay versión nueva y te abre esta misma página para que
   descargues el instalador.

3. Ábrela y pulsa **Empezar sin cuenta**.
4. Te pedirá una **API key de IA**. La de Groq es gratis y no pide tarjeta:
   [console.groq.com](https://console.groq.com) → *API Keys* → crear una → pegarla.

Ya está. La clave se guarda solo en tu equipo y nunca se envía a ningún sitio que no sea
el proveedor de IA que hayas elegido.

## Qué servicio de IA usar

La app no depende de ningún proveedor: sabe hablar los dialectos de API más comunes y
puedes cambiar de servicio en **Configuración → Motores de IA** sin tocar nada más.

| Servicio | Para | Nota |
|---|---|---|
| **Groq** | Transcribir y resumir | Gratis, sin tarjeta. Lo más fácil para empezar. |
| **ElevenLabs (Scribe)** | Transcribir | El mejor en español y separando hablantes. De pago pasada la cuota gratuita. |
| **OpenAI** | Transcribir y resumir | |
| **Deepgram** | Transcribir | |
| **Anthropic (Claude)** | Resumir | |
| **Otro (personalizado)** | Ambos | Escribe tú la URL: tu propio servidor, un modelo local, lo que sea. |

Los que llevan la etiqueta **«sin probar»** en la app tienen el adaptador escrito pero
nadie los ha ejecutado contra la API real todavía.

## Sincronizar entre ordenadores y compartir carpetas *(opcional)*

Sin cuenta, todo vive en este equipo. Si quieres abrir tus entrevistas desde otro
ordenador o dar acceso a un compañero, hace falta una base de datos, y **cada usuario pone
la suya** — así tus datos son tuyos y nadie los aloja por ti. El plan gratuito de Supabase
llega para unas 15 entrevistas con audio.

Esto **no viene en el instalador**: el `.exe` publicado es solo local a propósito. Para
tener la nube hay que compilar tu propia copia:

```bash
git clone https://github.com/Vankish/Call-transcriber.git
cd Call-transcriber
npm install
```

1. Crea un proyecto gratuito en [supabase.com](https://supabase.com).
2. En su **SQL Editor** → *New query*, pega entero
   [`supabase/setup.sql`](supabase/setup.sql) y pulsa **Run**. Crea las tablas, los
   permisos y el almacén de audios de una vez.
3. Copia `.env.example` a `.env` y rellénalo con los datos de
   **Project Settings → API** de tu proyecto:

   ```
   VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
   VITE_SUPABASE_ANON_KEY=TU_CLAVE_PUBLICABLE
   ```

4. `npm run package:win` genera tu instalador en `release/`.

Con eso aparece el registro en la pantalla de entrada. Al crear la cuenta, lo que ya
tuvieras en local se sube solo.

**Límites del plan gratuito:** 1 GB de archivos y 50 MB por archivo. Un mp3 de una hora
(~32 MB) entra; uno de dos horas, no. El **vídeo nunca se sube**: pesa unos 300 MB por
entrevista y llenaría el gigabyte con dos.

## Privacidad

Estás grabando a personas en un proceso de selección, así que conviene saber exactamente
por dónde pasan sus datos:

- **La grabación de audio** sale de tu equipo hacia el proveedor de transcripción que
  hayas elegido. Todos los incluidos por defecto tienen los servidores en **Estados
  Unidos**.
- **El texto de la entrevista** sale hacia el proveedor de resumen.
- **El vídeo** nunca sale de tu ordenador.
- **Tus claves de IA** se guardan solo en el `config.json` local de la instalación.
- Si activas la nube, los datos y los audios que subas van a **tu** proyecto de Supabase.

En [`legal/`](legal/) hay borradores de política de privacidad, consentimiento del
candidato, contrato de encargo (DPA) y política de retención. **Son borradores y necesitan
la revisión de un abogado** antes de usarse de verdad.

## Desarrollo

```bash
npm install
npm run desktop:dev     # app de escritorio con recarga en caliente
npm run build           # tsc + vite → dist/
npm run package:win     # build + instalador NSIS en release/
npm run lint
```

⚠️ `electron-builder` **no compila nada**: empaqueta lo que haya en `dist/`. Si lo lanzas
sin `npm run build` delante, reconstruyes el `.exe` con el código viejo.

Más contexto del proyecto en [`CLAUDE.md`](CLAUDE.md) y en
[`docs/ESTADO_LANZAMIENTO.md`](docs/ESTADO_LANZAMIENTO.md).

## Licencia

[MIT](LICENSE).
