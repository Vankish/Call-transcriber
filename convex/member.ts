import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { acceptPendingInvitations } from "./admitSignIn";
import { fail, notFound } from "./errors";
import { looksLikeEmail, normalizeEmail } from "./normalizeEmail";
import { requireAccess, resolveWorkspaceId } from "./requireAccess";
import { invitationDoc, memberDoc, memberStatus } from "./validators";

/**
 * Quién entra en un espacio y con qué papel. Solo owner y admin.
 *
 * `workspaceId` es opcional y no está en el contrato: sin él se usa el espacio
 * propio (lo normal desde el escritorio). Un admin de otro espacio lo necesita
 * para decir de cuál habla.
 */

const MAX_PROJECTS = 500;

// Los proyectos que se dan a un coach o editor tienen que ser del mismo espacio:
// si no, una invitación podría colar acceso a proyectos de otro dueño.
const checkProjectIds = async (
  ctx: Pick<MutationCtx, "db">,
  workspaceId: Id<"workspace">,
  projectIds: Id<"project">[],
): Promise<Id<"project">[]> => {
  if (projectIds.length > MAX_PROJECTS) {
    throw fail("invalid_argument", "Demasiados proyectos en una invitación.");
  }
  const unique = [...new Set(projectIds)];
  for (const projectId of unique) {
    const project = await ctx.db.get(projectId);
    if (
      project === null ||
      project.workspaceId !== workspaceId ||
      project.deletedAt !== undefined
    ) {
      throw fail("invalid_argument", "Alguno de esos proyectos no existe.");
    }
  }
  return unique;
};

const assignableRole = v.union(
  v.literal("admin"),
  v.literal("editor"),
  v.literal("coach"),
);

export const invite = mutation({
  args: {
    email: v.string(),
    // El papel de dueño no se reparte: hay uno por espacio y es quien lo creó.
    role: assignableRole,
    projectIds: v.array(v.id("project")),
    workspaceId: v.optional(v.id("workspace")),
  },
  returns: v.id("invitation"),
  handler: async (ctx, args) => {
    const workspaceId = await resolveWorkspaceId(ctx, args.workspaceId);
    const { member: inviter } = await requireAccess(
      ctx,
      { workspaceId },
      "manage",
    );
    const email = normalizeEmail(args.email);
    if (!looksLikeEmail(email)) {
      throw fail("invalid_argument", "Ese correo no parece válido.");
    }
    const projectIds = await checkProjectIds(ctx, workspaceId, args.projectIds);

    const members = await ctx.db
      .query("member")
      .withIndex("by_workspace_id", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const already = members.find((m) => m.email === email);
    if (already !== undefined && already.status === "active") {
      throw fail("already_member", `${email} ya está en este espacio.`);
    }

    // Una sola invitación viva por correo y espacio: invitar otra vez corrige
    // el papel o los proyectos en vez de dejar dos que se pisen al aceptarse.
    const invitations = await ctx.db
      .query("invitation")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", email).eq("status", "pending"),
      )
      .collect();
    const open = invitations.find((i) => i.workspaceId === workspaceId);
    let invitationId: Id<"invitation">;
    if (open !== undefined) {
      await ctx.db.patch(open._id, {
        role: args.role,
        projectIds,
        invitedBy: inviter._id,
      });
      invitationId = open._id;
    } else {
      invitationId = await ctx.db.insert("invitation", {
        workspaceId,
        email,
        role: args.role,
        projectIds,
        invitedBy: inviter._id,
        status: "pending",
        createdAt: Date.now(),
      });
    }

    // Si esa persona ya tiene cuenta, el callback de entrada no volverá a
    // pasar hasta que cierre sesión: se acepta ya, que es lo que haría al entrar.
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (user !== null) {
      await acceptPendingInvitations(ctx.db, user._id, email, user.name ?? email);
    }
    return invitationId;
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("invitation") },
  returns: v.null(),
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get(invitationId);
    if (invitation === null) throw notFound();
    await requireAccess(ctx, { workspaceId: invitation.workspaceId }, "manage");
    if (invitation.status !== "pending") {
      throw fail("not_pending", "Esa invitación ya no está pendiente.");
    }
    await ctx.db.patch(invitationId, { status: "revoked" });
    return null;
  },
});

export const list = query({
  args: { workspaceId: v.optional(v.id("workspace")) },
  returns: v.object({
    members: v.array(memberDoc),
    invitations: v.array(invitationDoc),
  }),
  handler: async (ctx, args) => {
    const workspaceId = await resolveWorkspaceId(ctx, args.workspaceId);
    await requireAccess(ctx, { workspaceId }, "manage");
    const members = await ctx.db
      .query("member")
      .withIndex("by_workspace_id", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const invitations = await ctx.db
      .query("invitation")
      .withIndex("by_workspace_id", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return {
      members,
      invitations: invitations.filter((i) => i.status === "pending"),
    };
  },
});

export const update = mutation({
  args: {
    memberId: v.id("member"),
    role: v.optional(assignableRole),
    projectIds: v.optional(v.array(v.id("project"))),
    status: v.optional(memberStatus),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.memberId);
    if (target === null) throw notFound();
    await requireAccess(ctx, { workspaceId: target.workspaceId }, "manage");
    // El dueño no se degrada ni se desactiva: si no, el espacio se queda sin
    // nadie que pueda devolverle el acceso.
    if (target.role === "owner") {
      throw fail("owner_locked", "No se puede cambiar al dueño del espacio.");
    }
    const patch: {
      role?: typeof args.role;
      projectIds?: Id<"project">[];
      status?: typeof args.status;
    } = {};
    if (args.role !== undefined) patch.role = args.role;
    if (args.status !== undefined) patch.status = args.status;
    if (args.projectIds !== undefined) {
      patch.projectIds = await checkProjectIds(
        ctx,
        target.workspaceId,
        args.projectIds,
      );
    }
    await ctx.db.patch(args.memberId, patch);
    return null;
  },
});

