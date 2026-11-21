import type { Infer } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import type { mediaSummary } from "./validators";

type Db = QueryCtx["db"];

/**
 * Los archivos de una llamada, sin nada que sirva para bajarlos: la URL sale
 * siempre de `media.playbackUrl`, que comprueba el acceso y lo apunta. Los que
 * no han terminado de subir también salen, para que la web diga "subiendo".
 */
export const mediaFor = async (
  db: Db,
  interviewId: Id<"interview">,
): Promise<Infer<typeof mediaSummary>[]> => {
  const rows = await db
    .query("media")
    .withIndex("by_interview_id", (q) => q.eq("interviewId", interviewId))
    .collect();
  return rows
    .filter((m) => m.deletedAt === undefined && m.uploadStatus !== "error")
    .map((m) => ({
      _id: m._id,
      interviewId: m.interviewId,
      kind: m.kind,
      mimeType: m.mimeType,
      bytes: m.bytes,
      durationSec: m.durationSec,
      localRelPath: m.localRelPath,
      uploadStatus: m.uploadStatus,
      createdAt: m.createdAt,
      completedAt: m.completedAt,
    }));
};

/** Lo que hace falta para pintar una llamada: perfil, proyecto, texto y archivos. */
export const interviewBundle = async (db: Db, interview: Doc<"interview">) => {
  const [candidate, project, transcript, media] = await Promise.all([
    db.get(interview.candidateId),
    db.get(interview.projectId),
    db
      .query("transcript")
      .withIndex("by_interview_id", (q) => q.eq("interviewId", interview._id))
      .unique(),
    mediaFor(db, interview._id),
  ]);
  if (candidate === null || project === null) return null;
  return { interview, candidate, project, transcript, media };
};
