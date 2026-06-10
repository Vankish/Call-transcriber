# Política de Privacidad — Call Transcriber

> **BORRADOR — requiere revisión por un abogado antes de su uso en producción.**

---

## 1. Responsable del tratamiento

El responsable del tratamiento de los datos personales recabados a través de la aplicación **Call Transcriber** es la empresa o profesional que utiliza la aplicación para grabar y evaluar entrevistas de trabajo (en adelante, el "Responsable").

- **Razón social:** [NOMBRE DE LA EMPRESA / RECLUTADOR]
- **NIF/CIF:** [NIF/CIF]
- **Domicilio:** [DIRECCIÓN POSTAL COMPLETA]
- **Correo electrónico de contacto:** [EMAIL DE CONTACTO]
- **Teléfono:** [TELÉFONO]
- **Delegado de Protección de Datos (DPO), si procede:** [NOMBRE / EMAIL DEL DPO]

> Nota: El desarrollador de la aplicación Call Transcriber actúa como proveedor del software y, en su caso, como encargado o subencargado del tratamiento, conforme al contrato de encargo de tratamiento (DPA) aplicable. No es responsable del tratamiento de los datos de los candidatos.

---

## 2. ¿Qué datos personales tratamos?

A través de Call Transcriber se tratan las siguientes categorías de datos personales:

### 2.1. Datos de los candidatos a un puesto de trabajo
- Nombre y apellidos.
- Dirección de correo electrónico.
- Teléfono.
- Cargo o puesto al que opta.
- **Grabación de audio de la entrevista (voz).**
- **Contenido de la entrevista** (transcripción y resumen), que puede incluir información sobre trayectoria profesional, formación, experiencia y, eventualmente, datos sobre la situación personal que el candidato decida compartir durante la conversación.

> **Advertencia sobre categorías especiales de datos:** La aplicación no está diseñada para recabar categorías especiales de datos (art. 9 RGPD: salud, origen étnico, opiniones políticas, religión, orientación sexual, etc.). No obstante, una entrevista en lenguaje libre podría contener este tipo de información. El Responsable debe evitar inducir o registrar dichos datos y, en caso de que aparezcan, tratarlos conforme a las garantías reforzadas del RGPD.

### 2.2. Datos del usuario de la aplicación (reclutador)
- Nombre y apellidos.
- Correo electrónico.
- Empresa.

---

## 3. Finalidades del tratamiento

| Finalidad | Descripción |
|---|---|
| Grabación de la entrevista | Registrar el audio de la entrevista de trabajo. |
| Transcripción | Convertir el audio a texto mediante un servicio de IA (Groq / modelo Whisper). |
| Generación de resúmenes e informes de evaluación | Elaborar resúmenes y valoraciones del candidato mediante IA (Groq / modelo LLaMA). |
| Gestión del proceso de selección | Organizar candidatos, proyectos y resultados de las entrevistas. |
| Gestión de la cuenta de usuario | Permitir el acceso y uso de la aplicación por el reclutador. |

La aplicación **no** utiliza los datos para decisiones totalmente automatizadas con efectos jurídicos en el sentido del art. 22 RGPD: los informes de IA son una ayuda a la valoración humana, y la decisión final de selección corresponde siempre a una persona.

---

## 4. Base jurídica del tratamiento

- **Consentimiento del candidato (art. 6.1.a RGPD):** la grabación de la voz y de la entrevista se realiza previo consentimiento informado, libre y específico del candidato, recabado antes de iniciar la grabación.
- **Interés legítimo del Responsable (art. 6.1.f RGPD):** la gestión del proceso de selección y la evaluación de candidaturas responde al interés legítimo del reclutador en cubrir un puesto de trabajo, ponderado frente a los derechos del candidato.
- **Ejecución de medidas precontractuales (art. 6.1.b RGPD):** en su caso, el tratamiento de los datos de contacto del candidato en el marco de un proceso de selección a petición del interesado.
- **Ejecución de contrato (art. 6.1.b RGPD):** para los datos del usuario reclutador, necesarios para la prestación del servicio.

El candidato puede retirar su consentimiento en cualquier momento, sin que ello afecte a la licitud del tratamiento previo a su retirada.

---

## 5. Destinatarios y encargados del tratamiento

Los datos pueden ser comunicados a los siguientes proveedores que actúan como **encargados del tratamiento** por cuenta del Responsable, con contrato de encargo conforme al art. 28 RGPD:

| Encargado | Función | Ubicación de los servidores |
|---|---|---|
| **Groq, Inc.** | Transcripción de audio (Whisper) y generación de resúmenes (LLaMA) mediante IA. | **Estados Unidos** |
| **Supabase** | Almacenamiento en la nube de datos estructurados (proyectos, candidatos, transcripciones, resúmenes, perfil del usuario). | **[REGIÓN]** (UE o EE.UU., según configuración del proyecto) |

No se realizan otras cesiones de datos a terceros salvo obligación legal.

### 5.1. Almacenamiento local
Las **grabaciones de audio** se almacenan **localmente** en el equipo del usuario, en la carpeta `Documentos/CallTranscriber`. El Responsable es quien controla el acceso físico y lógico a dicho equipo y debe adoptar medidas de seguridad adecuadas (cifrado de disco, control de acceso, etc.).

---

## 6. Transferencias internacionales de datos

El uso de **Groq (EE.UU.)** implica una **transferencia internacional de datos personales** fuera del Espacio Económico Europeo. Dicha transferencia se ampara, según corresponda, en:

- Las **Cláusulas Contractuales Tipo (CCT / SCC)** aprobadas por la Comisión Europea (Decisión de Ejecución (UE) 2021/914), y/o
- Los mecanismos de adecuación vigentes (p. ej., adhesión del proveedor al marco *EU-U.S. Data Privacy Framework*, en caso de estar certificado — **a verificar por el Responsable**).

En su caso, si **Supabase** estuviera configurado en una región fuera del EEE, le resultarán de aplicación las mismas garantías.

> El Responsable debe verificar y documentar el mecanismo de transferencia vigente con cada proveedor, así como realizar, cuando proceda, una evaluación de impacto de las transferencias (TIA).

---

## 7. Plazos de conservación

Los datos se conservarán durante el tiempo estrictamente necesario para las finalidades indicadas. Los plazos concretos se detallan en la **Política de Retención y Supresión** de la aplicación. Con carácter orientativo:

- Datos de candidatos **no seleccionados:** [PLAZO, p. ej. 12 meses] desde la finalización del proceso, salvo consentimiento para conservarlos para futuros procesos.
- Datos de candidatos **contratados:** durante la relación laboral y los plazos legales aplicables posteriores.
- Grabaciones de audio y transcripciones: [PLAZO] (ver Política de Retención).

Transcurridos los plazos, los datos se suprimen o anonimizan tanto localmente como en Supabase.

---

## 8. Derechos de los interesados

Los candidatos y usuarios pueden ejercer los siguientes derechos:

- **Acceso:** conocer qué datos suyos se tratan.
- **Rectificación:** corregir datos inexactos o incompletos.
- **Supresión ("derecho al olvido"):** solicitar la eliminación de sus datos.
- **Oposición:** oponerse al tratamiento basado en interés legítimo.
- **Portabilidad:** recibir sus datos en un formato estructurado y de uso común.
- **Limitación del tratamiento:** solicitar que se restrinja el tratamiento en determinados supuestos.
- **Retirada del consentimiento:** en cualquier momento, sin efecto retroactivo.
- **No ser objeto de decisiones individuales automatizadas** con efectos jurídicos (art. 22 RGPD).

### Cómo ejercer los derechos
Mediante solicitud dirigida a:
- **Correo electrónico:** [EMAIL DE EJERCICIO DE DERECHOS]
- **Dirección postal:** [DIRECCIÓN POSTAL]

Se podrá solicitar la acreditación de identidad. La respuesta se facilitará en el plazo máximo de **un mes**, prorrogable conforme al RGPD.

### Reclamación ante la autoridad de control
Si considera que sus derechos no han sido atendidos, puede reclamar ante la **Agencia Española de Protección de Datos (AEPD)** — www.aepd.es — o ante la autoridad de control competente.

---

## 9. Medidas de seguridad

El Responsable y los encargados aplican medidas técnicas y organizativas apropiadas conforme al art. 32 RGPD (cifrado en tránsito, control de acceso, etc.). El Responsable es responsable de la seguridad del equipo local donde se almacenan las grabaciones.

---

## 10. Modificaciones

Esta política podrá actualizarse para adaptarla a cambios normativos o funcionales. La versión vigente será la publicada en [UBICACIÓN / URL].

**Última actualización:** [FECHA]
