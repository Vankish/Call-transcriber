# Estado de lanzamiento — Call Transcriber

> Documento de contexto para retomar el trabajo desde cualquier dispositivo.
> Última actualización: 2026-06-10.

## Resumen

La app está **técnicamente lista para lanzar**. En la sesión del 2026-06-10 se cerraron los
4 bloqueadores de pre-lanzamiento. Ahora mismo se está **validando el auto-update entre dos
dispositivos**.

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

1. **Decidir**: ¿desactivar verificación de firma para terminar el test? (útil para desarrollo,
   no apto para producción). Se haría en `electron/main.cjs` con `autoUpdater.allowPrerelease` /
   desactivando `verifyUpdateCodeSignature`. O bien ir directo al certificado.
2. **Certificado OV/EV** (~200-400€/año): quita SmartScreen Y permite que electron-updater
   aplique updates. Es la solución definitiva.
3. **Groq API key en Supabase**: pendiente de reimplementar — se eliminó por seguridad pero
   tiene sentido vincularla a la cuenta del usuario (protegida por RLS) para que no haya que
   reintroducirla en cada dispositivo. Requiere: migración SQL (añadir columna `groq_api_key`
   a `profiles`) + actualizar `src/App.tsx` (Ajustes) para leer/escribir desde Supabase.

### Cómo publicar futuras versiones (desde un equipo de desarrollo)

Requisitos de build: Windows x64, **Modo de desarrollador activado** (para los symlinks de
winCodeSign), `npm install`. Subir `version` en package.json, luego:

```powershell
# PAT clásico (scope repo) guardado en gh_token.txt en la raíz (gitignored / borrar tras usar)
$env:GH_TOKEN = (Get-Content .\gh_token.txt -Raw).Trim()
npm run release:win
Remove-Item .\gh_token.txt -Force
# Luego en github.com/Vankish/Call-transcriber/releases: editar el borrador y "Publish release".
```

## Pendiente (acciones externas) ⏳

- **Certificado de firma** (OV ~200-400€/año, o EV): quita el aviso de SmartScreen "editor desconocido".
- **Legal**: rellenar huecos `[ ]` de `legal/*.md` + revisión de abogado. Decidir **región de Supabase**
  (recomendado UE) y verificar retención/transferencia de Groq (EE.UU.).
- **`build/` está en `.gitignore`** → un clon limpio no tiene `build/icon.ico` y el build fallaría.
  Si se va a buildear desde otro equipo, hay que versionar `build/` o regenerar el icono. **Importante
  para el test entre dispositivos si el segundo equipo va a compilar.**

## Archivos clave

- `docs/RELEASE_Y_FIRMA.md` — guía completa de release + firma.
- `supabase-migration-launch.sql` — migración (ya ejecutada).
- `legal/` — documentos RGPD (borradores).
- `electron/main.cjs` — IPC + autoUpdater. `src/App.tsx` — UI (banner update, badge versión, consentimiento).
