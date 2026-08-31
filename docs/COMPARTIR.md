# Compartir una carpeta con un compañero

> Guía paso a paso. No hace falta saber programar: solo copiar, pegar y hacer clic.

## Qué resuelve esto

Hasta ahora cada persona veía únicamente sus propias carpetas (proyectos). Si dos personas
entrevistaban para el mismo puesto, no había forma de que una viera el trabajo de la otra:
había que pasarse los textos por correo a mano.

Con esto, el dueño de una carpeta puede **dar acceso a un compañero por su correo**. El
compañero abre su propia app, con su propia cuenta, y ve esa carpeta con una etiqueta
**"Compartido por [tu nombre]"**. Puede leer las transcripciones y los resúmenes, escuchar los
audios que estén subidos, transcribir, generar resúmenes y añadir candidatos. Lo que **no**
puede es borrar la carpeta ni repartir accesos: eso se queda solo en manos del dueño.

Hay que hacerlo **en este orden**. Los pasos 1 y 2 son la causa del 90 % de los "no me
funciona".

---

## Paso 1 — Ejecutar el SQL (una sola vez, y solo lo hace el dueño de la base de datos)

Esto le enseña a la base de datos qué es una carpeta compartida. Hasta que no se haga, el
buscador de la app **no encontrará a nadie**, por muy bien escrito que esté el correo.

1. Abre el navegador y entra en **https://supabase.com**.
2. Pulsa **Sign in** e inicia sesión con tu cuenta.
3. En el listado de proyectos, haz clic en **tu proyecto de Call Transcriber**
   (el que empieza por `jqbtrduafmmdnyayewvc`).
4. En la barra lateral izquierda, haz clic en **SQL Editor** (el icono con el símbolo
   `>_`).
5. Arriba a la izquierda del editor, pulsa el botón **+ New query**.
6. Ahora abre el archivo del proyecto **`supabase-migration-compartir.sql`**. Está en la
   carpeta raíz de la app:
   `D:\Claude Code proyects\call-transcriber-app\supabase-migration-compartir.sql`.
   Ábrelo con el Bloc de notas (clic derecho → *Abrir con* → *Bloc de notas*).
7. Selecciona **TODO** el contenido del archivo: pulsa dentro del texto y luego
   **Ctrl + A**. Cópialo con **Ctrl + C**.
   ⚠️ Todo el archivo, de la primera línea a la última. No sirve copiar solo un trozo.
8. Vuelve a la ventana de Supabase, haz clic dentro del recuadro negro del editor y pega con
   **Ctrl + V**.
9. Pulsa el botón verde **Run** (abajo a la derecha del editor, o con **Ctrl + Enter**).

**Qué debería salir:** un mensaje verde abajo que dice **`Success. No rows returned`**.
Eso es correcto: significa "hecho, y no había nada que mostrar". No es un error.

**Se puede ejecutar varias veces sin romper nada.** El archivo está escrito para eso: si lo
ejecutas dos o tres veces por si acaso, no duplica ni borra nada. Si algún día dudas de si lo
llegaste a ejecutar, vuelve a ejecutarlo y listo.

**Si sale algo en rojo:** copia el texto rojo entero y guárdalo. Casi siempre es que se pegó
solo media parte del archivo (vuelve al punto 7) o que estás en el proyecto de Supabase
equivocado (vuelve al punto 3).

---

## Paso 2 — Que tu compañero tenga cuenta

**Esta es la causa número 1 de "no me lo encuentra".** La app solo puede compartir con
personas que ya existen en Call Transcriber. No manda invitaciones por correo.

1. Pásale a tu compañero el instalador de la app (el `.exe`) y que lo instale.
   - Windows le avisará de "editor desconocido". Es normal, la app no está firmada:
     **Más información** → **Ejecutar de todas formas**.
2. Que abra la app y pulse **Crear cuenta / Registrarse**.
3. Que se registre **con el correo exacto** que tú vas a escribir después en el buscador.
   Si él se registra con `ana@empresa.com` y tú buscas `ana.garcia@empresa.com`, no aparecerá.
4. Que confirme que ha entrado y ve su pantalla de inicio.

Hasta que no termine este paso, su correo **no existe** para el buscador. No hay forma de
adelantarlo.

---

## Paso 3 — Compartir la carpeta

Esto lo haces tú, en tu app, con tu cuenta.

1. Abre Call Transcriber.
2. En la pantalla de inicio, busca la carpeta (proyecto) que quieres compartir.
3. Pulsa **Editar** en esa carpeta (el lápiz / la opción *Editar proyecto*).
4. Baja hasta la caja **"Compartir con"**.
5. Escribe el correo de tu compañero en el recuadro. **Tal cual él lo escribió al
   registrarse**, sin espacios delante ni detrás.
6. Pulsa **Buscar**.
7. Dos cosas pueden pasar:
   - ✅ **Sale su nombre** debajo del recuadro, junto a un botón **Dar acceso**. Púlsalo.
   - ❌ Sale **"No hay ninguna cuenta de Call Transcriber con ese correo"**. Entonces esa
     persona no está registrada (Paso 2) o el correo no es el mismo. No se puede añadir.
8. Una vez dado el acceso, su nombre aparece en la lista de esa caja. Ya está compartida.
9. Guarda los cambios del proyecto.

Puedes repetirlo para varios compañeros en la misma carpeta.

---

## Paso 4 — Qué ve tu compañero

1. Él abre **su** app con **su** cuenta (no la tuya, y no hace falta contraseña compartida).
2. En su pantalla de inicio, además de sus carpetas, aparece la tuya con una etiqueta
   **"Compartido por [tu nombre]"**.
3. Entra en ella y ve los candidatos, las entrevistas, las transcripciones y los resúmenes.

⏱️ **Si acabas de darle acceso y él ya tenía la app abierta, no le aparecerá al momento.**
Que cierre la app del todo y la vuelva a abrir.

---

## Qué puede y qué no puede hacer tu compañero

| ✅ Sí puede | ❌ No puede |
|---|---|
| Ver la carpeta y sus candidatos | Borrar la carpeta (el proyecto) |
| Leer las transcripciones | Compartirla con otras personas |
| Leer los resúmenes de IA | Quitarle el acceso a nadie (ni a sí mismo) |
| Escuchar los audios **que estén subidos a la nube** | Escuchar audios que se quedaron en tu PC |
| Transcribir una grabación (si el audio está subido) | Ver el vídeo de las entrevistas |
| Generar resúmenes de IA | |
| Editar el texto de la transcripción | |
| Añadir candidatos y entrevistas a la carpeta | |

Resumen en una frase: **tu compañero trabaja dentro de la carpeta, pero no manda sobre ella.**
Borrar y repartir accesos es solo del dueño.

---

## Qué viaja y qué no

Compartir la carpeta no mueve archivos. Solo viaja lo que ya estaba en la nube.

| Qué | ¿Lo ve tu compañero? | Por qué |
|---|---|---|
| Transcripción (el texto) | ✅ Sí, siempre | El texto se guarda en la nube desde el principio |
| Resumen de IA | ✅ Sí, siempre | Igual que el texto |
| Notas y candidatos | ✅ Sí, siempre | Son datos, pesan muy poco |
| **Audio** (el `.mp3`) | ⚠️ **Solo si lo has subido** | Hay que pulsar el botón **☁** de cada grabación |
| **Vídeo** | ❌ **Nunca** | Pesa ~300 MB por entrevista; no se sube y no se subirá |

### Los tres límites, en claro

**1. El vídeo no viaja. Nunca.**
El vídeo de una entrevista pesa unos **300 MB**. El plan gratis de Supabase da **1 GB en
total**: con dos entrevistas ya estaría lleno. Por eso el vídeo nunca se ha subido a la nube y
esto no lo cambia. Tu compañero verá la transcripción y el resumen; el vídeo se queda en el PC
que grabó y ahí seguirá.

**2. El audio solo viaja si lo has subido.**
En la lista de grabaciones, cada entrevista lleva un distintivo:
- **`☁ En la nube`** → ya está subida. Tu compañero podrá escucharla y re-transcribirla.
- **`↑ Solo en este PC · Subir`** → **es un botón**. Púlsalo y espera a que cambie a `☁`.

Si no está subida, tu compañero verá la entrevista y su texto en la lista, pero **no podrá
escucharla ni volver a transcribirla**. No es un fallo, es que el archivo sigue en tu disco.

> 🔎 **Consejo práctico: antes de compartir una carpeta, repásala.** Entra en cada
> entrevista, mira el distintivo y pulsa **Subir** en todas las que sigan en local. Cinco
> minutos ahí te ahorran el "oye, no me suena nada" del día siguiente.

**3. Los límites de espacio del plan gratis.**
- **50 MB por archivo.** Un `.mp3` de una hora ronda los **32 MB** → entra sin problema.
  Uno de **dos horas no entra** y la subida dará error.
- **1 GB en total**, unas **15 entrevistas**. Cuando se llene, no se podrá subir más hasta
  borrar entrevistas antiguas o pasar a un plan de pago.

---

## Si algo no funciona

**"No encuentro su correo" / sale "No hay ninguna cuenta de Call Transcriber con ese correo"**
- *Causa más probable:* tu compañero **no se ha registrado todavía**. Instalar la app no basta,
  tiene que crear la cuenta.
  *Solución:* que haga el **Paso 2** y vuelve a buscar.
- *Segunda causa:* el correo no es idéntico al que él usó (una letra, un punto, un `.com` por
  un `.es`, o un espacio invisible al pegarlo).
  *Solución:* pídele que te diga textualmente con qué correo entró y escríbelo a mano.
- *Tercera causa:* **el SQL del Paso 1 no se ha ejecutado**. Sin él la app no sabe buscar
  personas y no encontrará a nadie, ni siquiera a alguien que sí está registrado.
  *Solución:* haz el **Paso 1**. Si dudas de si lo hiciste, ejecútalo otra vez: no rompe nada.

**"Le he dado acceso pero él no ve la carpeta"**
- *Causa:* tenía la app abierta cuando se la compartiste. La lista se carga al arrancar.
  *Solución:* que **cierre la app del todo y la vuelva a abrir**. Si aún así no sale, que
  compruebe que ha entrado con la misma cuenta a la que le diste acceso (arriba a la derecha
  debe salir su correo).

**"Ve la entrevista pero no puede escuchar el audio"**
- *Causa:* ese audio **no estaba subido** cuando compartiste. El archivo sigue solo en tu PC.
  *Solución:* en tu app, entra en esa grabación y pulsa el botón **`↑ Solo en este PC · Subir`**.
  Cuando ponga **`☁ En la nube`**, que él cierre y abra su app.

**"No ve el vídeo"**
- *Causa:* **es así por diseño**, no es un fallo. El vídeo nunca se sube a la nube (300 MB por
  entrevista contra 1 GB de espacio total).
  *Solución:* no hay forma de compartirlo desde la app. Si él necesita ver el vídeo, pásaselo a
  mano (WeTransfer, Drive, un disco duro). Está en `Documentos\CallTranscriber` de tu PC.

**"Error al subir un audio"**
- *Causa:* el archivo pasa de **50 MB**, el máximo del plan gratis. Suele ser una entrevista de
  hora y media o más.
  *Solución:* bajar la calidad del audio en **Ajustes → Grabación** (afecta a las grabaciones
  nuevas, no a las ya hechas), o pasar a un plan de pago de Supabase. Esa entrevista concreta
  seguirá siendo solo local: tu compañero verá su texto, no la escuchará.
- *Otra causa posible:* se ha llenado el **1 GB** total. Borra entrevistas antiguas que ya no
  necesites (al borrarlas se liberan sus audios de la nube).

**"Ha borrado algo y no debería haber podido"**
- Tu compañero **no puede borrar la carpeta**, pero sí trabaja dentro de ella (añadir
  candidatos, editar transcripciones). Si eso es demasiado para alguien, no le des acceso:
  no hay un modo "solo lectura".

---

## Cómo quitarle el acceso

1. Abre Call Transcriber con tu cuenta (la del dueño).
2. Entra en la carpeta y pulsa **Editar** en el proyecto.
3. Baja a la caja **"Compartir con"**.
4. En la lista de personas con acceso, pulsa **Quitar acceso** junto a su nombre.
5. Guarda los cambios.

A partir de ese momento la carpeta desaparece de su app. Si la tenía abierta, desaparecerá
cuando cierre y vuelva a abrir.

⚠️ **Lo que ya vio, lo vio.** Quitar el acceso corta lo que puede ver de ahora en adelante,
pero no deshace lo que copió o anotó por su cuenta mientras lo tenía.

⚠️ **Solo el dueño puede quitar accesos.** Tu compañero no puede quitarse a sí mismo ni quitar
a otros.
