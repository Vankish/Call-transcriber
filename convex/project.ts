import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { notFound } from "./errors";
import { activeMemberOf, permits } from "./requireAccess";
import { requireUser } from "./requireUser";

/**
 * Los proyectos (carpetas) a los que llega quien pregunta, para el filtro de la
 * lista de la web y para elegir a qué proyectos se da acceso al invitar. No
 * estaba en el contrato: sin esto la web solo podía deducirlos de las llamadas,
 * y una carpeta todavía sin llamadas no salía.
 *
 * Con `workspaceId`, los de ese espacio; sin él, los de todos en los que se está.
 */
export const list = query({
  args: { workspaceId: v.optional(v.id("workspace")) },
  returns: v.array(
    v.object({
      _id: v.id("project"),
      workspaceId: v.id("workspace"),
      name: v.string(),
      company: v.string(),
      kind: v.union(v.literal("entrevistas"), v.literal("clientes")),
      status: v.union(v.literal("active"), v.literal("closed")),
    }),
  ),
  handler: async (ctx, { workspaceId }) => {
    const userId = await requireUser(ctx);
    // Aquí no vale `requireAccess` a nivel de espacio: un coach o un editor no
    // tienen lectura "de espacio", solo de sus proyectos. Basta con ser member
    // activo; qué proyectos ve lo decide `permits`, la misma matriz de siempre.
    let members: Doc<"member">[];
    if (workspaceId !== undefined) {
      const member = await activeMemberOf(ctx.db, workspaceId, userId);
      if (member === null) throw notFound();
      members = [member];
    } else {
      members = (
        await ctx.db
          .query("member")
          .withIndex("by_user_id", (q) => q.eq("userId", userId))
          .collect()
      ).filter((m) => m.status === "active");
    }

    const result = [];
    for (const member of members) {
      const projects: Doc<"project">[] = await ctx.db
        .query("project")
        .withIndex("by_workspace_id", (q) => q.eq("workspaceId", member.workspaceId))
        .collect();
      for (const p of projects) {
        if (p.deletedAt !== undefined || !permits(member, p._id, "read")) continue;
        result.push({
          _id: p._id,
          workspaceId: p.workspaceId,
          name: p.name,
          company: p.company,
          kind: p.kind,
          status: p.status,
        });
      }
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  },
});
