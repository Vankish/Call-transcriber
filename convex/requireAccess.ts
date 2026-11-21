import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { fail, notFound } from "./errors";
import { requireUser } from "./requireUser";

/**
 * El único sitio donde se decide quién llega a qué (docs/nube/CONTRATO.md,
 * "Personas y permisos"). Toda función pública con sesión empieza aquí, igual
 * que `getAccessContext` + `loadRecord` en el CRM de Orbit: nunca se confía en
 * un id que mande el cliente sin pasar por este ayudante.
 *
 * - `read`: ver la llamada, su transcripción y sus archivos.
 * - `comment`: además, comentar. Coach, editor, admin y owner.
 * - `write`: cambiar datos. Editor (en sus proyectos), admin y owner.
 * - `manage`: repartir accesos y enlaces de espacio. Solo owner y admin.
 */
export type Need = "read" | "comment" | "write" | "manage";

export type Target =
  | { interviewId: Id<"interview"> }
  | { projectId: Id<"project"> }
  | { workspaceId: Id<"workspace"> };

export type Access = {
  userId: Id<"users">;
  member: Doc<"member">;
  workspaceId: Id<"workspace">;
  project: Doc<"project"> | null;
  interview: Doc<"interview"> | null;
};

type Db = Pick<QueryCtx, "db">["db"];

/**
 * La matriz de permisos, sin base de datos de por medio para poder probarla
 * sola. `projectId` es null cuando se pide algo del espacio entero (personas,
 * sincronización): ahí editor y coach no llegan, porque solo ven proyectos.
 */
export const permits = (
  member: Pick<Doc<"member">, "role" | "status" | "projectIds">,
  projectId: Id<"project"> | null,
  need: Need,
): boolean => {
  if (member.status !== "active") return false;
  if (member.role === "owner" || member.role === "admin") return true;
  if (need === "manage" || projectId === null) return false;
  if (!member.projectIds.includes(projectId)) return false;
  if (member.role === "editor") return true;
  // coach: lee y comenta, no edita.
  return need === "read" || need === "comment";
};

/** El member activo de `userId` en ese espacio, o null. */
export const activeMemberOf = async (
  db: Db,
  workspaceId: Id<"workspace">,
  userId: Id<"users">,
): Promise<Doc<"member"> | null> => {
  const member = await db
    .query("member")
    .withIndex("by_workspace_id_and_user_id", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", userId),
    )
    .unique();
  return member !== null && member.status === "active" ? member : null;
};

const deniedFor = (need: Need) => {
  if (need === "write") {
    return fail("read_only", "Puedes ver esto, pero no cambiarlo.");
  }
  if (need === "comment") {
    return fail("forbidden", "No puedes comentar en esta llamada.");
  }
  return fail(
    "forbidden",
    "Solo el dueño del espacio o un administrador pueden hacer esto.",
  );
};

/**
 * Carga lo que se pide, comprueba que quien llama llega y devuelve el contexto.
 * Lo borrado (la llamada, su perfil o su proyecto) se trata como inexistente.
 */
export const requireAccess = async (
  ctx: Pick<QueryCtx, "auth" | "db">,
  target: Target,
  need: Need,
): Promise<Access> => {
  const userId = await requireUser(ctx);
  let workspaceId: Id<"workspace">;
  let project: Doc<"project"> | null = null;
  let interview: Doc<"interview"> | null = null;

  if ("interviewId" in target) {
    interview = await ctx.db.get(target.interviewId);
    if (interview === null || interview.deletedAt !== undefined) {
      throw notFound();
    }
    const candidate = await ctx.db.get(interview.candidateId);
    if (candidate === null || candidate.deletedAt !== undefined) {
      throw notFound();
    }
    project = await ctx.db.get(interview.projectId);
    if (project === null || project.deletedAt !== undefined) throw notFound();
    workspaceId = interview.workspaceId;
  } else if ("projectId" in target) {
    project = await ctx.db.get(target.projectId);
    if (project === null || project.deletedAt !== undefined) throw notFound();
    workspaceId = project.workspaceId;
  } else {
    workspaceId = target.workspaceId;
  }

  const member = await activeMemberOf(ctx.db, workspaceId, userId);
  const projectId = project?._id ?? null;
  // Sin lectura no se distingue "no existe" de "no es tuyo".
  if (member === null) throw notFound();
  if (!permits(member, projectId, "read")) {
    // A nivel de espacio, un editor o un coach sí sabe que el espacio existe
    // (está dentro): le decimos que no puede, no que no existe.
    if (projectId === null) throw deniedFor(need);
    throw notFound();
  }
  if (!permits(member, projectId, need)) throw deniedFor(need);
  return { userId, member, workspaceId, project, interview };
};

/**
 * Qué espacio se quiere tocar cuando la función no recibe ninguno. El contrato
 * no pasa `workspaceId` a `member.*`: se usa el espacio propio y, si no hay,
 * el único en el que se es admin. Con varios hay que decir cuál.
 */
export const resolveWorkspaceId = async (
  ctx: Pick<QueryCtx, "auth" | "db">,
  workspaceId: Id<"workspace"> | undefined,
): Promise<Id<"workspace">> => {
  if (workspaceId !== undefined) return workspaceId;
  const userId = await requireUser(ctx);
  const owned = await ownedWorkspace(ctx.db, userId);
  if (owned !== null) return owned._id;
  const memberships = await ctx.db
    .query("member")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .collect();
  const admin = memberships.filter(
    (m) => m.status === "active" && m.role === "admin",
  );
  if (admin.length === 1) return admin[0].workspaceId;
  if (admin.length === 0) {
    throw fail("no_workspace", "Todavía no tienes un espacio propio.");
  }
  throw fail(
    "workspace_required",
    "Estás en varios espacios: elige en cuál quieres hacerlo.",
  );
};

/** El espacio del que se es dueño, o null. Uno por persona. */
export const ownedWorkspace = async (
  db: Db,
  userId: Id<"users">,
): Promise<Doc<"workspace"> | null> =>
  await db
    .query("workspace")
    .withIndex("by_owner_user_id", (q) => q.eq("ownerUserId", userId))
    .first();
