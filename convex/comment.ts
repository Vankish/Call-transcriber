import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { fail, notFound } from "./errors";
import { requireAccess, type Access } from "./requireAccess";

/**
 * Comentarios de coaches y compañeros sobre una llamada, pegados a un segundo
 * del vídeo o generales. Un enlace de cliente no los ve ni los escribe.
 */

const MAX_BODY = 5000;

const cleanBody = (raw: string): string => {
  const body = raw.trim();
  if (body === "") throw fail("invalid_argument", "El comentario está vacío.");
  if (body.length > MAX_BODY) {
    throw fail("invalid_argument", `Un comentario tiene como mucho ${MAX_BODY} caracteres.`);
  }
  return body;
};

const commentView = v.object({
  _id: v.id("comment"),
  interviewId: v.id("interview"),
  authorMemberId: v.id("member"),
  authorName: v.string(),
  atSec: v.optional(v.number()),
  body: v.string(),
  parentId: v.optional(v.id("comment")),
  resolvedAt: v.optional(v.number()),
  createdAt: v.number(),
  editedAt: v.optional(v.number()),
  mine: v.boolean(),
});

export const list = query({
  args: { interviewId: v.id("interview") },
  returns: v.array(commentView),
  handler: async (ctx, { interviewId }) => {
    const { member } = await requireAccess(ctx, { interviewId }, "read");
    const rows = await ctx.db
      .query("comment")
      .withIndex("by_interview_id_and_created_at", (q) => q.eq("interviewId", interviewId))
      .collect();
    const names = new Map<string, string>();
    const result = [];
    for (const c of rows) {
      if (c.deletedAt !== undefined) continue;
      let authorName = names.get(c.authorMemberId);
      if (authorName === undefined) {
        const author = await ctx.db.get(c.authorMemberId);
        authorName = author?.name ?? "";
        names.set(c.authorMemberId, authorName);
      }
      result.push({
        _id: c._id,
        interviewId: c.interviewId,
        authorMemberId: c.authorMemberId,
        authorName,
        atSec: c.atSec,
        body: c.body,
        parentId: c.parentId,
        resolvedAt: c.resolvedAt,
        createdAt: c.createdAt,
        editedAt: c.editedAt,
        mine: c.authorMemberId === member._id,
      });
    }
    return result;
  },
});

export const add = mutation({
  args: {
    interviewId: v.id("interview"),
    body: v.string(),
    atSec: v.optional(v.number()),
    parentId: v.optional(v.id("comment")),
  },
  returns: v.id("comment"),
  handler: async (ctx, args) => {
    const { member, workspaceId } = await requireAccess(
      ctx,
      { interviewId: args.interviewId },
      "comment",
    );
    const body = cleanBody(args.body);
    if (args.atSec !== undefined && (!Number.isFinite(args.atSec) || args.atSec < 0)) {
      throw fail("invalid_argument", "El segundo del comentario no es válido.");
    }
    if (args.parentId !== undefined) {
      // Una respuesta solo puede colgar de un comentario de esta misma llamada.
      const parent = await ctx.db.get(args.parentId);
      if (
        parent === null ||
        parent.interviewId !== args.interviewId ||
        parent.deletedAt !== undefined
      ) {
        throw notFound();
      }
    }
    return await ctx.db.insert("comment", {
      workspaceId,
      interviewId: args.interviewId,
      authorMemberId: member._id,
      atSec: args.atSec,
      body,
      parentId: args.parentId,
      createdAt: Date.now(),
    });
  },
});

/** El comentario y el acceso de quien llama a su llamada. */
const loadComment = async (
  ctx: Pick<QueryCtx, "auth" | "db">,
  commentId: Doc<"comment">["_id"],
): Promise<{ comment: Doc<"comment">; access: Access }> => {
  const comment = await ctx.db.get(commentId);
  if (comment === null || comment.deletedAt !== undefined) throw notFound();
  const access = await requireAccess(ctx, { interviewId: comment.interviewId }, "comment");
  return { comment, access };
};

const onlyAuthor = () =>
  fail("forbidden", "Solo quien escribió el comentario puede cambiarlo.");

export const edit = mutation({
  args: { commentId: v.id("comment"), body: v.string() },
  returns: v.null(),
  handler: async (ctx, { commentId, body }) => {
    const { comment, access } = await loadComment(ctx, commentId);
    if (comment.authorMemberId !== access.member._id) throw onlyAuthor();
    await ctx.db.patch(commentId, { body: cleanBody(body), editedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { commentId: v.id("comment") },
  returns: v.null(),
  handler: async (ctx, { commentId }) => {
    const { comment, access } = await loadComment(ctx, commentId);
    if (comment.authorMemberId !== access.member._id) throw onlyAuthor();
    await ctx.db.patch(commentId, { deletedAt: Date.now() });
    return null;
  },
});

export const resolve = mutation({
  args: { commentId: v.id("comment"), resolved: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { commentId, resolved }) => {
    const { comment, access } = await loadComment(ctx, commentId);
    const { role, _id } = access.member;
    if (comment.authorMemberId !== _id && role !== "owner" && role !== "admin") {
      throw fail(
        "forbidden",
        "Solo quien lo escribió, el dueño o un administrador pueden resolverlo.",
      );
    }
    await ctx.db.patch(commentId, { resolvedAt: resolved ? Date.now() : undefined });
    return null;
  },
});
