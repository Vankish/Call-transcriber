import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { fail, notFound } from "./errors";
import { mediaFor } from "./interviewBundle";
import { r2 } from "./r2";
import { takeRateLimit } from "./rateLimit";
import { ownedWorkspace, requireAccess } from "./requireAccess";
import { requireUser } from "./requireUser";
import { liveShareLink } from "./shareToken";
import { mediaKind, mediaSummary } from "./validators";

/**
 * Audio y vídeo en Cloudflare R2, subidos por partes (multipart de S3).
 *
 * Los bytes nunca pasan por Convex: aquí se crea el multipart, se firman
 * direcciones PUT de cada parte, se apunta cuáles han llegado y se cierra. Lo
 * que dice `partsDone` es la verdad para reanudar, aunque la app se haya
 * cerrado a mitad o se siga desde otro PC.
 *
 * Lo que habla con R2 es acción (`startUpload`, `signParts`, `complete`,
 * `abort`, `playbackUrl`); lo que solo apunta, mutación (`completePart`).
 */

export const PART_SIZE = 8 * 1024 * 1024;
const URL_TTL_SEC = 60 * 60;
// S3 admite hasta 10.000 partes: con 8 MB son 80 GB, muy por encima de
// cualquier llamada. El tope por petición es para no firmar miles de golpe.
const MAX_PARTS = 10_000;
const MAX_SIGN_PER_CALL = 100;
const PLAYS_PER_MINUTE = 60;

const partCount = (bytes: number) => Math.max(1, Math.ceil(bytes / PART_SIZE));

// La extensión de la clave en R2. Sale del nombre local si es razonable; si no,
// del tipo. Nunca de algo que pueda colar una barra en la clave.
const MIME_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "video/webm": "webm",
  "video/mp4": "mp4",
};
const extensionFor = (localRelPath: string, mimeType: string): string => {
  const match = /\.([a-z0-9]{1,5})$/i.exec(localRelPath);
  if (match) return match[1].toLowerCase();
  return MIME_EXT[mimeType.split(";")[0].trim().toLowerCase()] ?? "bin";
};

// La ruta relativa se usa en el otro PC para dejar el archivo en su carpeta:
// una ruta absoluta o con ".." podría escribir fuera de Documentos\CallTranscriber.
const checkRelPath = (localRelPath: string) => {
  const parts = localRelPath.split(/[\\/]/);
  if (
    localRelPath.trim() === "" ||
    localRelPath.length > 500 ||
    /^[a-zA-Z]:/.test(localRelPath) ||
    localRelPath.startsWith("/") ||
    localRelPath.startsWith("\\") ||
    parts.some((p) => p === "..")
  ) {
    throw fail("invalid_argument", "La ruta del archivo no es válida.");
  }
};

/** El archivo y el permiso de quien llama sobre su llamada. */
const loadMedia = async (
  ctx: Pick<QueryCtx, "auth" | "db">,
  mediaId: Id<"media">,
  need: "read" | "write",
): Promise<Doc<"media">> => {
  const media = await ctx.db.get(mediaId);
  if (media === null || media.deletedAt !== undefined) throw notFound();
  await requireAccess(ctx, { interviewId: media.interviewId }, need);
  return media;
};

// ── Empezar ───────────────────────────────────────────────────────────────────

const startResult = v.object({
  mediaId: v.id("media"),
  alreadyUploaded: v.boolean(),
  partSize: v.number(),
  partsDone: v.array(v.object({ partNumber: v.number(), etag: v.string() })),
});

const startArgs = {
  interviewLocalId: v.string(),
  kind: mediaKind,
  mimeType: v.string(),
  bytes: v.number(),
  sha256: v.string(),
  localRelPath: v.string(),
  durationSec: v.optional(v.number()),
};

export const startUpload = action({
  args: startArgs,
  returns: startResult,
  handler: async (ctx, args): Promise<{
    mediaId: Id<"media">;
    alreadyUploaded: boolean;
    partSize: number;
    partsDone: { partNumber: number; etag: string }[];
  }> => {
    const begun = await ctx.runMutation(internal.media.beginUpload, args);
    if (begun.needsMultipart === null) return begun.result;
    const { r2Key, mimeType } = begun.needsMultipart;
    let uploadId: string;
    try {
      uploadId = await r2().createMultipart(r2Key, mimeType);
    } catch (error) {
      await ctx.runMutation(internal.media.markError, {
        mediaId: begun.result.mediaId,
        error: String(error).slice(0, 500),
      });
      throw fail("storage_error", "No se pudo empezar la subida. Prueba otra vez.");
    }
    const kept = await ctx.runMutation(internal.media.setUploadId, {
      mediaId: begun.result.mediaId,
      uploadId,
    });
    if (kept !== uploadId) {
      // Otra llamada a la vez ganó la carrera: se usa la suya y la nuestra se
      // cancela para no dejar partes huérfanas cobrando en R2.
      await r2().abortMultipart(r2Key, uploadId).catch(() => undefined);
    }
    return begun.result;
  },
});

export const beginUpload = internalMutation({
  args: startArgs,
  returns: v.object({
    result: startResult,
    needsMultipart: v.union(
      v.object({ r2Key: v.string(), mimeType: v.string() }),
      v.null(),
    ),
  }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const workspace = await ownedWorkspace(ctx.db, userId);
    if (workspace === null) {
      throw fail("no_workspace", "Todavía no tienes un espacio en la nube.");
    }
    const interview = await ctx.db
      .query("interview")
      .withIndex("by_workspace_id_and_local_id", (q) =>
        q.eq("workspaceId", workspace._id).eq("localId", args.interviewLocalId),
      )
      .unique();
    if (interview === null) {
      throw fail("not_found", "Esa llamada todavía no está en la nube: sincronízala primero.");
    }
    await requireAccess(ctx, { interviewId: interview._id }, "write");

    const sha256 = args.sha256.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw fail("invalid_argument", "El sha256 del archivo no es válido.");
    }
    if (!Number.isInteger(args.bytes) || args.bytes <= 0 || partCount(args.bytes) > MAX_PARTS) {
      throw fail("invalid_argument", "El tamaño del archivo no es válido.");
    }
    checkRelPath(args.localRelPath);
    const mimeType = args.mimeType.trim().slice(0, 200) || "application/octet-stream";
    const now = Date.now();

    // 1. Lo que ya está arriba no se vuelve a subir.
    const sameHash = await ctx.db
      .query("media")
      .withIndex("by_workspace_id_and_sha256", (q) =>
        q.eq("workspaceId", workspace._id).eq("sha256", sha256),
      )
      .collect();
    const uploaded = sameHash.filter((m) => m.uploadStatus === "done" && m.deletedAt === undefined);
    const here = uploaded.find((m) => m.interviewId === interview._id && m.kind === args.kind);
    if (here !== undefined) {
      return {
        result: { mediaId: here._id, alreadyUploaded: true, partSize: here.partSize ?? PART_SIZE, partsDone: here.partsDone },
        needsMultipart: null,
      };
    }

    const siblings = await ctx.db
      .query("media")
      .withIndex("by_interview_id_and_kind", (q) =>
        q.eq("interviewId", interview._id).eq("kind", args.kind),
      )
      .collect();

    if (uploaded.length > 0) {
      // El mismo archivo ya subido para otra llamada: se apunta aquí también,
      // reutilizando su objeto de R2.
      const source = uploaded[0];
      const mediaId = await ctx.db.insert("media", {
        workspaceId: workspace._id,
        interviewId: interview._id,
        kind: args.kind,
        r2Key: source.r2Key,
        mimeType,
        bytes: args.bytes,
        durationSec: args.durationSec,
        sha256,
        localRelPath: args.localRelPath,
        uploadStatus: "done",
        partSize: source.partSize,
        partsDone: source.partsDone,
        createdAt: now,
        completedAt: now,
      });
      await retireOthers(ctx, siblings, mediaId);
      return {
        result: { mediaId, alreadyUploaded: true, partSize: source.partSize ?? PART_SIZE, partsDone: source.partsDone },
        needsMultipart: null,
      };
    }

    // 2. Una subida a medias del mismo archivo: se sigue desde donde iba.
    const resumable = siblings.find(
      (m) =>
        m.deletedAt === undefined &&
        m.sha256 === sha256 &&
        (m.uploadStatus === "pending" || m.uploadStatus === "uploading"),
    );
    if (resumable !== undefined) {
      return {
        result: {
          mediaId: resumable._id,
          alreadyUploaded: false,
          partSize: resumable.partSize ?? PART_SIZE,
          partsDone: resumable.partsDone,
        },
        needsMultipart:
          resumable.uploadId === undefined ? { r2Key: resumable.r2Key, mimeType: resumable.mimeType } : null,
      };
    }

    // 3. Subida nueva. Las que hubiera a medias de otra versión del archivo se
    // cancelan; la versión terminada anterior sigue visible hasta que esta acabe.
    for (const old of siblings) {
      if (old.deletedAt === undefined && old.uploadStatus !== "done") {
        await cancelUpload(ctx, old, "sustituida por otra subida");
      }
    }
    const r2Key = `${workspace._id}/${interview._id}/${args.kind}.${extensionFor(args.localRelPath, mimeType)}`;
    const mediaId = await ctx.db.insert("media", {
      workspaceId: workspace._id,
      interviewId: interview._id,
      kind: args.kind,
      r2Key,
      mimeType,
      bytes: args.bytes,
      durationSec: args.durationSec,
      sha256,
      localRelPath: args.localRelPath,
      uploadStatus: "pending",
      partSize: PART_SIZE,
      partsDone: [],
      createdAt: now,
    });
    return {
      result: { mediaId, alreadyUploaded: false, partSize: PART_SIZE, partsDone: [] },
      needsMultipart: { r2Key, mimeType },
    };
  },
});

/** Las demás versiones terminadas de ese archivo pasan a borradas. */
const retireOthers = async (
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  siblings: Doc<"media">[],
  keepId: Id<"media">,
) => {
  const now = Date.now();
  for (const old of siblings) {
    if (old._id === keepId || old.deletedAt !== undefined) continue;
    if (old.uploadStatus === "done") {
      await ctx.db.patch(old._id, { deletedAt: now });
    } else {
      await cancelUpload(ctx, old, "sustituida por otra subida");
    }
  }
};

const cancelUpload = async (
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  media: Doc<"media">,
  reason: string,
) => {
  if (media.uploadId !== undefined) {
    await ctx.scheduler.runAfter(0, internal.media.abortInR2, {
      r2Key: media.r2Key,
      uploadId: media.uploadId,
    });
  }
  await ctx.db.patch(media._id, {
    uploadStatus: "error",
    error: reason,
    uploadId: undefined,
    deletedAt: Date.now(),
  });
};

/** Guarda el id del multipart; si ya había uno, devuelve ese y no lo pisa. */
export const setUploadId = internalMutation({
  args: { mediaId: v.id("media"), uploadId: v.string() },
  returns: v.string(),
  handler: async (ctx, { mediaId, uploadId }) => {
    const media = await ctx.db.get(mediaId);
    if (media === null) throw notFound();
    if (media.uploadId !== undefined) return media.uploadId;
    await ctx.db.patch(mediaId, { uploadId, uploadStatus: "uploading" });
    return uploadId;
  },
});

export const markError = internalMutation({
  args: { mediaId: v.id("media"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { mediaId, error }) => {
    await ctx.db.patch(mediaId, { uploadStatus: "error", error });
    return null;
  },
});

export const abortInR2 = internalAction({
  args: { r2Key: v.string(), uploadId: v.string() },
  returns: v.null(),
  handler: async (_ctx, { r2Key, uploadId }) => {
    // Si ya no existe (caducó o se cerró), no hay nada que limpiar.
    await r2().abortMultipart(r2Key, uploadId).catch(() => undefined);
    return null;
  },
});

// ── Partes ────────────────────────────────────────────────────────────────────

/** Lo que una acción necesita de una subida en curso, con el permiso comprobado. */
export const uploadState = internalQuery({
  args: { mediaId: v.id("media") },
  returns: v.object({
    r2Key: v.string(),
    uploadId: v.union(v.string(), v.null()),
    uploadStatus: v.string(),
    parts: v.number(),
    partsDone: v.array(v.object({ partNumber: v.number(), etag: v.string() })),
  }),
  handler: async (ctx, { mediaId }) => {
    const media = await loadMedia(ctx, mediaId, "write");
    return {
      r2Key: media.r2Key,
      uploadId: media.uploadId ?? null,
      uploadStatus: media.uploadStatus,
      parts: partCount(media.bytes),
      partsDone: media.partsDone,
    };
  },
});

export const signParts = action({
  args: { mediaId: v.id("media"), partNumbers: v.array(v.number()) },
  returns: v.array(v.object({ partNumber: v.number(), url: v.string() })),
  handler: async (ctx, { mediaId, partNumbers }): Promise<{ partNumber: number; url: string }[]> => {
    if (partNumbers.length > MAX_SIGN_PER_CALL) {
      throw fail("batch_too_large", `Se firman como mucho ${MAX_SIGN_PER_CALL} partes por llamada.`);
    }
    const state = await ctx.runQuery(internal.media.uploadState, { mediaId });
    if (state.uploadId === null || state.uploadStatus !== "uploading") {
      throw fail("upload_state", "Esa subida no está en marcha.");
    }
    for (const n of partNumbers) {
      if (!Number.isInteger(n) || n < 1 || n > state.parts) {
        throw fail("invalid_argument", `La parte ${n} no existe en este archivo.`);
      }
    }
    const port = r2();
    const uploadId = state.uploadId;
    return await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await port.signPart(state.r2Key, uploadId, partNumber, URL_TTL_SEC),
      })),
    );
  },
});

export const completePart = mutation({
  args: { mediaId: v.id("media"), partNumber: v.number(), etag: v.string() },
  returns: v.null(),
  handler: async (ctx, { mediaId, partNumber, etag }) => {
    const media = await loadMedia(ctx, mediaId, "write");
    if (media.uploadStatus !== "uploading") {
      throw fail("upload_state", "Esa subida no está en marcha.");
    }
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount(media.bytes)) {
      throw fail("invalid_argument", `La parte ${partNumber} no existe en este archivo.`);
    }
    if (etag.trim() === "" || etag.length > 200) {
      throw fail("invalid_argument", "La etiqueta de la parte no es válida.");
    }
    // Una parte subida dos veces (reintento) se queda con la última etiqueta:
    // es la que R2 tiene guardada.
    const partsDone = media.partsDone
      .filter((p) => p.partNumber !== partNumber)
      .concat({ partNumber, etag: etag.trim() })
      .sort((a, b) => a.partNumber - b.partNumber);
    await ctx.db.patch(mediaId, { partsDone });
    return null;
  },
});

// ── Cerrar o cancelar ─────────────────────────────────────────────────────────

export const complete = action({
  args: { mediaId: v.id("media") },
  returns: v.null(),
  handler: async (ctx, { mediaId }): Promise<null> => {
    const state = await ctx.runQuery(internal.media.uploadState, { mediaId });
    if (state.uploadStatus === "done") return null;
    if (state.uploadId === null || state.uploadStatus !== "uploading") {
      throw fail("upload_state", "Esa subida no está en marcha.");
    }
    const missing: number[] = [];
    const have = new Set(state.partsDone.map((p) => p.partNumber));
    for (let n = 1; n <= state.parts; n++) if (!have.has(n)) missing.push(n);
    if (missing.length > 0) {
      throw fail(
        "upload_state",
        `Faltan partes por subir (${missing.length}). Sigue la subida antes de cerrarla.`,
      );
    }
    try {
      await r2().completeMultipart(state.r2Key, state.uploadId, state.partsDone);
    } catch (error) {
      // No se marca error: las partes siguen en R2 y cerrar se puede reintentar.
      console.error("R2 CompleteMultipartUpload", String(error));
      throw fail("storage_error", "No se pudo cerrar la subida. Prueba otra vez.");
    }
    await ctx.runMutation(internal.media.markDone, { mediaId });
    return null;
  },
});

export const markDone = internalMutation({
  args: { mediaId: v.id("media") },
  returns: v.null(),
  handler: async (ctx, { mediaId }) => {
    const media = await ctx.db.get(mediaId);
    if (media === null) throw notFound();
    await ctx.db.patch(mediaId, {
      uploadStatus: "done",
      uploadId: undefined,
      completedAt: Date.now(),
      error: undefined,
    });
    // Ahora sí: la versión anterior de este archivo deja de verse.
    const siblings = await ctx.db
      .query("media")
      .withIndex("by_interview_id_and_kind", (q) =>
        q.eq("interviewId", media.interviewId).eq("kind", media.kind),
      )
      .collect();
    await retireOthers(ctx, siblings, mediaId);
    return null;
  },
});

export const abort = action({
  args: { mediaId: v.id("media") },
  returns: v.null(),
  handler: async (ctx, { mediaId }): Promise<null> => {
    const state = await ctx.runQuery(internal.media.uploadState, { mediaId });
    if (state.uploadStatus === "done") {
      throw fail("upload_state", "Esa subida ya terminó: no se puede cancelar.");
    }
    if (state.uploadId !== null) {
      await r2().abortMultipart(state.r2Key, state.uploadId).catch(() => undefined);
    }
    await ctx.runMutation(internal.media.markAborted, { mediaId });
    return null;
  },
});

export const markAborted = internalMutation({
  args: { mediaId: v.id("media") },
  returns: v.null(),
  handler: async (ctx, { mediaId }) => {
    await ctx.db.patch(mediaId, {
      uploadStatus: "error",
      error: "cancelada",
      uploadId: undefined,
      deletedAt: Date.now(),
    });
    return null;
  },
});

// ── Ver ───────────────────────────────────────────────────────────────────────

export const listForInterview = query({
  args: { interviewId: v.id("interview") },
  returns: v.array(mediaSummary),
  handler: async (ctx, { interviewId }) => {
    await requireAccess(ctx, { interviewId }, "read");
    return await mediaFor(ctx.db, interviewId);
  },
});

/**
 * Comprueba quién pide reproducir y lo apunta. Con `shareToken`, vale un enlace
 * de cliente vivo de esa misma llamada; sin él, un member con lectura.
 */
export const authorizePlayback = internalMutation({
  args: { mediaId: v.id("media"), shareToken: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, { mediaId, shareToken }) => {
    const now = Date.now();
    const media = await ctx.db.get(mediaId);
    if (shareToken !== undefined) {
      const live = await liveShareLink(ctx.db, shareToken, now);
      // Caducado, revocado o de otra llamada: lo mismo que si no existiera.
      if (
        live === null ||
        media === null ||
        media.deletedAt !== undefined ||
        media.interviewId !== live.link.interviewId
      ) {
        throw notFound();
      }
      if (!(await takeRateLimit(ctx, `media.play:${live.link._id}`, PLAYS_PER_MINUTE, now))) {
        throw fail("rate_limited", "Demasiadas peticiones. Espera un minuto.");
      }
      if (media.uploadStatus !== "done") throw fail("upload_state", "El archivo aún se está subiendo.");
      await ctx.db.insert("accessLog", {
        workspaceId: media.workspaceId,
        interviewId: media.interviewId,
        shareLinkId: live.link._id,
        action: "play_media",
        at: now,
      });
      return media.r2Key;
    }
    if (media === null || media.deletedAt !== undefined) throw notFound();
    const { member } = await requireAccess(ctx, { interviewId: media.interviewId }, "read");
    if (media.uploadStatus !== "done") throw fail("upload_state", "El archivo aún se está subiendo.");
    await ctx.db.insert("accessLog", {
      workspaceId: media.workspaceId,
      interviewId: media.interviewId,
      memberId: member._id,
      action: "play_media",
      at: now,
    });
    return media.r2Key;
  },
});

export const playbackUrl = action({
  args: { mediaId: v.id("media"), shareToken: v.optional(v.string()) },
  returns: v.object({ url: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args): Promise<{ url: string; expiresAt: number }> => {
    const r2Key = await ctx.runMutation(internal.media.authorizePlayback, args);
    const expiresAt = Date.now() + URL_TTL_SEC * 1000;
    const url = await r2().signGet(r2Key, URL_TTL_SEC);
    return { url, expiresAt };
  },
});
