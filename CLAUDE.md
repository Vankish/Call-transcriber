# Call Transcriber — Contexto del Proyecto

> ⚡ **Estado actual / lanzamiento:** lee primero `docs/ESTADO_LANZAMIENTO.md`.

## Qué es esta app

Aplicación de escritorio para **grabar, transcribir y resumir entrevistas de trabajo**.
Graba a la vez el micrófono y el audio del sistema (la voz del interlocutor en una
videollamada), separa quién dice qué, transcribe con IA y genera un resumen de
evaluación.

**Solo Windows.** El empaquetado es NSIS y la captura del audio del sistema usa
`loopback`, que en la práctica es de Windows. Compila en otros sistemas, pero no graba.

## Stack técnico

- **Frontend:** React 19 + TypeScript + Vite
- **Escritorio:** Electron (+ electron-builder para el instalador, electron-updater
  solo para avisar de que hay versión nueva)
- **Estilos:** CSS plano (`src/App.css` + `src/index.css`), sin framework
- **Datos:** Supabase (Postgres + Storage) con RLS; `localStorage` para cachés locales
- **Audio:** `ffmpeg-static` para convertir y reparar cabeceras
- **IA:** capa de proveedores propia — la app **no depende de ningún proveedor
  concreto** (ver abajo)

## Dónde vive cada cosa

| Archivo | Qué hace |
|---|---|
| `electron/main.cjs` | Proceso principal: IPC, grabación, ffmpeg, transcripción, resumen, updater |
| `electron/providers.cjs` | Catálogo de proveedores de IA y los "dialectos" de sus APIs |
| `electron/preload.cjs` | La única superficie que el navegador ve del sistema (`window.desktopApp`) |
| `src/App.tsx` | Toda la interfaz y el estado de la aplicación |
| `src/lib/supabase.ts` | Cliente y tipos de las tablas |
| `src/lib/sharing.ts` | Carpetas compartidas con otro usuario |
| `supabase-*.sql` | Esquema y migraciones, a ejecutar en el SQL Editor de Supabase |

## La capa de proveedores de IA

`electron/providers.cjs` es la pieza central. La app no conoce a Groq ni a nadie:
conoce **dos contratos** (`transcribe` y `chat`) y unos cuantos **dialectos** de API.
La mayoría del mercado habla el dialecto de OpenAI, así que añadir un proveedor nuevo
suele ser una fila en una tabla. El usuario siempre puede elegir `custom` y escribir su
propia URL.

Las **claves de IA nunca salen del equipo**: viven en el `config.json` local de la
instalación, nunca en la nube. Esto es deliberado, no lo cambies.

Los proveedores marcados con `unverified: true` tienen el adaptador escrito pero nadie
lo ha ejecutado contra la API real. La interfaz los marca como "sin probar".

## Comandos

```bash
npm run desktop:dev     # desarrollo con recarga en caliente
npm run build           # tsc + vite → dist/  (electron-builder NO compila, solo empaqueta)
npm run package:win     # build + instalador NSIS en release/
npm run lint
```

⚠️ **Trampa clásica:** `electron-builder` empaqueta lo que haya en `dist/`. Si lo lanzas
sin `npm run build` delante, reconstruyes el `.exe` con el código viejo.

## Diseño

El diseño se define primero en Figma y luego se implementa aquí. Los identificadores del
archivo, los node IDs de cada pantalla y cómo conectar el MCP están en
`.claude/figma-privado.md`, que **no va al repositorio** (es un archivo de cliente).

### Colores de marca
- Azul principal: `#2563EB`
- Azul claro (fondos): `#EFF6FF`
- Borde azul: `#BFDBFE`

## Convenciones

- **Los comentarios explican el porqué, no el qué.** Por qué se reempaqueta el vídeo con
  ffmpeg, por qué el límite es 8.000 tokens y no 12.000. Mantén esa costumbre.
- **Mensajes de commit en español, en minúscula, con prefijo** (`feat:`, `fix:`,
  `docs:`, `chore:`) y **sin acentos**.
- **Nunca escribas credenciales** en archivos versionados — ni dentro de reglas de
  permiso de `.claude/`, que fue justo como se filtró un token en agosto de 2026.
