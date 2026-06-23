# Reinstalación limpia en el otro PC (modo desarrollo)

> Objetivo: borrar cualquier rastro corrupto de Call Transcriber en el otro PC y
> dejar **una sola** copia limpia del proyecto corriendo en modo desarrollo.
> Los **datos** (candidatos, proyectos, transcripciones) viven en **Supabase** y
> se recuperan solos al iniciar sesión — NO se pierden al borrar la carpeta local.
> Los **audios** son solo locales; en este caso David confirmó que no hay audios
> que rescatar en el otro PC.

## 0. Antes de empezar — la migración SQL (UNA sola vez, ya hecha)
La base de datos es compartida por los dos PCs. La migración solo se ejecuta una
vez desde cualquier equipo (Supabase → SQL Editor). Si ya se ejecutó, **saltar
este paso**. SQL en `supabase-migration-launch.sql`.

## 1. Limpieza total en el otro PC
1. **Desinstalar** cualquier "Call Transcriber" instalado: Configuración de
   Windows → Aplicaciones → buscar "Call Transcriber" → Desinstalar.
2. **Borrar** la carpeta de desarrollo vieja del proyecto (donde estuviera el
   clon anterior).
3. **Borrar la config local** (claves/estado de la versión vieja):
   `%APPDATA%\call-transcriber` y `%APPDATA%\Call Transcriber` si existen.
   (Pegar esas rutas en el explorador de archivos y eliminar las carpetas.)

## 2. Clonar el repo limpio
```bash
git clone https://github.com/Vankish/Call-transcriber.git call-transcriber-app
cd call-transcriber-app
npm install
```

## 3. Recrear el archivo `.env` (NO viaja por git, por seguridad)
Crear un archivo llamado `.env` en la raíz del proyecto con este contenido
(claves publicables de Supabase, protegidas por RLS — seguras de exponer):
```
VITE_SUPABASE_URL=https://jqbtrduafmmdnyayewvc.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_XXJT2-Isuef3XNSoFJdeuw_EiqzQB2_
```

## 4. Arrancar la app
```bash
npm run dev        # desarrollo (recarga en caliente)
```
o, para probar como app real:
```bash
npm run package:win   # genera el instalador en release/
```

## 5. Configurar dentro de la app
1. **Iniciar sesión** con la misma cuenta → al cargar, los candidatos/proyectos
   se descargan de Supabase. (La primera vez, la app también sube a la nube
   cualquier dato local que hubiera quedado sin sesión.)
2. **Ajustes → Groq API key**: pegar la key (se guarda solo en el config.json
   local, nunca en la nube).

## Notas
- Código → se sincroniza con `git pull` / `git push`.
- Datos → se sincronizan solos vía Supabase al iniciar sesión.
- No tener a la vez la app instalada (.exe) **y** una copia de desarrollo: elegir
  UNA. Eso era lo que provocaba varias ventanas y el choque del puerto 3000.
