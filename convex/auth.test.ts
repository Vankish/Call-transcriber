import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { ConvexError } from "convex/values";
import { beforeAll, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { setup } from "./test.helpers";

/**
 * Entrar por primera vez acepta las invitaciones pendientes de ese correo, y
 * nada más: registrarse no da acceso a ningún espacio.
 */

// Convex Auth firma una sesión en cada entrada: hacen falta claves. Se generan
// para esta prueba y se tiran con ella; las de verdad van en el despliegue.
beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  process.env.JWT_PRIVATE_KEY = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] });
});

const PASSWORD = "una contraseña larga";

describe("entrar con correo y contraseña", () => {
  test("registrarse sin invitación no da acceso a nada", async () => {
    const h = await setup();
    await h.owner();
    await h.t.action(api.auth.signIn, {
      provider: "password",
      params: { email: "nadie@example.com", password: PASSWORD, flow: "signUp" },
    });
    const members = await h.t.run((ctx) => ctx.db.query("member").collect());
    expect(members.map((m) => m.email)).toEqual(["duena@example.com"]);
  });

  test("las invitaciones pendientes del correo se aceptan solas al entrar", async () => {
    const h = await setup();
    const o = await h.owner();
    const other = await h.owner("otra@example.com");
    await o.as.mutation(api.member.invite, {
      email: "  Coach@Example.com ",
      role: "coach",
      projectIds: [o.p1],
    });
    await other.as.mutation(api.member.invite, {
      email: "coach@example.com",
      role: "editor",
      projectIds: [other.p2],
    });
    // Una revocada no cuenta.
    const third = await h.owner("tercera@example.com");
    const revoked = await third.as.mutation(api.member.invite, {
      email: "coach@example.com",
      role: "coach",
      projectIds: [],
    });
    await third.as.mutation(api.member.revokeInvitation, { invitationId: revoked });

    await h.t.action(api.auth.signIn, {
      provider: "password",
      params: { email: "COACH@example.com", password: PASSWORD, flow: "signUp" },
    });
    const coachMembers = await h.t.run(async (ctx) =>
      (await ctx.db.query("member").collect()).filter((m) => m.email === "coach@example.com"),
    );
    expect(coachMembers.map((m) => [m.workspaceId, m.role, m.projectIds]).sort()).toEqual(
      [
        [o.workspaceId, "coach", [o.p1]],
        [other.workspaceId, "editor", [other.p2]],
      ].sort(),
    );
    const invitations = await h.t.run((ctx) => ctx.db.query("invitation").collect());
    expect(invitations.map((i) => i.status).sort()).toEqual(["accepted", "accepted", "revoked"]);
  });

  // La app distingue los fallos por `code` (en producción el mensaje de un
  // Error normal no llega).
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ConvexError) return (error.data as { code: string }).code;
      throw error;
    }
    throw new Error("debería haber fallado");
  };
  const password = (t: Awaited<ReturnType<typeof setup>>["t"], email: string, secret: string, flow: "signUp" | "signIn") =>
    t.action(api.auth.signIn, { provider: "password", params: { email, password: secret, flow } });

  test("los fallos de entrada llegan con su code", async () => {
    const h = await setup();
    expect(await codeOf(password(h.t, "x@example.com", "corta", "signUp"))).toBe("weak_password");
    await password(h.t, "x@example.com", PASSWORD, "signUp");
    // Registrarse otra vez con la misma contraseña es entrar (así lo hace Convex
    // Auth); con otra distinta, el correo ya está cogido.
    expect(await codeOf(password(h.t, "x@example.com", "otra contraseña", "signUp"))).toBe(
      "account_exists",
    );
    expect(await codeOf(password(h.t, "x@example.com", "otra contraseña", "signIn"))).toBe(
      "invalid_credentials",
    );
    // Un correo sin cuenta da lo mismo que una contraseña mal.
    expect(await codeOf(password(h.t, "nadie@example.com", PASSWORD, "signIn"))).toBe(
      "invalid_credentials",
    );
    expect(await password(h.t, "X@Example.com", PASSWORD, "signIn")).toBeDefined();
  });
});

describe("invitar a quien ya tiene cuenta", () => {
  test("entra en el espacio sin tener que volver a iniciar sesión", async () => {
    const h = await setup();
    const o = await h.owner();
    const coach = await h.signIn("coach@example.com");
    await expect(coach.as.query(api.viewer.interview, { interviewId: o.i1 })).rejects.toThrow();
    await o.as.mutation(api.member.invite, { email: "coach@example.com", role: "coach", projectIds: [o.p1] });
    const seen = await coach.as.query(api.viewer.interview, { interviewId: o.i1 });
    expect(seen.access.role).toBe("coach");
    await expect(
      o.as.mutation(api.member.invite, { email: "coach@example.com", role: "coach", projectIds: [] }),
    ).rejects.toThrow(/ya está en este espacio/);
  });

  test("un correo mal escrito no se invita y el papel de dueño no se reparte", async () => {
    const h = await setup();
    const o = await h.owner();
    await expect(
      o.as.mutation(api.member.invite, { email: "no-es-un-correo", role: "coach", projectIds: [] }),
    ).rejects.toThrow(/no parece válido/);
    await expect(
      o.as.mutation(api.member.invite, {
        email: "x@example.com",
        // @ts-expect-error: el validador no deja invitar como dueño
        role: "owner",
        projectIds: [],
      }),
    ).rejects.toThrow();
  });
});
