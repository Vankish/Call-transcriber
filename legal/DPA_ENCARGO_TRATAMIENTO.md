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
El presente contrato regula el tratamiento de datos personales que el Encargado realiza por cuenta del Responsable en el marco de la prestación del servicio Call Transcriber, consistente en la grabación (audio y, en su caso, vídeo de la pantalla), transcripción, almacenamiento en la nube, análisis mediante IA y compartición controlada de entrevistas de trabajo.

### 2. Duración
El encargo tendrá vigencia desde **[FECHA DE INICIO]** y mientras dure la relación contractual de prestación del servicio. Finalizado el contrato, el Encargado procederá conforme a la cláusula 9 (devolución/supresión).

### 3. Naturaleza y finalidad del tratamiento
El tratamiento tiene por finalidad permitir al Responsable gestionar y evaluar candidaturas en procesos de selección, mediante:
- la grabación de audio y, en su caso, de vídeo de la pantalla;
- su transcripción y la generación de resúmenes e informes con los modelos de inteligencia artificial que el Responsable configure en la aplicación;
- el almacenamiento de las grabaciones y de los datos asociados en la nube de la aplicación;
- la puesta a disposición de las entrevistas a **coaches** autorizados por el Responsable (que pueden verlas, escucharlas y comentarlas) y a la **empresa cliente** del proceso mediante enlaces privados con caducidad.

### 4. Tipo de datos personales
- Datos identificativos y de contacto del candidato: nombre, email, teléfono, cargo.
- Datos de voz (grabación de audio).
- **Imagen** del candidato y de los demás participantes (grabación de vídeo de la pantalla, cuando se graba).
- Contenido de la entrevista (transcripción y resumen), que puede incluir datos sobre trayectoria, formación y situación personal.
- Comentarios de los coaches sobre la entrevista.
- Datos de los usuarios de la aplicación (reclutadores y coaches): nombre, email, empresa, credenciales de acceso (contraseña cifrada o identificador de la cuenta de Google) y registros de sesión.
- Datos técnicos de quien abre un enlace compartido (dirección IP, registros de acceso).

> El servicio **no está destinado** al tratamiento de categorías especiales de datos (art. 9 RGPD). El Responsable se compromete a no introducir intencionadamente dichos datos. La voz y la imagen se tratan para grabar la entrevista, **no** para identificar a nadie por medios biométricos.

### 5. Categorías de interesados
- Candidatos a puestos de trabajo.
- Usuarios reclutadores del Responsable.
- Coaches autorizados por el Responsable.
- Personas de la empresa cliente que abren los enlaces compartidos.

### 6. Obligaciones del Encargado
El Encargado se obliga a:
1. Tratar los datos únicamente conforme a las **instrucciones documentadas** del Responsable, incluidas las relativas a transferencias internacionales.
2. No utilizar los datos para fines propios ni comunicarlos a terceros salvo autorización u obligación legal. Dar acceso a un coach o generar un enlace para la empresa cliente es una instrucción del Responsable, que este ejecuta desde la propia aplicación.
3. Garantizar que las personas autorizadas a tratar los datos —incluidos los coaches— se comprometen a la **confidencialidad**.
4. Aplicar las **medidas técnicas y organizativas** del art. 32 RGPD (cláusula 8).
5. **Asistir al Responsable** en la atención de los derechos de los interesados (acceso, rectificación, supresión, oposición, portabilidad, limitación).
6. Asistir al Responsable en el cumplimiento de las obligaciones de los arts. 32 a 36 RGPD (seguridad, notificación de brechas, evaluaciones de impacto).
7. **Notificar sin dilación indebida** (y en todo caso en un plazo máximo de **[p. ej. 24-72] horas**) cualquier violación de seguridad de los datos de la que tenga conocimiento, con la información necesaria para que el Responsable cumpla sus obligaciones de notificación.
8. Poner a disposición del Responsable la información necesaria para demostrar el cumplimiento de estas obligaciones.

### 7. Subencargados
El Responsable **autoriza** al Encargado a recurrir a los siguientes subencargados:

| Subencargado | Finalidad | Ubicación |
|---|---|---|
| **[PROVEEDOR DE TRANSCRIPCIÓN]** (p. ej. ElevenLabs, Groq, OpenAI, Deepgram) | Convierte el audio de la entrevista en texto. | Estados Unidos |
| **[PROVEEDOR DE RESUMEN]** (p. ej. Groq, OpenAI, Anthropic) | Genera el resumen de evaluación. | Estados Unidos |
| **Convex** (Convex Labs, Inc., EE.UU.) | Base de datos y cuentas de usuario: proyectos, candidatos, entrevistas, transcripciones, resúmenes, comentarios, enlaces compartidos, credenciales y sesiones. | **[REGIÓN — p. ej. UE, `aws-eu-west-1` (Irlanda)]**. Algunos subencargados de Convex (observabilidad, soporte) están en EE.UU. |
| **Cloudflare** (Cloudflare, Inc., EE.UU.) — R2 | Almacenamiento de los archivos de **audio y vídeo** de las entrevistas. | **[UBICACIÓN — p. ej. UE, bucket con restricción de jurisdicción `eu`]** |
| **Cloudflare** — Pages | Aloja la web desde la que coaches y clientes ven las entrevistas. No guarda datos de candidatos; ve la IP y los registros de acceso de quien la abre. | Red global de Cloudflare |
| **[PROVEEDOR DE CORREO, si se usa]** | Envío de correos de verificación y de recuperación de contraseña. | [UBICACIÓN] |

Si la cuenta se abre con **Google**, Google interviene solo para identificar al usuario y actúa como responsable independiente de ese inicio de sesión.

El Encargado garantizará que los subencargados queden vinculados por las **mismas obligaciones** de protección de datos mediante contrato (Convex y Cloudflare ofrecen sus propios acuerdos de encargo, que incorporan las Cláusulas Contractuales Tipo). El Encargado informará al Responsable de cualquier **cambio** de subencargados, dando opción a oponerse.

En lo relativo a los proveedores de IA con servidores en **EE.UU.** —que son todos los que la aplicación incluye por defecto— y a Convex y Cloudflare, que son empresas estadounidenses aunque alojen los datos en la UE, la transferencia internacional se ampara en las **Cláusulas Contractuales Tipo (CCT/SCC)** de la Comisión Europea, en el *EU-U.S. Data Privacy Framework* cuando el proveedor esté certificado, u otro mecanismo de adecuación vigente. El Responsable debe actualizar este anexo cada vez que cambie de proveedor en la aplicación.

### 8. Medidas de seguridad
Las partes aplicarán medidas técnicas y organizativas apropiadas, entre ellas:
- Cifrado de los datos **en tránsito** (HTTPS/TLS) y **en reposo** en los proveedores de nube.
- Control de acceso basado en cuentas individuales (correo y contraseña o cuenta de Google) y en permisos por proyecto.
- **Coaches**: solo acceden a los proyectos para los que el usuario propietario los haya aprobado expresamente, y ese acceso se puede retirar en cualquier momento.
- **Enlaces para clientes** [PENDIENTE: confirmar con la implementación]: privados, imposibles de adivinar, de solo lectura, con caducidad a los **7 días** y renovables o anulables por el propietario. Los archivos de audio y vídeo se sirven con URL firmadas de corta duración, nunca con un enlace público permanente.
- Archivos de audio y vídeo en un **bucket privado** de Cloudflare R2, sin acceso público.
- Copia local de las grabaciones en `Documentos/CallTranscriber`, bajo el control y responsabilidad de seguridad del **Responsable** (se recomienda cifrado de disco y control de acceso al equipo).
- Las **claves de los proveedores de IA** se guardan solo en el equipo del usuario, nunca en la nube.
- Medidas de los proveedores cloud conforme a sus certificaciones (Convex: SOC 2 Tipo II; Cloudflare: SOC 2 Tipo II, ISO 27001, ISO 27701).
- [OTRAS MEDIDAS ESPECÍFICAS A DEFINIR]

> Las certificaciones citadas son de los proveedores, no del Encargado. Cualquier certificación propia deberá acreditarse documentalmente por la parte que la ostente.

### 9. Devolución o supresión de los datos
A la finalización del contrato, el Encargado, a elección del Responsable, **devolverá o suprimirá** todos los datos personales y eliminará las copias existentes, salvo que la normativa exija su conservación. La supresión abarcará la base de datos de Convex, los archivos de audio y vídeo de Cloudflare R2, los enlaces compartidos y los accesos de coaches, y, en lo que corresponda, las copias bajo control del Encargado. Las copias de seguridad de los proveedores se eliminarán conforme a su propio ciclo de retención.

Mientras el contrato esté vigente, la conservación se rige por la **Política de Retención** acordada con el Responsable.

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
