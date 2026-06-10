# Política de Retención y Supresión de Datos — Call Transcriber

> **BORRADOR — requiere revisión por un abogado antes de su uso en producción.**

Esta política define los plazos de conservación y los procedimientos de supresión de los datos personales tratados a través de la aplicación **Call Transcriber**, conforme al principio de **limitación del plazo de conservación** (art. 5.1.e RGPD).

---

## 1. Principios generales

- Los datos se conservan **solo el tiempo necesario** para las finalidades para las que fueron recabados.
- Transcurridos los plazos, los datos se **suprimen o anonimizan** de forma segura.
- La supresión abarca **todas las ubicaciones**: almacenamiento local (`Documentos/CallTranscriber`) y almacenamiento en la nube (**Supabase**).
- Los datos enviados a **Groq** para su procesamiento se rigen, además, por la política de retención del propio proveedor (a verificar y documentar por el Responsable; en principio no se conservan para fines propios bajo el contrato de encargo).

---

## 2. Plazos de conservación propuestos por categoría

> Los plazos son **orientativos** y deben ajustarse a la normativa aplicable y a la decisión del Responsable.

| Categoría de dato | Plazo propuesto | Criterio |
|---|---|---|
| **Grabaciones de audio** (entrevista) | **[p. ej. 3-6 meses]** desde la entrevista | Mayor sensibilidad (voz); conservar solo lo imprescindible. Puede suprimirse antes una vez generada la transcripción/resumen. |
| **Transcripciones** | **[p. ej. 12 meses]** o hasta fin del proceso | Necesarias para la evaluación; suprimir al cerrar el proceso. |
| **Resúmenes / informes de evaluación** | Mientras dure el proceso + **[p. ej. 12 meses]** | Justificación de la decisión de selección. |
| **Datos de candidatos NO seleccionados** | **[p. ej. 12 meses]** desde el fin del proceso | Posibles reclamaciones; tras el plazo, supresión salvo consentimiento para futuros procesos. |
| **Datos de candidatos seleccionados / contratados** | Durante la relación laboral + plazos legales (laborales, fiscales) | Obligaciones legales del empleador. |
| **Datos del usuario reclutador** (nombre, email, empresa) | Mientras la cuenta esté activa | Prestación del servicio; supresión al cerrar la cuenta. |
| **Datos conservados con consentimiento para futuros procesos** | **[p. ej. 12-24 meses]** o hasta retirada del consentimiento | Consentimiento específico del candidato. |

> El **Estatuto de los Trabajadores** y la normativa española habitualmente manejan plazos de prescripción de hasta **un año** para acciones derivadas del contrato de trabajo y de hasta **cuatro años** en materia administrativa/fiscal: el Responsable debe verificar los plazos legales concretos aplicables a su caso.

---

## 3. Criterios para fijar los plazos

- **Finalidad cumplida:** una vez tomada y documentada la decisión de selección, decae la necesidad de conservar gran parte de los datos.
- **Minimización del dato más sensible:** las grabaciones de audio (voz) deben conservarse el menor tiempo posible.
- **Obligaciones legales:** los candidatos contratados generan obligaciones de conservación adicionales.
- **Consentimiento del interesado:** la conservación para futuros procesos requiere consentimiento específico y revocable.
- **Defensa frente a reclamaciones:** se puede conservar lo imprescindible durante los plazos de prescripción aplicables.

---

## 4. Procedimiento de supresión

### 4.1. Supresión en el equipo local (`Documentos/CallTranscriber`)
1. Identificar los archivos de audio asociados al candidato/proceso cuyo plazo ha vencido.
2. **Eliminar de forma segura** los archivos de la carpeta `Documentos/CallTranscriber`.
3. Vaciar la papelera de reciclaje del sistema operativo.
4. Tener en cuenta posibles **copias de seguridad** locales del equipo (deben incluirse en el borrado o caducar con su propio ciclo).

### 4.2. Supresión en Supabase
1. Eliminar los registros estructurados asociados (proyecto, candidato, transcripción, resumen) en la base de datos.
2. Verificar que la eliminación es **definitiva** y no permanece en tablas de respaldo o "soft delete".
3. Considerar el ciclo de **copias de seguridad** de Supabase: confirmar el plazo en que las copias que aún contengan el dato quedan sobrescritas.

### 4.3. Datos en Groq
- Confirmar con el proveedor que los datos enviados para procesamiento **no se conservan** una vez completada la transcripción/resumen, conforme al contrato de encargo. Documentar dicha política.

### 4.4. Solicitudes de supresión a petición del interesado
Cuando un candidato ejerza su derecho de supresión o retire su consentimiento, el procedimiento anterior se ejecutará **sin dilación indebida** (plazo máximo de **un mes**), salvo obligación legal de conservación, en cuyo caso se informará al interesado.

---

## 5. Registro de supresiones (recomendado)

Se recomienda mantener un registro interno de las supresiones realizadas (fecha, categoría de datos, ubicaciones afectadas, responsable de la ejecución) como prueba de cumplimiento del principio de responsabilidad proactiva (*accountability*).

---

**Última actualización:** [FECHA]
**Responsable de la política:** [NOMBRE / CARGO]
