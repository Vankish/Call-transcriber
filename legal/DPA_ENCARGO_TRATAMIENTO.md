# Contrato de Encargo de Tratamiento (DPA) — Call Transcriber

> **BORRADOR — requiere revisión por un abogado antes de su uso en producción.**

Plantilla de contrato de encargo de tratamiento de datos conforme al **artículo 28 del Reglamento (UE) 2016/679 (RGPD)**.

---

## Reunidos

De una parte, **[NOMBRE DE LA EMPRESA / RECLUTADOR]**, con NIF/CIF **[NIF/CIF]** y domicilio en **[DIRECCIÓN]**, representada por **[NOMBRE DEL REPRESENTANTE]** (en adelante, el **"Responsable del Tratamiento"**).

De otra parte, **[NOMBRE DEL ENCARGADO — p. ej. desarrollador/proveedor de Call Transcriber]**, con NIF/CIF **[NIF/CIF]** y domicilio en **[DIRECCIÓN]**, representada por **[NOMBRE DEL REPRESENTANTE]** (en adelante, el **"Encargado del Tratamiento"**).

Ambas partes se reconocen capacidad suficiente para suscribir el presente contrato y

## Exponen

Que el Encargado prestará al Responsable un servicio de software (la aplicación **Call Transcriber**) que conlleva el tratamiento de datos personales por cuenta del Responsable, regulándose dicho tratamiento mediante las siguientes

## Cláusulas

### 1. Objeto
El presente contrato regula el tratamiento de datos personales que el Encargado realiza por cuenta del Responsable en el marco de la prestación del servicio Call Transcriber, consistente en la grabación, transcripción, almacenamiento y análisis mediante IA de entrevistas de trabajo.

### 2. Duración
El encargo tendrá vigencia desde **[FECHA DE INICIO]** y mientras dure la relación contractual de prestación del servicio. Finalizado el contrato, el Encargado procederá conforme a la cláusula 9 (devolución/supresión).

### 3. Naturaleza y finalidad del tratamiento
El tratamiento tiene por finalidad permitir al Responsable gestionar y evaluar candidaturas en procesos de selección, mediante la grabación de audio, su transcripción (Whisper), la generación de resúmenes e informes (LLaMA) y el almacenamiento de los datos asociados.

### 4. Tipo de datos personales
- Datos identificativos y de contacto del candidato: nombre, email, teléfono, cargo.
- Datos de voz (grabación de audio).
- Contenido de la entrevista (transcripción y resumen), que puede incluir datos sobre trayectoria, formación y situación personal.
- Datos del usuario reclutador: nombre, email, empresa.

> El servicio **no está destinado** al tratamiento de categorías especiales de datos (art. 9 RGPD). El Responsable se compromete a no introducir intencionadamente dichos datos.

### 5. Categorías de interesados
- Candidatos a puestos de trabajo.
- Usuarios reclutadores del Responsable.

### 6. Obligaciones del Encargado
El Encargado se obliga a:
1. Tratar los datos únicamente conforme a las **instrucciones documentadas** del Responsable, incluidas las relativas a transferencias internacionales.
2. No utilizar los datos para fines propios ni comunicarlos a terceros salvo autorización u obligación legal.
3. Garantizar que las personas autorizadas a tratar los datos se comprometen a la **confidencialidad**.
4. Aplicar las **medidas técnicas y organizativas** del art. 32 RGPD (cláusula 8).
5. **Asistir al Responsable** en la atención de los derechos de los interesados (acceso, rectificación, supresión, oposición, portabilidad, limitación).
6. Asistir al Responsable en el cumplimiento de las obligaciones de los arts. 32 a 36 RGPD (seguridad, notificación de brechas, evaluaciones de impacto).
7. **Notificar sin dilación indebida** (y en todo caso en un plazo máximo de **[p. ej. 24-72] horas**) cualquier violación de seguridad de los datos de la que tenga conocimiento, con la información necesaria para que el Responsable cumpla sus obligaciones de notificación.
8. Poner a disposición del Responsable la información necesaria para demostrar el cumplimiento de estas obligaciones.

### 7. Subencargados
El Responsable **autoriza** al Encargado a recurrir a los siguientes subencargados:

| Subencargado | Finalidad | Ubicación |
|---|---|---|
| **Groq, Inc.** | Transcripción (Whisper) y resúmenes (LLaMA) mediante IA. | Estados Unidos |
| **Supabase** | Almacenamiento de datos estructurados en la nube. | [REGIÓN] |

El Encargado garantizará que los subencargados queden vinculados por las **mismas obligaciones** de protección de datos mediante contrato. El Encargado informará al Responsable de cualquier **cambio** de subencargados, dando opción a oponerse.

En lo relativo a **Groq (EE.UU.)**, la transferencia internacional se ampara en las **Cláusulas Contractuales Tipo (CCT/SCC)** de la Comisión Europea u otro mecanismo de adecuación vigente.

### 8. Medidas de seguridad
Las partes aplicarán medidas técnicas y organizativas apropiadas, entre ellas:
- Cifrado de los datos **en tránsito** (HTTPS/TLS).
- Control de acceso basado en credenciales y autorización.
- Almacenamiento local de las grabaciones en `Documentos/CallTranscriber`, bajo el control y responsabilidad de seguridad del **Responsable** (se recomienda cifrado de disco y control de acceso al equipo).
- Medidas de los proveedores cloud (Supabase) conforme a sus estándares de seguridad.
- [OTRAS MEDIDAS ESPECÍFICAS A DEFINIR]

> No se declaran certificaciones específicas; cualquier certificación deberá acreditarse documentalmente por la parte que la ostente.

### 9. Devolución o supresión de los datos
A la finalización del contrato, el Encargado, a elección del Responsable, **devolverá o suprimirá** todos los datos personales y eliminará las copias existentes, salvo que la normativa exija su conservación. La supresión abarcará tanto el almacenamiento en Supabase como, en lo que corresponda, las copias bajo control del Encargado.

### 10. Auditoría
El Encargado pondrá a disposición del Responsable la información necesaria y permitirá y contribuirá a la realización de **auditorías**, incluidas inspecciones, por el Responsable o un auditor mandatado, con preaviso razonable de **[p. ej. 15] días** y respetando la confidencialidad y continuidad del servicio.

### 11. Responsabilidad
Cada parte responderá conforme a lo previsto en el RGPD y demás normativa aplicable. [CLÁUSULAS DE LIMITACIÓN DE RESPONSABILIDAD, A NEGOCIAR.]

### 12. Legislación y jurisdicción
El presente contrato se rige por la legislación española y de la Unión Europea. Para cualquier controversia, las partes se someten a los Juzgados y Tribunales de **[CIUDAD]**.

---

**En [LUGAR], a [FECHA].**

| El Responsable del Tratamiento | El Encargado del Tratamiento |
|---|---|
| Firma: ____________________ | Firma: ____________________ |
| Nombre: [NOMBRE] | Nombre: [NOMBRE] |
