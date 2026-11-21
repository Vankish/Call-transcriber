import { v } from "convex/values";

import schema from "./schema";

/**
 * Validadores de argumentos y respuestas sacados del esquema, para que una
 * columna nueva en `schema.ts` no obligue a tocar cinco sitios. Lo que no sale
 * del esquema (las filas "como las ve el escritorio", con `localId` del padre
 * en vez de su `_id`) se arma aquí a partir de él.
 */

const t = schema.tables;

const withSystem = <T extends string>(table: T) => ({
  _id: v.id(table),
  _creationTime: v.number(),
});

// ── Documentos tal cual (para la web) ─────────────────────────────────────────

export const projectDoc = t.project.validator.extend(withSystem("project"));
export const candidateDoc = t.candidate.validator.extend(withSystem("candidate"));
export const interviewDoc = t.interview.validator.extend(withSystem("interview"));
export const transcriptDoc = t.transcript.validator.extend(
  withSystem("transcript"),
);
export const memberDoc = t.member.validator.extend(withSystem("member"));
export const invitationDoc = t.invitation.validator.extend(
  withSystem("invitation"),
);

export const memberRole = t.member.validator.fields.role;
export const memberStatus = t.member.validator.fields.status;
export const mediaKind = t.media.validator.fields.kind;

/** Un archivo sin nada que permita bajarlo: la URL sale de `media.playbackUrl`. */
export const mediaSummary = v.object({
  _id: v.id("media"),
  interviewId: v.id("interview"),
  kind: mediaKind,
  mimeType: v.string(),
  bytes: v.number(),
  durationSec: v.optional(v.number()),
  localRelPath: v.string(),
  uploadStatus: t.media.validator.fields.uploadStatus,
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
});

/**
 * El perfil que ve un cliente por un enlace: sin correo, teléfono, notas ni
 * datos del CRM (contrato, "Enlaces de cliente").
 */
export const publicCandidate = v.object({
  _id: v.id("candidate"),
  name: v.string(),
  role: v.string(),
});

export const publicProject = v.object({
  _id: v.id("project"),
  name: v.string(),
  company: v.string(),
  kind: t.project.validator.fields.kind,
});

// ── Filas del escritorio (sincronización) ─────────────────────────────────────

// Lo que sube el escritorio: la fila sin los ids de Convex ni el borrado (que
// va por `sync.markDeleted`).
export const projectItem = t.project.validator.omit("workspaceId", "deletedAt");

export const candidateItem = t.candidate.validator
  .omit("workspaceId", "projectId", "deletedAt")
  .extend({ projectLocalId: v.string() });

export const interviewItem = t.interview.validator
  .omit("workspaceId", "projectId", "candidateId", "deletedAt")
  .extend({ candidateLocalId: v.string() });

export const transcriptItem = v.object({
  interviewLocalId: v.string(),
  original: v.string(),
  edited: v.string(),
  segments: t.transcript.validator.fields.segments,
  updatedAt: v.number(),
});

// Lo que devuelve `sync.pull`: lo mismo, con el borrado si lo hay.
const deletedAt = { deletedAt: v.optional(v.number()) };
export const pulledProject = projectItem.extend(deletedAt);
export const pulledCandidate = candidateItem.extend(deletedAt);
export const pulledInterview = interviewItem.extend(deletedAt);

export const syncResult = v.object({
  applied: v.array(v.string()),
  skipped: v.array(v.string()),
});
