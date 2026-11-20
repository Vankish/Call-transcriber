import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ── Esquema de la nube (contrato del paso 0) ─────────────────────────────────
// Es la pieza que comparten todos los frentes: la app de escritorio sube aquí,
// la web de coaches y clientes lee de aquí. Cambiar un campo es cambiar el
// contrato: avisa en docs/nube/CONTRATO.md antes de tocarlo.
//
// Tres decisiones que lo explican casi todo:
//
// 1. El PC sigue siendo el original. Cada fila que viene del escritorio lleva su
//    `localId` (el id que ya tiene en call-transcriber-datos.json), y se sube con
//    "upsert por localId". Así subir dos veces no duplica, y la carpeta, el
//    nombre de archivo y el vínculo con el CRM siguen siendo los mismos de antes.
// 2. Borrar es ocultar (`deletedAt`). Un borrado en un PC tiene que llegar al
//    otro como borrado, no como "falta esta fila"; y un comentario de coach no
//    debe desaparecer porque alguien se equivocó al limpiar.
// 3. Las fechas son milisegundos (número), como en el CRM de Orbit. En local son
//    texto ISO: la conversión la hace la capa de sincronización, no la tabla.

const projectKind = v.union(v.literal("entrevistas"), v.literal("clientes"));

const memberRole = v.union(
  v.literal("owner"), // dueño del espacio: todo, incluido repartir accesos
  v.literal("admin"), // como el dueño menos borrar el espacio
  v.literal("editor"), // compañero: lee y escribe en los proyectos a los que tiene acceso
  v.literal("coach"), // lee, ve el vídeo y comenta; no edita nada
);

const memberStatus = v.union(
  v.literal("active"),
  v.literal("disabled"),
);

const mediaKind = v.union(
  v.literal("mix"), // micro + sistema mezclados: lo que se escucha
  v.literal("system"), // solo el interlocutor (sirve para separar quién habla)
  v.literal("video"), // pantalla de la llamada, con audio
);

// Lo que el escritorio guarda del trato del CRM. Se sube para enseñarlo, pero el
// envío al CRM sigue saliendo del PC (electron/crm.cjs): la nube no habla con Orbit.
const crmDeal = v.object({
  dealId: v.string(),
  company: v.string(),
  contactEmail: v.string(),
  linkedinUrl: v.string(),
  stage: v.string(),
  lastSentAt: v.union(v.number(), v.null()),
  spinSituation: v.string(),
  spinProblem: v.string(),
  spinImplication: v.string(),
  spinNeedPayoff: v.string(),
  singleSalesObjective: v.string(),
  nextStep: v.string(),
  nota: v.string(),
});

export default defineSchema({
  ...authTables,

  // ── Espacios y personas ─────────────────────────────────────────────────────

  // Un espacio por dueño. Lo crea la app de escritorio la primera vez que
  // sincroniza; un coach que solo usa la web nunca tiene uno propio.
  workspace: defineTable({
    name: v.string(),
    ownerUserId: v.id("users"),
    createdAt: v.number(),
  }).index("by_owner_user_id", ["ownerUserId"]),

  // Quién está dentro de un espacio y con qué papel. Igual que `teamMember` del
  // CRM de Orbit: nadie ve nada por registrarse, solo por estar aquí activo.
  member: defineTable({
    workspaceId: v.id("workspace"),
    userId: v.id("users"),
    email: v.string(), // normalizado: minúsculas y sin espacios
    name: v.string(),
    role: memberRole,
    status: memberStatus,
    // Solo para coach y editor: a qué proyectos llega. Vacío = a ninguno.
    // El dueño y los admin llegan a todo y esto se ignora.
    projectIds: v.array(v.id("project")),
    invitedBy: v.optional(v.id("member")),
    createdAt: v.number(),
  })
    .index("by_workspace_id", ["workspaceId"])
    .index("by_user_id", ["userId"])
    .index("by_workspace_id_and_user_id", ["workspaceId", "userId"]),

  // La invitación es el "visto bueno" del dueño: se invita por correo y, cuando
  // esa persona entra con Google o contraseña con ese mismo correo, pasa a member.
  invitation: defineTable({
    workspaceId: v.id("workspace"),
    email: v.string(), // normalizado
    role: memberRole,
    projectIds: v.array(v.id("project")),
    invitedBy: v.id("member"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked")),
    createdAt: v.number(),
  })
    .index("by_email_and_status", ["email", "status"])
    .index("by_workspace_id", ["workspaceId"]),

  // ── Lo que viene del escritorio ─────────────────────────────────────────────

  project: defineTable({
    workspaceId: v.id("workspace"),
    localId: v.string(),
    name: v.string(),
    company: v.string(),
    kind: projectKind,
    status: v.union(v.literal("active"), v.literal("closed")),
    evaluationCriteria: v.array(v.string()),
    interviewers: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_workspace_id", ["workspaceId"])
    .index("by_workspace_id_and_local_id", ["workspaceId", "localId"])
    .index("by_workspace_id_and_updated_at", ["workspaceId", "updatedAt"]),

  // En la interfaz se llama "perfil" o "candidato"; en carpetas de clientes es
  // el contacto de un trato.
  candidate: defineTable({
    workspaceId: v.id("workspace"),
    projectId: v.id("project"),
    localId: v.string(),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    role: v.string(),
    notes: v.string(),
    candidateStatus: v.union(
      v.literal("pendiente"),
      v.literal("apto"),
      v.literal("descartado"),
      v.literal("finalista"),
    ),
    consentGiven: v.boolean(),
    consentAt: v.union(v.number(), v.null()),
    crm: v.optional(v.union(crmDeal, v.null())),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_project_id", ["projectId"])
    .index("by_workspace_id_and_local_id", ["workspaceId", "localId"])
    .index("by_workspace_id_and_updated_at", ["workspaceId", "updatedAt"]),

  // Una llamada o entrevista. Lo que solo tiene sentido en el PC que grabó
  // (rutas de archivo, micrófono elegido, estado de la grabación en curso) no
  // sube: aquí solo va lo que alguien puede necesitar desde otro sitio.
  interview: defineTable({
    workspaceId: v.id("workspace"),
    projectId: v.id("project"),
    candidateId: v.id("candidate"),
    localId: v.string(),
    sessionName: v.string(),
    durationSec: v.number(),
    captureSource: v.union(v.literal("none"), v.literal("mic"), v.literal("mic+system")),
    interviewerName: v.string(),
    transcriptionStatus: v.union(
      v.literal("pending"),
      v.literal("transcribing"),
      v.literal("done"),
      v.literal("error"),
    ),
    summaryText: v.string(),
    summaryType: v.union(v.literal("resumen"), v.literal("listado")),
    summaryContext: v.union(v.literal("entrevista"), v.literal("reunion")),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_candidate_id", ["candidateId"])
    .index("by_project_id", ["projectId"])
    .index("by_workspace_id_and_local_id", ["workspaceId", "localId"])
    .index("by_workspace_id_and_updated_at", ["workspaceId", "updatedAt"]),

  // La transcripción va aparte de la entrevista: pesa decenas de KB y las listas
  // (proyectos, perfiles, llamadas) no la necesitan. Un documento de Convex tiene
  // un máximo de 1 MB; una hora de llamada transcrita ronda los 60-100 KB.
  transcript: defineTable({
    workspaceId: v.id("workspace"),
    interviewId: v.id("interview"),
    original: v.string(),
    edited: v.string(),
    // Frases con su segundo, para que en la web pinchar una frase salte el vídeo
    // a ese momento. Opcional: las transcripciones antiguas solo tienen texto.
    segments: v.optional(
      v.array(
        v.object({
          startSec: v.number(),
          endSec: v.number(),
          speaker: v.string(),
          text: v.string(),
        }),
      ),
    ),
    updatedAt: v.number(),
  }).index("by_interview_id", ["interviewId"]),

  // ── Archivos grandes ────────────────────────────────────────────────────────

  // El audio y el vídeo viven en Cloudflare R2, no en Convex: R2 no cobra por
  // verlos y Convex sí. Aquí solo queda dónde está cada archivo y cómo va su
  // subida. La subida es por partes (multipart de S3) para poder reanudarla si
  // se corta a mitad de un vídeo de 500 MB.
  media: defineTable({
    workspaceId: v.id("workspace"),
    interviewId: v.id("interview"),
    kind: mediaKind,
    r2Key: v.string(), // `${workspaceId}/${interviewId}/${kind}.${ext}`
    mimeType: v.string(),
    bytes: v.number(),
    durationSec: v.optional(v.number()),
    sha256: v.string(), // para no volver a subir lo que ya está arriba
    // Ruta relativa dentro de Documentos\CallTranscriber, con su carpeta. Es lo
    // que permite restaurar la misma estructura en otro PC.
    localRelPath: v.string(),
    uploadStatus: v.union(
      v.literal("pending"),
      v.literal("uploading"),
      v.literal("done"),
      v.literal("error"),
    ),
    uploadId: v.optional(v.string()), // id del multipart en R2 mientras se sube
    partSize: v.optional(v.number()),
    partsDone: v.array(v.object({ partNumber: v.number(), etag: v.string() })),
    error: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_interview_id", ["interviewId"])
    .index("by_interview_id_and_kind", ["interviewId", "kind"])
    .index("by_workspace_id_and_sha256", ["workspaceId", "sha256"]),

  // ── Lo que nace en la nube ──────────────────────────────────────────────────

  // Comentarios de coaches y compañeros. `atSec` los pega a un momento del
  // vídeo ("en el minuto 12 hablas muy rápido"); sin él, es un comentario general.
  comment: defineTable({
    workspaceId: v.id("workspace"),
    interviewId: v.id("interview"),
    authorMemberId: v.id("member"),
    atSec: v.optional(v.number()),
    body: v.string(),
    parentId: v.optional(v.id("comment")), // respuesta a otro comentario
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  }).index("by_interview_id_and_created_at", ["interviewId", "createdAt"]),

  // Enlace privado para un cliente: una sola llamada, solo lectura, caduca a
  // los 7 días y se puede renovar. Se guarda el hash del token, nunca el token:
  // si alguien leyera la tabla no podría abrir ningún enlace.
  shareLink: defineTable({
    workspaceId: v.id("workspace"),
    interviewId: v.id("interview"),
    tokenHash: v.string(), // SHA-256 en hex
    createdBy: v.id("member"),
    label: v.string(), // a quién se le mandó, para reconocerlo al revocarlo
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    openCount: v.number(),
    lastOpenedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_interview_id", ["interviewId"]),

  // Quién abrió qué. Son entrevistas con datos personales: el dueño tiene que
  // poder contestar "¿quién ha visto mi llamada?" (y el RGPD también lo pide).
  accessLog: defineTable({
    workspaceId: v.id("workspace"),
    interviewId: v.id("interview"),
    memberId: v.optional(v.id("member")),
    shareLinkId: v.optional(v.id("shareLink")),
    action: v.union(v.literal("view"), v.literal("play_media")),
    at: v.number(),
  }).index("by_interview_id_and_at", ["interviewId", "at"]),
});
