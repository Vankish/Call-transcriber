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

## En curso 🔄 — Test de auto-update entre dispositivos

Objetivo: confirmar que una app instalada se actualiza sola desde GitHub Releases.

Estado: **v1.0.0 y v1.0.1 AMBAS publicadas** en GitHub Releases (v1.0.1 = latest). La v1.0.1
añade un badge de versión visible (`vX.Y.Z`, clase `gtb-version`) junto al título; la v1.0.0 no
lo tiene, así que ver "v1.0.1" tras actualizar = prueba de que el update funcionó.

### Falta SOLO: ejecutar la prueba en el dispositivo "cliente"

En el otro equipo (NO requiere git ni código, solo navegador):

1. Abrir https://github.com/Vankish/Call-transcriber/releases
2. En la release **v1.0.0** → Assets → descargar `Call-Transcriber-Setup-1.0.0.exe` (la VIEJA, a propósito).
3. Instalar (SmartScreen → "Más información" → "Ejecutar de todas formas") y abrir la app.
4. A los ~4 s aparece el banner azul "Reiniciar e instalar" (detecta la 1.0.1). Pulsarlo →
   la app se reinicia y muestra **`v1.0.1`** en la barra superior. ✅ Test superado.

Si el test pasa, el auto-update queda 100% validado. Siguiente trabajo real: certificado de firma y legal.

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
