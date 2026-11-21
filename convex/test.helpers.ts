import { convexTest } from "convex-test";

import { admitSignIn } from "./admitSignIn";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

/**
 * Arnés de las pruebas del backend: un dueño con sesión, su espacio y una
 * carpeta con un perfil y una llamada subidos como lo haría el escritorio.
 */

process.env.WEB_URL ??= "https://web.example.com";
process.env.CONVEX_SITE_URL ??= "https://test.convex.site";
process.env.SITE_URL ??= "https://web.example.com";

export const T0 = 1_700_000_000_000;

export const project = (localId: string, updatedAt = T0) => ({
  localId,
  name: `Proyecto ${localId}`,
  company: "Acme",
  kind: "entrevistas" as const,
  status: "active" as const,
  evaluationCriteria: ["Comunicación"],
  interviewers: ["Ana"],
  createdAt: T0,
  updatedAt,
});

export const candidate = (localId: string, projectLocalId: string, updatedAt = T0) => ({
  localId,
  projectLocalId,
  name: `Perfil ${localId}`,
  email: `${localId}@cliente.com`,
  phone: "+34 600 000 000",
  role: "Backend",
  notes: "Notas privadas",
  candidateStatus: "pendiente" as const,
  consentGiven: true,
  consentAt: T0,
  crm: null,
  createdAt: T0,
  updatedAt,
});

export const interview = (localId: string, candidateLocalId: string, updatedAt = T0) => ({
  localId,
  candidateLocalId,
  sessionName: `Llamada ${localId}`,
  durationSec: 1800,
  captureSource: "mic+system" as const,
  interviewerName: "Ana",
  transcriptionStatus: "done" as const,
  summaryText: "Resumen",
  summaryType: "resumen" as const,
  summaryContext: "entrevista" as const,
  createdAt: T0,
  updatedAt,
});

export const setup = async () => {
  const t = convexTest(schema, modules);

  /** Alguien con cuenta: pasa por lo mismo que al entrar de verdad. */
  const signIn = async (email: string, name = email.split("@")[0]) => {
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { email, name });
      await admitSignIn(ctx.db, id, email, name);
      return id;
    });
    return { userId, as: t.withIdentity({ subject: `${userId}|session` }) };
  };

  type As = Awaited<ReturnType<typeof signIn>>["as"];

  /** Un dueño con su espacio y una carpeta (p1) con un perfil (c1) y una llamada (i1). */
  const owner = async (email = "duena@example.com") => {
    const user = await signIn(email, "Dueña");
    const { workspaceId, memberId } = await user.as.mutation(api.workspace.ensureMine, {});
    await user.as.mutation(api.sync.pushProjects, { items: [project("p1"), project("p2")] });
    await user.as.mutation(api.sync.pushCandidates, {
      items: [candidate("c1", "p1"), candidate("c2", "p2")],
    });
    await user.as.mutation(api.sync.pushInterviews, {
      items: [interview("i1", "c1"), interview("i2", "c2")],
    });
    await user.as.mutation(api.sync.pushTranscript, {
      interviewLocalId: "i1",
      original: "[Entrevistador] Hola",
      edited: "[Entrevistador] Hola",
      updatedAt: T0,
    });
    const ids = await t.run(async (ctx) => {
      const byLocal = async (table: "project" | "interview", localId: string) =>
        (await ctx.db
          .query(table as "project")
          .withIndex("by_workspace_id_and_local_id", (q) =>
            q.eq("workspaceId", workspaceId).eq("localId", localId),
          )
          .unique())!._id;
      return {
        p1: (await byLocal("project", "p1")) as Id<"project">,
        p2: (await byLocal("project", "p2")) as Id<"project">,
        i1: (await byLocal("interview", "i1")) as unknown as Id<"interview">,
        i2: (await byLocal("interview", "i2")) as unknown as Id<"interview">,
      };
    });
    return { ...user, workspaceId, memberId, ...ids };
  };

  /** Invita y hace entrar a alguien con ese papel. */
  const invited = async (
    by: As,
    email: string,
    role: "admin" | "editor" | "coach",
    projectIds: Id<"project">[],
  ) => {
    await by.mutation(api.member.invite, { email, role, projectIds });
    return await signIn(email);
  };

  return { t, signIn, owner, invited };
};
