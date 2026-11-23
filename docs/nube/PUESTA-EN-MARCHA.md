# Puesta en marcha de la nube

Esta guía es para dejar la nube funcionando de verdad, con cuentas tuyas. Está pensada para
hacerla sin saber programar: cada paso dice dónde pulsar y qué copiar. Calcula una tarde.

Vas a crear cuatro cosas y a conectarlas entre sí:

1. **Convex**: la base de datos y las cuentas de la gente (en Europa).
2. **Cloudflare R2**: donde se guardan el audio y el vídeo (en Europa).
3. **Google**: para que la gente pueda entrar con su cuenta de Google.
4. **La web** para coaches y clientes, publicada en Cloudflare Pages.

Al final compilas la app de escritorio apuntando a tu Convex.

> **Regla de oro.** Las claves y contraseñas que vas a ir sacando (de Google, de R2, las de
> Convex Auth) **solo se pegan en los paneles de Convex o Cloudflare**. Nunca en un archivo
> del proyecto, ni en un correo, ni en un chat. Si alguna se escapa, se borra y se crea otra.

Ten a mano un documento privado (fuera del proyecto) donde ir apuntando lo que **no** es
secreto: direcciones y nombres. Te harán falta varias veces:

- La dirección de tu Convex (acaba en `.convex.cloud`)
- La dirección "site" de tu Convex (acaba en `.convex.site`)
- La dirección de tu web (por ejemplo `https://llamadas.tuempresa.com`)
- El nombre del bucket de R2 y el Account ID de Cloudflare

---

## Antes de empezar

Necesitas, en el PC donde está el proyecto:

- **Node.js** instalado (si `npm run build` ya te funciona, lo tienes).
- Una terminal abierta **en la carpeta del proyecto** (en VS Code: Terminal → New Terminal).
- Haber ejecutado una vez `npm ci` para tener las dependencias.

---

## 1. Convex (base de datos y cuentas)

### 1.1 Crear la cuenta y el proyecto

1. Entra en <https://dashboard.convex.dev> y crea una cuenta (con GitHub o con correo).
2. Pulsa **Create Project**. Nombre: por ejemplo `call-transcriber`.
3. Te preguntará la **región**. Elige **Europa: Ireland (aws-eu-west-1)**.
   Es importante: los textos legales dicen que los datos están en la UE. Si no ves la
   opción de región, para aquí y pregunta antes de seguir: un proyecto creado en EE. UU.
   no se puede mover luego, hay que crear otro.
4. Cuando lo tengas creado, en el proyecto ve a **Production** (arriba, al lado de
   "Development"). Todo lo que sigue es sobre el despliegue de **producción**.

### 1.2 Subir el código del servidor

En la terminal, dentro de la carpeta del proyecto:

```
npx convex login
```

Se abre el navegador: acepta. Después:

```
npx convex deploy
```

La primera vez te pregunta a qué proyecto subirlo: elige el que acabas de crear. Al
terminar dice algo como `Deployed Convex functions to https://algo-algo-123.eu-west-1.convex.cloud`.

**Apunta esa dirección** (`.convex.cloud`): es tu `VITE_CONVEX_URL`. En el panel de Convex,
en **Settings → URL & Deploy Key**, verás también la dirección que acaba en `.convex.site`:
**apúntala** también, la necesitas para Google.

> Si alguna vez cambia el código de `convex/`, se repite `npx convex deploy`.

### 1.3 Las claves de las sesiones

Convex Auth firma las sesiones con un par de claves propio. En la terminal:

```
node scripts/generar-claves-auth.mjs
```

Te enseña dos valores larguísimos, `JWT_PRIVATE_KEY` y `JWKS`. No los guardes en ningún
sitio: los pegas directamente en el paso siguiente.

### 1.4 Las variables de Convex

En el panel de Convex, despliegue **Production → Settings → Environment Variables**, añade
una por una (botón **Add**). El nombre exacto a la izquierda y el valor a la derecha:

| Variable | Qué poner |
|---|---|
| `JWT_PRIVATE_KEY` | El primer valor del paso 1.3, entero. |
| `JWKS` | El segundo valor del paso 1.3, entero. |
| `SITE_URL` | La dirección de tu web, sin barra al final. Ej.: `https://llamadas.tuempresa.com`. Si aún no la tienes, pon la de Cloudflare Pages del paso 4 y cámbiala luego. |
| `WEB_URL` | La misma dirección que `SITE_URL`. Con ella se montan los enlaces para clientes (`…/l/…`). |
| `AUTH_GOOGLE_ID` | Del paso 3. |
| `AUTH_GOOGLE_SECRET` | Del paso 3. |
| `R2_BUCKET` | Del paso 2. |
| `R2_ENDPOINT` | Del paso 2. |
| `R2_ACCESS_KEY_ID` | Del paso 2. |
| `R2_SECRET_ACCESS_KEY` | Del paso 2. |

Puedes ir rellenando según avances: las de Google y R2 las tendrás después.

---

## 2. Cloudflare R2 (audio y vídeo)

### 2.1 Crear el bucket en Europa

1. Entra en <https://dash.cloudflare.com> (crea cuenta si no tienes). En el menú de la
   izquierda, **R2 Object Storage**. La primera vez pide activar R2 y una tarjeta: el plan
   gratuito cubre 10 GB al mes; a partir de ahí se paga poco por GB.
2. Pulsa **Create bucket**.
   - **Bucket name**: por ejemplo `call-transcriber-grabaciones`. **Apúntalo**: es `R2_BUCKET`.
   - **Location**: elige **Specify jurisdiction** → **European Union (EU)**. Es lo que
     garantiza que los archivos no salen de la UE, y no se puede cambiar después.
   - Pulsa **Create bucket**.
3. En la página principal de R2 verás tu **Account ID** (a la derecha). **Apúntalo.**

Tu `R2_ENDPOINT` es esto, cambiando `TU_ACCOUNT_ID`:

```
https://TU_ACCOUNT_ID.eu.r2.cloudflarestorage.com
```

Fíjate en el `.eu.`: los buckets con jurisdicción UE usan esa dirección. Sin él, nada
funciona.

### 2.2 La llave de acceso

1. En R2, **Manage R2 API Tokens** (o "API" → "Manage API tokens") → **Create API token**.
2. Nombre: `convex-call-transcriber`.
3. **Permissions**: **Object Read & Write**.
4. **Specify bucket(s)**: solo el bucket que acabas de crear.
5. **Create API Token**. Te enseña **Access Key ID** y **Secret Access Key** **una sola
   vez**. Pégalos directamente en Convex como `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`
   (paso 1.4). Si cierras la página sin copiarlos, borra el token y crea otro.

### 2.3 CORS (para que la web pueda reproducir el vídeo)

1. Abre tu bucket → pestaña **Settings** → **CORS Policy** → **Add CORS policy** (o Edit).
2. Pega esto, cambiando la dirección por la de tu web (puedes poner varias, separadas por
   comas, por ejemplo la de Pages y la de tu dominio):

```json
[
  {
    "AllowedOrigins": ["https://llamadas.tuempresa.com"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

3. Guarda.

Por qué así: `GET` y `HEAD` son para ver el vídeo desde la web. `PUT` y `ETag` son para
subir por partes: cada parte que llega a R2 devuelve un `ETag` y la subida lo necesita
para cerrar el archivo. Si falta `ETag` en `ExposeHeaders`, la app avisa con
"R2 no devolvió ETag (¿falta exponerlo en CORS?)".

---

## 3. Entrar con Google

1. Entra en <https://console.cloud.google.com> con la cuenta de Google de la empresa.
2. Arriba, selector de proyecto → **New Project** → nombre `Call Transcriber` → Create.
3. Menú → **APIs & Services → OAuth consent screen** (en algunas cuentas se llama
   "Google Auth Platform → Branding"):
   - Tipo de usuario: **External**.
   - Nombre de la app: `Call Transcriber`. Correo de soporte: el tuyo.
   - Dominio autorizado: el de tu web (por ejemplo `tuempresa.com`).
   - Guarda. Mientras esté en modo "Testing" solo pueden entrar los correos que añadas como
     "Test users"; cuando quieras abrirlo a todos, pulsa **Publish app**. Para entrar solo
     con nombre y correo, normalmente Google no pide revisión.
4. Menú → **APIs & Services → Credentials** → **Create credentials → OAuth client ID**:
   - Application type: **Web application**. Nombre: `Convex`.
   - **Authorized JavaScript origins**: la dirección de tu web.
   - **Authorized redirect URIs**: tu dirección `.convex.site` del paso 1.2 seguida de
     `/api/auth/callback/google`. Ejemplo:
     `https://algo-algo-123.eu-west-1.convex.site/api/auth/callback/google`
   - Create.
5. Te enseña **Client ID** y **Client secret**. Pégalos en Convex como `AUTH_GOOGLE_ID` y
   `AUTH_GOOGLE_SECRET` (paso 1.4).

La app de escritorio **no necesita nada más en Google**: abre Google en tu navegador y, al
terminar, Convex la devuelve a `http://localhost:3000/convex-auth`, una dirección que el
servidor ya tiene permitida. Lo único: el **puerto 3000** del PC tiene que estar libre al
entrar con Google desde la app (si tienes otro programa usándolo, ciérralo un momento).

---

## 4. Publicar la web (Cloudflare Pages)

La web es una página estática: se compila en el PC y se sube tal cual.

### 4.1 Compilarla

En la terminal, cambiando la dirección por **tu** `.convex.cloud` del paso 1.2:

PowerShell:

```
$env:VITE_CONVEX_URL="https://algo-algo-123.eu-west-1.convex.cloud"; npm run web:build
```

Sale una carpeta `dist-web` con la web lista.

> **Ojo con la dirección.** Si alguna vez has hecho pruebas con un Convex local, en la
> carpeta del proyecto habrá un `.env.local` con `VITE_CONVEX_URL=http://127.0.0.1:3210`.
> Poner la variable como arriba, en la misma línea, manda sobre ese archivo. Compruébalo
> siempre: abre `dist-web/assets/` y busca tu dirección `.convex.cloud` en el `.js`
> grande, o simplemente prueba la web después de publicarla.

### 4.2 Subirla

1. En Cloudflare: **Workers & Pages → Create → Pages → Upload assets** (subida directa).
2. Nombre del proyecto: por ejemplo `call-transcriber-web`. Te dará una dirección
   `https://call-transcriber-web.pages.dev`.
3. Arrastra **el contenido** de la carpeta `dist-web` (lo de dentro: `index.html`,
   `assets`, `icono.svg`) y pulsa **Deploy**.

Cada vez que cambie la web: compilar otra vez (4.1) y, en el proyecto de Pages, **Create
new deployment** con el nuevo contenido de `dist-web`.

**Las rutas `/i/…`, `/l/…` y `/personas`** funcionan solas: como la web no trae ningún
`404.html`, Cloudflare Pages entiende que es una web de una sola página y devuelve
`index.html` para cualquier dirección. No hace falta añadir nada; lo único, no metas un
`404.html` en la carpeta. Compruébalo abriendo una dirección como `…/personas` directamente:
si sale la web (y no un error 404 de Cloudflare), está bien.

### 4.3 Tu dominio (opcional)

En el proyecto de Pages → **Custom domains** → **Set up a custom domain** → por ejemplo
`llamadas.tuempresa.com`, y sigue los pasos. Cuando funcione:

- En Convex, cambia `SITE_URL` y `WEB_URL` a esa dirección.
- En Google (paso 3.4), añádela en "Authorized JavaScript origins".
- En R2 (paso 2.3), añádela a `AllowedOrigins`.

---

## 5. Compilar la app de escritorio con la nube

Igual que la web, la app necesita saber la dirección de tu Convex al compilarse. Solo la
dirección pública: ninguna clave va dentro del instalador.

PowerShell, en la carpeta del proyecto:

```
$env:VITE_CONVEX_URL="https://algo-algo-123.eu-west-1.convex.cloud"; npm run package:win
```

El instalador sale en `release/`. `npm run build` guarda la dirección en
`dist/cloud-config.json`, que es lo que lee la app instalada: si ese archivo tiene
`127.0.0.1`, has compilado con la dirección de pruebas (ver el aviso del paso 4.1).

Sin `VITE_CONVEX_URL`, la app se compila como siempre y la pestaña **Configuración → Nube**
no aparece.

---

## 6. Comprobar que todo funciona

Con la app instalada y la web publicada:

1. App → **Configuración → Nube** → crea una cuenta con correo y contraseña (mínimo 8
   caracteres). Debe decir que has entrado.
2. Sincroniza. Abre la web, entra con la misma cuenta: deberías ver tus llamadas.
3. Prueba **Entrar con Google** en la app y en la web.
4. En la web, **Personas**: invita a otro correo tuyo como coach a un proyecto, entra con
   él en una ventana de incógnito y comprueba que solo ve ese proyecto.
5. Sube una grabación con vídeo y ábrela en la web: tiene que reproducirse. Si no:
   - "Falta configurar el almacenamiento en la nube": falta alguna de las cuatro variables
     `R2_…` en Convex. Ponla y pulsa **Reintentar** en Configuración → Nube (esos archivos
     no se reintentan solos).
   - "No se pudo empezar la subida": las variables están, pero R2 no acepta la conexión.
     Revisa sobre todo el `.eu.` del endpoint y que el token sea del bucket bueno.
   - El vídeo no carga en la web pero la subida terminó: revisa el CORS (paso 2.3).
6. En una llamada, **Compartir con el cliente**: crea un enlace y ábrelo en incógnito.

## 7. Lo que falta rellenar fuera de aquí

- En `legal/`, los textos tienen huecos entre corchetes (región de Convex, ubicación de R2,
  plazo de retención…). Con lo de esta guía: Convex en **UE, aws-eu-west-1 (Irlanda)** y R2
  en **UE, bucket con jurisdicción `eu`**.
- Los textos legales los tiene que revisar alguien con conocimientos de protección de datos
  antes de usarlos con candidatos reales.
