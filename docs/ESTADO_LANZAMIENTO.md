# Estado de lanzamiento — Call Transcriber

> Documento de contexto para retomar el trabajo desde cualquier dispositivo.
> Última actualización: 2026-07-29.

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
   (v1.0.3). Instalación manual, auto-update sigue sin aplicarse. Se descartó de momento
   desactivar `verifyUpdateCodeSignature` (apaño de desarrollo, no de producción).
2. **Certificado OV/EV** (~200-400€/año): quita SmartScreen Y permite que electron-updater
   aplique updates. Es la solución definitiva y sigue pendiente.
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
(**PC-Usuari**): re-transcribir la reunión con Tessa Aparicio del 30/07 y comprobar que la
voz del entrevistador sale completa. Los `.mp3` / `_system.webm` **no sincronizan** — solo
viajan los metadatos y el texto, así que en el otro PC la entrevista aparece en la lista
pero sin audio con el que trabajar.

Cómo saber si fue por el camino nuevo: en `%APPDATA%\call-transcriber-app\logs` debe aparecer
`separación por hablantes del proveedor` con el % de coincidencia de cada hablante. Si dice
`palabras + audio medido`, cayó al método anterior y hay que mirar por qué.

Instalador ya compilado y firmado: `release\Call Transcriber Setup 1.0.3.exe` (30/07 16:06).
La versión no se subió a propósito — es empaquetado local, no release. Si se publica, subir a
1.0.4 en el mismo commit.

## Pendiente (acciones externas) ⏳

- **Certificado de firma** (OV ~200-400€/año, o EV): quita el aviso de SmartScreen "editor desconocido".
- **Legal**: rellenar huecos `[ ]` de `legal/*.md` + revisión de abogado. Decidir **región de Supabase**
  (recomendado UE) y verificar retención/transferencia de Groq (EE.UU.).
- ~~**`build/` está en `.gitignore`**~~ → **ya resuelto** (verificado 2026-07-29): `build/icon.ico`
  está versionado en git y `build/` no está ignorado. Un clon limpio compila.

## Archivos clave

- `docs/RELEASE_Y_FIRMA.md` — guía completa de release + firma.
- `supabase-migration-launch.sql` — migración (ya ejecutada).
- `legal/` — documentos RGPD (borradores).
- `electron/main.cjs` — IPC + autoUpdater. `src/App.tsx` — UI (banner update, badge versión, consentimiento).
