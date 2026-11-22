import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { normalizeEmail } from "./normalizeEmail";

type Db = MutationCtx["db"];

/**
 * Lo que pasa cada vez que alguien entra (callback de Convex Auth, como
 * `admitSignIn` en el CRM de Orbit). A diferencia de Orbit, aquí entrar nunca
 * se rechaza: cualquiera puede tener cuenta, porque la cuenta sola no abre
 * nada. Lo que abre es un `member` activo, y ese solo nace de una invitación
 * del dueño de un espacio.
 *
 * Por eso aquí solo se aceptan las invitaciones `pending` de ese correo.
 */
export const admitSignIn = async (
  db: Db,
  userId: Id<"users">,
  rawEmail: string | null,
  profileName: string | null = null,
): Promise<void> => {
  if (rawEmail === null) return;
  const email = normalizeEmail(rawEmail);
  if (email === "") return;
  const name = profileName?.trim() || email;
  await acceptPendingInvitations(db, userId, email, name);
};

/**
 * Pasa a `member` cada invitación pendiente de ese correo. Se usa al entrar y
 * también al invitar a alguien que ya tenía cuenta (si no, tendría que salir y
 * volver a entrar para que le llegase).
 */
export const acceptPendingInvitations = async (
  db: Db,
  userId: Id<"users">,
  email: string,
  name: string,
): Promise<Id<"member">[]> => {
  const pending = await db
    .query("invitation")
    .withIndex("by_email_and_status", (q) =>
      q.eq("email", email).eq("status", "pending"),
    )
    .collect();
  const accepted: Id<"member">[] = [];
  for (const invitation of pending) {
    accepted.push(await acceptInvitation(db, invitation, userId, name));
  }
  return accepted;
};

const acceptInvitation = async (
  db: Db,
  invitation: Doc<"invitation">,
  userId: Id<"users">,
  name: string,
): Promise<Id<"member">> => {
  const now = Date.now();
  const existing = await db
    .query("member")
    .withIndex("by_workspace_id_and_user_id", (q) =>
      q.eq("workspaceId", invitation.workspaceId).eq("userId", userId),
    )
    .unique();
  await db.patch(invitation._id, { status: "accepted" });
  if (existing !== null) {
    // Ya estaba (p. ej. lo desactivaron y lo vuelven a invitar): la invitación
    // nueva manda, salvo con el dueño, cuyo papel no se toca nunca.
    if (existing.role !== "owner") {
      await db.patch(existing._id, {
        role: invitation.role,
        projectIds: invitation.projectIds,
        status: "active",
      });
    }
    return existing._id;
  }
  return await db.insert("member", {
    workspaceId: invitation.workspaceId,
    userId,
    email: invitation.email,
    name,
    role: invitation.role,
    status: "active",
    projectIds: invitation.projectIds,
    invitedBy: invitation.invitedBy,
    createdAt: now,
  });
};
