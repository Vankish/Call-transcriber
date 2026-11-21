# Política de Retención y Supresión de Datos — Call Transcriber

> **BORRADOR — requiere revisión por un abogado antes de su uso en producción.**

Esta política define los plazos de conservación y los procedimientos de supresión de los datos personales tratados a través de la aplicación **Call Transcriber**, conforme al principio de **limitación del plazo de conservación** (art. 5.1.e RGPD).

---

## 1. Principios generales

- Los datos se conservan **solo el tiempo necesario** para las finalidades para las que fueron recabados.
- Transcurridos los plazos, los datos se **suprimen o anonimizan** de forma segura.
- La supresión abarca **todas las ubicaciones**: almacenamiento local (`Documentos/CallTranscriber`), la base de datos en la nube (**Convex**) y el almacenamiento de archivos en la nube (**Cloudflare R2**).
- La supresión en la nube incluye los **archivos de audio y vídeo** de Cloudflare R2, no solo los registros de la base de datos, y anula los **enlaces compartidos** y los **comentarios** de coaches asociados.
- Los datos enviados al **proveedor de IA** configurado (transcripción y resumen) se rigen, además, por la política de retención de ese proveedor, que el Responsable debe verificar y documentar. Cambiar de proveedor en la aplicación cambia a quién se le envía el audio y el texto: hay que revisar este punto cada vez.

---

## 2. Conservación sin plazo fijo: cómo se justifica

La aplicación permite conservar grabaciones y textos **sin fecha de caducidad**. El RGPD no prohíbe que no haya un número de meses, pero sí exige que los datos no se guarden **más tiempo del necesario** para su finalidad y que el plazo, o **los criterios para determinarlo**, se informen al interesado (arts. 5.1.e y 13.2.a RGPD). Un "para siempre" sin más no cumple: hay que decir de qué depende y revisarlo.

Si el Responsable opta por la conservación sin plazo fijo, debe redactarla así y cumplirla:

> Las grabaciones de audio y vídeo, las transcripciones, los resúmenes y los comentarios se conservan **mientras sigan siendo necesarios para la finalidad** por la que se recabaron —la gestión del proceso de selección, su revisión por los coaches y, si el candidato lo consiente, su consideración en futuros procesos— y **mientras la cuenta del Responsable esté activa**. El Responsable **revisa al menos [cada 12 meses]** los datos conservados y suprime los que ya no cumplan esa finalidad. En todo caso, se suprimen **cuando el interesado lo solicite o retire su consentimiento**, y al cerrar la cuenta.

> ⚠️ **Riesgo.** Es la fórmula más débil que se puede defender. Cuanto más tiempo pase desde el proceso, más difícil es justificar que sigue haciendo falta la **voz y la imagen** del candidato, y la AEPD puede considerarla excesiva si no hay revisiones documentadas. Si la revisión periódica no se hace, la política deja de ser defendible.

---

## 3. Plazos de conservación propuestos por categoría

> Los plazos son **orientativos** y deben ajustarse a la normativa aplicable y a la decisión del Responsable.

| Categoría de dato | Plazo propuesto | Criterio |
|---|---|---|
| **Grabaciones de audio y vídeo** (entrevista) | **[p. ej. 3-6 meses desde la entrevista, o "mientras sea necesario" con revisión periódica (apartado 2)]** | Mayor sensibilidad (voz e imagen); conservar solo lo imprescindible. Puede suprimirse antes una vez generada la transcripción/resumen. |
| **Transcripciones** | **[p. ej. 12 meses, o hasta fin del proceso, o criterio del apartado 2]** | Necesarias para la evaluación. |
| **Resúmenes / informes de evaluación** | Mientras dure el proceso + **[p. ej. 12 meses, o criterio del apartado 2]** | Justificación de la decisión de selección. |
| **Comentarios de coaches** | Igual que la entrevista a la que pertenecen | Se borran con ella. |
| **Enlaces compartidos con la empresa cliente** | **7 días** desde su creación o última renovación | Caducan solos; el propietario puede anularlos antes. |
| **Datos de candidatos NO seleccionados** | **[p. ej. 12 meses]** desde el fin del proceso | Posibles reclamaciones; tras el plazo, supresión salvo consentimiento para futuros procesos. |
| **Datos de candidatos seleccionados / contratados** | Durante la relación laboral + plazos legales (laborales, fiscales) | Obligaciones legales del empleador. |
| **Datos de los usuarios** (reclutadores y coaches) | Mientras la cuenta esté activa | Prestación del servicio; supresión al cerrar la cuenta. Al retirar el acceso a un coach, deja de ver los proyectos. |
| **Datos conservados con consentimiento para futuros procesos** | **[p. ej. 12-24 meses]** o hasta retirada del consentimiento | Consentimiento específico del candidato. |

> El **Estatuto de los Trabajadores** y la normativa española habitualmente manejan plazos de prescripción de hasta **un año** para acciones derivadas del contrato de trabajo y de hasta **cuatro años** en materia administrativa/fiscal: el Responsable debe verificar los plazos legales concretos aplicables a su caso.

---

## 4. Criterios para fijar los plazos

- **Finalidad cumplida:** una vez tomada y documentada la decisión de selección, decae la necesidad de conservar gran parte de los datos.
- **Minimización del dato más sensible:** las grabaciones de audio (voz) y de vídeo (imagen) deben conservarse el menor tiempo posible.
- **Obligaciones legales:** los candidatos contratados generan obligaciones de conservación adicionales.
- **Consentimiento del interesado:** la conservación para futuros procesos requiere consentimiento específico y revocable.
- **Defensa frente a reclamaciones:** se puede conservar lo imprescindible durante los plazos de prescripción aplicables.

---

## 5. Procedimiento de supresión

> ⚠️ **Ningún dato caduca solo, salvo los enlaces compartidos.** Al borrar la entrevista, el candidato o el proyecto se borran sus datos y sus archivos, pero los plazos de esta política se ejecutan a mano. Antes de publicar plazos (o la fórmula del apartado 2), hay que fijar quién los revisa y cada cuánto — una política de retención que nadie ejecuta deja por escrito que se prometió borrar y no se borró. [PENDIENTE: confirmar con la implementación que borrar una entrevista elimina también sus archivos de R2, sus comentarios y sus enlaces.]

### 5.1. Supresión en el equipo local (`Documentos/CallTranscriber`)
1. Identificar los archivos de audio y vídeo asociados al candidato/proceso cuyo plazo ha vencido.
2. **Eliminar de forma segura** los archivos de la carpeta `Documentos/CallTranscriber`.
3. Vaciar la papelera de reciclaje del sistema operativo.
4. Tener en cuenta posibles **copias de seguridad** locales del equipo (deben incluirse en el borrado o caducar con su propio ciclo).

### 5.2. Supresión en la nube (Convex y Cloudflare R2)
1. Borrar desde la aplicación la entrevista, el candidato o el proyecto: elimina los registros de Convex (ficha, transcripción, resumen, comentarios, enlaces) y los archivos de audio y vídeo de Cloudflare R2.
2. Verificar que la eliminación es **definitiva** y no queda como "borrado lógico" ni en archivos huérfanos del bucket.
3. Considerar las **copias de seguridad** de Convex: confirmar en cuánto tiempo se sobrescriben las que aún contengan el dato. [PENDIENTE: plazo de retención de las copias de Convex.]
4. Los enlaces ya enviados a la empresa cliente dejan de funcionar al borrar la entrevista; lo que la empresa cliente haya descargado queda bajo su responsabilidad.

### 5.3. Datos en el proveedor de IA
- Confirmar con el proveedor que los datos enviados para procesamiento **no se conservan** una vez completada la transcripción/resumen, conforme al contrato de encargo. Documentar dicha política.

### 5.4. Solicitudes de supresión a petición del interesado
Cuando un candidato ejerza su derecho de supresión o retire su consentimiento, el procedimiento anterior se ejecutará **sin dilación indebida** (plazo máximo de **un mes**), salvo obligación legal de conservación, en cuyo caso se informará al interesado.

---

## 6. Registro de supresiones y revisiones (recomendado)

Se recomienda mantener un registro interno de las supresiones realizadas y de las **revisiones periódicas** (fecha, categoría de datos, ubicaciones afectadas, qué se conservó y por qué, responsable de la ejecución) como prueba de cumplimiento del principio de responsabilidad proactiva (*accountability*). Si se conserva sin plazo fijo, este registro es lo que lo hace defendible.

---

**Última actualización:** [FECHA]
**Responsable de la política:** [NOMBRE / CARGO]
