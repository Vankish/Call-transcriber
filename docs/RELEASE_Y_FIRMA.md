# Release y firma de código — Call Transcriber

Guía operativa para publicar nuevas versiones (con auto-actualización) y firmar el ejecutable.

---

## 1. Auto-actualización (electron-updater + GitHub Releases)

La app comprueba automáticamente si hay una versión nueva al arrancar (en producción,
4 s después de abrir) usando **electron-updater** contra los **GitHub Releases** del repo
`Vankish/Call-transcriber`. Si hay actualización, la descarga en segundo plano y muestra un
banner azul "Reiniciar e instalar". También se instala sola al cerrar la app.

### Cómo publicar una versión nueva

1. **Sube el número de versión** en `package.json` (`"version"`). electron-updater compara
   versiones semánticas, así que cada release debe tener una versión mayor que la anterior
   (p. ej. `1.0.0` → `1.0.1`).
2. Crea un **Personal Access Token de GitHub** con permiso `repo` y expórtalo:
   ```powershell
   $env:GH_TOKEN = "ghp_xxxxxxxxxxxxxxxxxxxx"
   ```
3. Ejecuta el script de publicación:
   ```powershell
   npm run release:win
   ```
   Esto compila, genera el instalador NSIS y los metadatos (`latest.yml`), y **sube todo a un
   GitHub Release** (como borrador por defecto).
4. Entra en GitHub → Releases, revisa el borrador y **publícalo**. En cuanto esté publicado,
   las apps instaladas detectarán la actualización en el siguiente arranque.

### Build local sin publicar

Para generar el instalador sin tocar GitHub (pruebas):
```powershell
npm run package:win    # === dist:win; usa --publish never
```
El instalador queda en `release/`.

> Nota: la primera ejecución de electron-builder descarga sus dependencias (winCodeSign,
> nsis, binarios de Electron). Puede tardar varios minutos.

> **Importante (Windows):** electron-builder descarga la herramienta `winCodeSign`, que contiene
> enlaces simbólicos. Si Windows no tiene permiso para crear symlinks, el build falla con
> `Cannot create symbolic link : El cliente no dispone de un privilegio requerido`. Solución
> (una sola vez): activa el **Modo de desarrollador** en *Configuración → Privacidad y seguridad →
> Para programadores → Modo de desarrollador*, **o** ejecuta `npm run package:win` desde una
> terminal **abierta como Administrador**.

---

## 2. Firma de código (code signing)

Sin firma, **Windows SmartScreen** muestra "Editor desconocido" al instalar. Para evitarlo hay
que firmar con un certificado **OV** (~200-400 €/año, aviso desaparece tras ganar reputación) o
**EV** (más caro, reputación inmediata + token hardware).

La configuración ya está **lista** en `package.json` (`build.win.signtoolOptions`). electron-builder
firma automáticamente **si** detecta las variables de entorno del certificado. Sin ellas, el build
sale sin firmar (no falla).

### Cuando tengas el certificado (.pfx / .p12)

Exporta estas variables antes de empaquetar:
```powershell
$env:CSC_LINK = "C:\ruta\al\certificado.pfx"   # o una URL https / base64
$env:CSC_KEY_PASSWORD = "la-contraseña-del-pfx"
```
Y construye normalmente:
```powershell
npm run package:win     # build firmado local
npm run release:win     # build firmado + publicado (requiere también GH_TOKEN)
```

### Certificado EV (token hardware)

Los certificados EV vienen en un token USB y no exportan el `.pfx`. En ese caso se firma con
`signtool` apuntando al almacén de certificados; configúralo en `build.win.signtoolOptions`
(`certificateSubjectName` o `certificateSha1`) en lugar de `CSC_LINK`. Consultar la guía del
proveedor del certificado.

### Para forzar que el build falle si no hay firma

Útil en el pipeline de release definitivo para no publicar sin firmar:
```jsonc
// package.json → build.win
"forceCodeSigning": true
```
(Déjalo en `false`/omitido mientras no haya certificado.)

---

## Checklist de release

- [ ] Subir `version` en `package.json`.
- [ ] (Si hay cert) exportar `CSC_LINK` y `CSC_KEY_PASSWORD`.
- [ ] Exportar `GH_TOKEN`.
- [ ] `npm run release:win`.
- [ ] Publicar el Release (borrador) en GitHub.
- [ ] Probar la actualización desde una versión anterior instalada.
