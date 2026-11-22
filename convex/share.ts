import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { fail, notFound } from "./errors";
import { interviewBundle } from "./interviewBundle";
import { takeRateLimit } from "./rateLimit";
import { requireAccess } from "./requireAccess";
import { liveShareLink, newShareToken, SHARE_LINK_MS, sha256Hex } from "./shareToken";
import {
  interviewDoc,
  mediaSummary,
  publicCandidate,
  publicProject,
  transcriptDoc,
} from "./validators";

/**
 * Enlaces de cliente: una sola llamada, solo lectura, sin cuenta, 7 días.
 *
 * El token sale una vez, en la respuesta de `create`, y aquí solo queda su
 * SHA-256. Crear, renovar y revocar pide permiso de escritura sobre la llamada
 * (dueño, admin o editor del proyecto): un coach no reparte enlaces.
 */

const MAX_LABEL = 200;
// Por enlace: de sobra para un cliente que recarga la página; poco para alguien
// que intenta descargarse la transcripción en bucle.
const OPENS_PER_MINUTE = 30;
// Para todos los tokens que no existen juntos: el token es imposible de
// adivinar, pero así ni siquiera sale gratis probar.
const MISSES_PER_MINUTE = 120;

const webUrl = (): string => {
  const raw = process.env.WEB_URL;
  if (raw === undefined || raw.trim() === "") {
    throw fail("not_configured", "Falta configurar WEB_URL en el despliegue.");
  }
  return raw.trim().replace(/\/+$/, "");
};

const loadLink = async (
  ctx: Pick<QueryCtx, "auth" | "db">,
  shareLinkId: Id<"shareLink">,
) => {
  const link = await ctx.db.get(shareLinkId);
  if (link === null) throw notFound();
  await requireAccess(ctx, { interviewId: link.interviewId }, "write");
  return link;
};

export const create = mutation({
  args: { interviewId: v.id("interview"), label: v.string() },
  returns: v.object({
    shareLinkId: v.id("shareLink"),
    url: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, { interviewId, label }) => {
    const { member, workspaceId } = await requireAccess(ctx, { interviewId }, "write");
    const base = webUrl();
    const cleanLabel = label.trim().slice(0, MAX_LABEL);
    const token = newShareToken();
    const now = Date.now();
    const expiresAt = now + SHARE_LINK_MS;
    const shareLinkId = await ctx.db.insert("shareLink", {
      workspaceId,
      interviewId,
      tokenHash: await sha256Hex(token),
      createdBy: member._id,
      label: cleanLabel,
      expiresAt,
      openCount: 0,
      createdAt: now,
    });
    return { shareLinkId, url: `${base}/l/${token}`, expiresAt };
  },
});

/** Otros 7 días desde ahora. Un enlace revocado no vuelve: se crea otro. */
export const renew = mutation({
  args: { shareLinkId: v.id("shareLink") },
  returns: v.object({ expiresAt: v.number() }),
  handler: async (ctx, { shareLinkId }) => {
    const link = await loadLink(ctx, shareLinkId);
    if (link.revokedAt !== undefined) {
      throw fail("invalid_argument", "Ese enlace está revocado: crea uno nuevo.");
    }
    const expiresAt = Date.now() + SHARE_LINK_MS;
    await ctx.db.patch(shareLinkId, { expiresAt });
    return { expiresAt };
  },
});

export const revoke = mutation({
  args: { shareLinkId: v.id("shareLink") },
  returns: v.null(),
  handler: async (ctx, { shareLinkId }) => {
    const link = await loadLink(ctx, shareLinkId);
    if (link.revokedAt === undefined) {
      await ctx.db.patch(shareLinkId, { revokedAt: Date.now() });
    }
    return null;
  },
});

export const list = query({
  args: { interviewId: v.id("interview") },
  returns: v.array(
    v.object({
      _id: v.id("shareLink"),
      label: v.string(),
      createdBy: v.id("member"),
      createdAt: v.number(),
      expiresAt: v.number(),
      revokedAt: v.optional(v.number()),
      openCount: v.number(),
      lastOpenedAt: v.optional(v.number()),
      active: v.boolean(),
    }),
  ),
  handler: async (ctx, { interviewId }) => {
    await requireAccess(ctx, { interviewId }, "write");
    const now = Date.now();
    const links = await ctx.db
      .query("shareLink")
      .withIndex("by_interview_id", (q) => q.eq("interviewId", interviewId))
      .collect();
    // Nunca sale el hash: no abre nada, pero tampoco hace falta enseñarlo.
    return links.map((l) => ({
      _id: l._id,
      label: l.label,
      createdBy: l.createdBy,
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      revokedAt: l.revokedAt,
      openCount: l.openCount,
      lastOpenedAt: l.lastOpenedAt,
      active: l.revokedAt === undefined && l.expiresAt > now,
    }));
  },
});

/**
 * La página `/l/{token}`. Pública y sin sesión. Es mutación, no consulta,
 * porque apunta la visita y lleva la cuenta del límite de peticiones (una
 * consulta no puede escribir). Devuelve lo mismo que `viewer.interview` menos
 * comentarios y datos de contacto del perfil.
 */
export const open = mutation({
  args: { token: v.string() },
  returns: v.union(
    v.object({ expired: v.literal(true) }),
    v.object({
      expired: v.literal(false),
      interview: interviewDoc,
      candidate: publicCandidate,
      project: publicProject,
      transcript: v.union(transcriptDoc, v.null()),
      media: v.array(mediaSummary),
      expiresAt: v.number(),
    }),
  ),
  handler: async (ctx, { token }) => {
    const now = Date.now();
    const live = await liveShareLink(ctx.db, token, now);
    if (live === null) {
      if (!(await takeRateLimit(ctx, "share.open:miss", MISSES_PER_MINUTE, now))) {
        throw fail("rate_limited", "Demasiados intentos. Espera un minuto.");
      }
      return { expired: true as const };
    }
    const { link, interview } = live;
    if (!(await takeRateLimit(ctx, `share.open:${link._id}`, OPENS_PER_MINUTE, now))) {
      throw fail("rate_limited", "Demasiadas peticiones. Espera un minuto.");
    }
    const bundle = await interviewBundle(ctx.db, interview);
    if (
      bundle === null ||
      bundle.candidate.deletedAt !== undefined ||
      bundle.project.deletedAt !== undefined
    ) {
      return { expired: true as const };
    }
    await ctx.db.patch(link._id, { openCount: link.openCount + 1, lastOpenedAt: now });
    await ctx.db.insert("accessLog", {
      workspaceId: link.workspaceId,
      interviewId: interview._id,
      shareLinkId: link._id,
      action: "view",
      at: now,
    });
    const { candidate, project } = bundle;
    return {
      expired: false as const,
      interview,
      candidate: { _id: candidate._id, name: candidate.name, role: candidate.role },
      project: { _id: project._id, name: project.name, company: project.company, kind: project.kind },
      transcript: bundle.transcript,
      media: bundle.media,
      expiresAt: link.expiresAt,
    };
  },
});
