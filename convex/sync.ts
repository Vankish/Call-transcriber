import { v, type Infer } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { fail } from "./errors";
import { ownedWorkspace, requireAccess } from "./requireAccess";
import { requireUser } from "./requireUser";
import {
  candidateItem,
  interviewItem,
  projectItem,
  pulledCandidate,
  pulledInterview,
  pulledProject,
  syncResult,
  transcriptItem,
} from "./validators";

/**
 * Sincronización desde el escritorio (contrato, "Sincronización desde el
 * escritorio"). El PC es el original: aquí solo se guarda una copia, fila a
 * fila, con upsert por `localId` y gana la de `updatedAt` mayor.
 *
 * Decisiones que no están escritas en el contrato:
 * - Un empate de `updatedAt` se aplica (no se salta): reintentar un lote que ya
 *   llegó, porque se cortó la respuesta, tiene que salir como "aplicado".
 * - Lo borrado no resucita con un push: un `localId` no se reutiliza, así que
 *   un push a algo borrado solo puede ser un PC que aún no se ha enterado.
 * - Una fila cuyo padre no está arriba (un perfil sin su proyecto) se salta en
 *   vez de tirar el lote entero: así un huérfano local no bloquea al resto.
 */

const MAX_BATCH = 100;
// Un documento de Convex tiene un máximo de 1 MB: se deja margen para el resto
// de campos y para que el error sea nuestro y legible, no el del límite.
const MAX_TRANSCRIPT_CHARS = 900_000;
// Por página de `pull`. Las transcripciones pesan decenas de KB cada una: con
// 25 la respuesta se queda en unos pocos MB, lejos del límite de lectura.
const PULL_ROWS = 200;
const PULL_TRANSCRIPTS = 25;

type Db = QueryCtx["db"];

const checkBatch = (items: readonly unknown[]) => {
  if (items.length > MAX_BATCH) {
    throw fail(
      "batch_too_large",
      `Se suben como mucho ${MAX_BATCH} filas por llamada.`,
    );
  }
};

/** El espacio propio, con permiso de escritura. Es el único al que sube el PC. */
const requireSyncWorkspace = async (
  ctx: Pick<QueryCtx, "auth" | "db">,
): Promise<Id<"workspace">> => {
  const userId = await requireUser(ctx);
  const workspace = await ownedWorkspace(ctx.db, userId);
  if (workspace === null) {
    throw fail(
      "no_workspace",
      "Todavía no tienes un espacio en la nube: inicia sesión desde la app de escritorio.",
    );
  }
  await requireAccess(ctx, { workspaceId: workspace._id }, "write");
  return workspace._id;
};

type LocalTable = "project" | "candidate" | "interview";

const byLocalId = async <T extends LocalTable>(
  db: Db,
  table: T,
  workspaceId: Id<"workspace">,
  localId: string,
): Promise<Doc<T> | null> =>
  // Las tres tablas tienen el mismo índice con los mismos campos; TypeScript no
  // sabe verlo a través del genérico, de ahí el `as "project"`.
  (await db
    .query(table as "project")
    .withIndex("by_workspace_id_and_local_id", (q) =>
      q.eq("workspaceId", workspaceId).eq("localId", localId),
    )
    .unique()) as Doc<T> | null;

/** ¿Se aplica una fila que llega sobre la que ya hay? */
const wins = (
  existing: { updatedAt: number; deletedAt?: number } | null,
  incomingUpdatedAt: number,
): boolean =>
  existing === null ||
  (existing.deletedAt === undefined && incomingUpdatedAt >= existing.updatedAt);

export const pushProjects = mutation({
  args: { items: v.array(projectItem) },
  returns: syncResult,
  handler: async (ctx, { items }) => {
    checkBatch(items);
    const workspaceId = await requireSyncWorkspace(ctx);
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const item of items) {
      const existing = await byLocalId(ctx.db, "project", workspaceId, item.localId);
      if (!wins(existing, item.updatedAt)) {
        skipped.push(item.localId);
        continue;
      }
      if (existing === null) {
        await ctx.db.insert("project", { ...item, workspaceId });
      } else {
        await ctx.db.patch(existing._id, item);
      }
      applied.push(item.localId);
    }
    return { applied, skipped };
  },
});

export const pushCandidates = mutation({
  args: { items: v.array(candidateItem) },
  returns: syncResult,
  handler: async (ctx, { items }) => {
    checkBatch(items);
    const workspaceId = await requireSyncWorkspace(ctx);
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const { projectLocalId, ...item } of items) {
      const project = await byLocalId(ctx.db, "project", workspaceId, projectLocalId);
      const existing = await byLocalId(ctx.db, "candidate", workspaceId, item.localId);
      if (
        project === null ||
        project.deletedAt !== undefined ||
        !wins(existing, item.updatedAt)
      ) {
        skipped.push(item.localId);
        continue;
      }
      const row = { ...item, projectId: project._id };
      if (existing === null) {
        await ctx.db.insert("candidate", { ...row, workspaceId });
      } else {
        await ctx.db.patch(existing._id, row);
        if (existing.projectId !== project._id) {
          // Las entrevistas llevan su proyecto copiado (para los permisos de
          // coach y editor): si el perfil se movió de carpeta, se mueven con él.
          const interviews = await ctx.db
            .query("interview")
            .withIndex("by_candidate_id", (q) => q.eq("candidateId", existing._id))
            .collect();
          for (const interview of interviews) {
            await ctx.db.patch(interview._id, { projectId: project._id });
          }
        }
      }
      applied.push(item.localId);
    }
    return { applied, skipped };
  },
});

export const pushInterviews = mutation({
  args: { items: v.array(interviewItem) },
  returns: syncResult,
  handler: async (ctx, { items }) => {
    checkBatch(items);
    const workspaceId = await requireSyncWorkspace(ctx);
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const { candidateLocalId, ...item } of items) {
      const candidate = await byLocalId(ctx.db, "candidate", workspaceId, candidateLocalId);
      const existing = await byLocalId(ctx.db, "interview", workspaceId, item.localId);
      if (
        candidate === null ||
        candidate.deletedAt !== undefined ||
        !wins(existing, item.updatedAt)
      ) {
        skipped.push(item.localId);
        continue;
      }
      const row = { ...item, candidateId: candidate._id, projectId: candidate.projectId };
      if (existing === null) {
        await ctx.db.insert("interview", { ...row, workspaceId });
      } else {
        await ctx.db.patch(existing._id, row);
      }
      applied.push(item.localId);
    }
    return { applied, skipped };
  },
});

export const pushTranscript = mutation({
  args: transcriptItem.fields,
  returns: syncResult,
  handler: async (ctx, { interviewLocalId, ...item }) => {
    const workspaceId = await requireSyncWorkspace(ctx);
    const size =
      item.original.length +
      item.edited.length +
      (item.segments === undefined ? 0 : JSON.stringify(item.segments).length);
    if (size > MAX_TRANSCRIPT_CHARS) {
      throw fail("too_large", "La transcripción es demasiado larga para la nube.");
    }
    const interview = await byLocalId(ctx.db, "interview", workspaceId, interviewLocalId);
    if (interview === null || interview.deletedAt !== undefined) {
      return { applied: [], skipped: [interviewLocalId] };
    }
    const existing = await ctx.db
      .query("transcript")
      .withIndex("by_interview_id", (q) => q.eq("interviewId", interview._id))
      .unique();
    if (!wins(existing, item.updatedAt)) {
      return { applied: [], skipped: [interviewLocalId] };
    }
    if (existing === null) {
      await ctx.db.insert("transcript", {
        ...item,
        workspaceId,
        interviewId: interview._id,
      });
    } else {
      // `replace` y no `patch`: si el PC ya no manda `segments`, que no quede
      // el de antes desalineado con el texto nuevo.
      await ctx.db.replace(existing._id, {
        ...item,
        workspaceId,
        interviewId: interview._id,
      });
    }
    return { applied: [interviewLocalId], skipped: [] };
  },
});

/**
 * Borrar es ocultar. El borrado gana siempre, aunque la fila de arriba sea más
 * nueva: es una orden explícita, no un cambio que se pueda perder por la hora.
 * `updatedAt` sube hasta `deletedAt` para que `pull` lo lleve al otro PC.
 */
export const markDeleted = mutation({
  args: {
    kind: v.union(v.literal("project"), v.literal("candidate"), v.literal("interview")),
    localIds: v.array(v.string()),
    deletedAt: v.number(),
  },
  returns: syncResult,
  handler: async (ctx, { kind, localIds, deletedAt }) => {
    checkBatch(localIds);
    const workspaceId = await requireSyncWorkspace(ctx);
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const localId of localIds) {
      const row = await byLocalId(ctx.db, kind, workspaceId, localId);
      if (row === null) {
        skipped.push(localId);
        continue;
      }
      if (row.deletedAt === undefined) {
        await ctx.db.patch(row._id, {
          deletedAt,
          updatedAt: Math.max(row.updatedAt, deletedAt),
        });
      }
      applied.push(localId);
    }
    return { applied, skipped };
  },
});

const pulledTranscript = transcriptItem;

/**
 * Lo que cambió en el espacio desde `since`, para el segundo PC. Va por
 * páginas: si `hasMore`, se vuelve a llamar con `since: until`. Una fila puede
 * repetirse entre dos páginas (el upsert local la absorbe); ninguna se pierde.
 */
export const pull = query({
  args: { since: v.number() },
  returns: v.object({
    projects: v.array(pulledProject),
    candidates: v.array(pulledCandidate),
    interviews: v.array(pulledInterview),
    transcripts: v.array(pulledTranscript),
    until: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { since }) => {
    const workspaceId = await requireSyncWorkspace(ctx);
    const changed = <T extends "project" | "candidate" | "interview" | "transcript">(
      table: T,
      limit: number,
    ) =>
      ctx.db
        .query(table as "project")
        .withIndex("by_workspace_id_and_updated_at", (q) =>
          q.eq("workspaceId", workspaceId).gt("updatedAt", since),
        )
        .take(limit + 1) as unknown as Promise<Doc<T>[]>;

    const pages = {
      project: await changed("project", PULL_ROWS),
      candidate: await changed("candidate", PULL_ROWS),
      interview: await changed("interview", PULL_ROWS),
      transcript: await changed("transcript", PULL_TRANSCRIPTS),
    };
    const limits = {
      project: PULL_ROWS,
      candidate: PULL_ROWS,
      interview: PULL_ROWS,
      transcript: PULL_TRANSCRIPTS,
    };

    // Dónde cortar: en la tabla que se quedó sin sitio, un milisegundo antes de
    // su última fila, para que las que comparten ese mismo instante entren
    // todas en la página siguiente.
    let until = since;
    let cut = Number.POSITIVE_INFINITY;
    for (const table of Object.keys(pages) as (keyof typeof pages)[]) {
      const rows = pages[table];
      if (rows.length > limits[table]) {
        rows.length = limits[table];
        const last = rows[rows.length - 1].updatedAt;
        cut = Math.min(cut, last - 1 > since ? last - 1 : last);
      }
      for (const row of rows) until = Math.max(until, row.updatedAt);
    }
    const hasMore = cut !== Number.POSITIVE_INFINITY;
    if (hasMore) until = cut;

    const localIdOf = cachedLocalIds(ctx.db);
    const projects: Infer<typeof pulledProject>[] = pages.project.map(
      ({ _id, _creationTime, workspaceId: _w, ...row }) => row,
    );
    const candidates: Infer<typeof pulledCandidate>[] = [];
    for (const { _id, _creationTime, workspaceId: _w, projectId, ...row } of pages.candidate) {
      candidates.push({ ...row, projectLocalId: await localIdOf(projectId) });
    }
    const interviews: Infer<typeof pulledInterview>[] = [];
    for (const {
      _id,
      _creationTime,
      workspaceId: _w,
      projectId: _p,
      candidateId,
      ...row
    } of pages.interview) {
      interviews.push({ ...row, candidateLocalId: await localIdOf(candidateId) });
    }
    const transcripts: Infer<typeof pulledTranscript>[] = [];
    for (const t of pages.transcript) {
      transcripts.push({
        interviewLocalId: await localIdOf(t.interviewId),
        original: t.original,
        edited: t.edited,
        segments: t.segments,
        updatedAt: t.updatedAt,
      });
    }
    return { projects, candidates, interviews, transcripts, until, hasMore };
  },
});

// Los padres se repiten mucho en una página (veinte llamadas del mismo perfil):
// se leen una vez.
const cachedLocalIds = (db: Db) => {
  const cache = new Map<string, string>();
  return async (id: Id<"project"> | Id<"candidate"> | Id<"interview">) => {
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    const doc = await db.get(id);
    const localId = doc?.localId ?? "";
    cache.set(id, localId);
    return localId;
  };
};
