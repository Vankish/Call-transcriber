import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { fail } from "./errors";
import { activeMemberOf, ownedWorkspace } from "./requireAccess";
import { requireUser } from "./requireUser";
import { memberRole } from "./validators";

/**
 * El espacio propio. Lo crea la app de escritorio la primera vez que inicia
 * sesión: es el sitio donde sube sus proyectos. Un coach que solo usa la web no
 * lo llama nunca y por eso nunca tiene uno.
 */
export const ensureMine = mutation({
  args: {},
  returns: v.object({ workspaceId: v.id("workspace"), memberId: v.id("member") }),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const user = await ctx.db.get(userId);
    if (user === null) throw fail("unauthenticated", "Inicia sesión primero.");
    const email = user.email ?? "";
    const name = user.name?.trim() || email;
    const now = Date.now();

    const existing = await ownedWorkspace(ctx.db, userId);
    const workspaceId =
      existing?._id ??
      (await ctx.db.insert("workspace", {
        name: name ? `Espacio de ${name}` : "Mi espacio",
        ownerUserId: userId,
        createdAt: now,
      }));

    const member = await ctx.db
      .query("member")
      .withIndex("by_workspace_id_and_user_id", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .unique();
    if (member !== null) {
      // El dueño no puede quedarse fuera de su propio espacio.
      if (member.role !== "owner" || member.status !== "active") {
        await ctx.db.patch(member._id, { role: "owner", status: "active" });
      }
      return { workspaceId, memberId: member._id };
    }
    const memberId = await ctx.db.insert("member", {
      workspaceId,
      userId,
      email,
      name,
      role: "owner",
      status: "active",
      projectIds: [],
      createdAt: now,
    });
    return { workspaceId, memberId };
  },
});

/** El espacio propio, si ya existe. */
export const mine = query({
  args: {},
  returns: v.union(
    v.object({
      workspaceId: v.id("workspace"),
      memberId: v.id("member"),
      role: memberRole,
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const workspace = await ownedWorkspace(ctx.db, userId);
    if (workspace === null) return null;
    const member = await activeMemberOf(ctx.db, workspace._id, userId);
    if (member === null) return null;
    return { workspaceId: workspace._id, memberId: member._id, role: member.role };
  },
});

/** Todos los espacios en los que se está activo: un coach puede estar en varios. */
export const memberships = query({
  args: {},
  returns: v.array(
    v.object({
      workspaceId: v.id("workspace"),
      workspaceName: v.string(),
      role: memberRole,
      projectIds: v.array(v.id("project")),
    }),
  ),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const members = await ctx.db
      .query("member")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .collect();
    const result = [];
    for (const member of members) {
      if (member.status !== "active") continue;
      const workspace = await ctx.db.get(member.workspaceId);
      if (workspace === null) continue;
      result.push({
        workspaceId: workspace._id,
        workspaceName: workspace.name,
        role: member.role,
        projectIds: member.projectIds,
      });
    }
    return result;
  },
});
