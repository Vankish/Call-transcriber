import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { permits } from "./requireAccess";
import { setup } from "./test.helpers";

const p = (id: string) => id as Id<"project">;
const member = (role: "owner" | "admin" | "editor" | "coach", projectIds: string[] = []) => ({
  role,
  status: "active" as const,
  projectIds: projectIds.map(p),
});

describe("la matriz de permisos", () => {
  test("owner y admin llegan a todo; editor y coach solo a sus proyectos", () => {
    for (const role of ["owner", "admin"] as const) {
      for (const need of ["read", "comment", "write", "manage"] as const) {
        expect(permits(member(role), p("x"), need)).toBe(true);
        expect(permits(member(role), null, need)).toBe(true);
      }
    }
    const editor = member("editor", ["a"]);
    expect(permits(editor, p("a"), "write")).toBe(true);
    expect(permits(editor, p("a"), "comment")).toBe(true);
    expect(permits(editor, p("b"), "read")).toBe(false);
    expect(permits(editor, null, "manage")).toBe(false);

    const coach = member("coach", ["a"]);
    expect(permits(coach, p("a"), "read")).toBe(true);
    expect(permits(coach, p("a"), "comment")).toBe(true);
    expect(permits(coach, p("a"), "write")).toBe(false);
    expect(permits(coach, p("b"), "read")).toBe(false);
  });

  test("un member desactivado no llega a nada", () => {
    expect(permits({ ...member("owner"), status: "disabled" }, p("a"), "read")).toBe(false);
  });
});

describe("coach", () => {
  test("ve y comenta su proyecto, pero no otro fuera de sus projectIds", async () => {
    const h = await setup();
    const o = await h.owner();
    const coach = await h.invited(o.as, "coach@example.com", "coach", [o.p1]);

    const seen = await coach.as.query(api.viewer.interview, { interviewId: o.i1 });
    expect(seen.access).toEqual({ role: "coach", canComment: true, canWrite: false });
    await coach.as.mutation(api.comment.add, { interviewId: o.i1, body: "Bien", atSec: 12 });

    await expect(coach.as.query(api.viewer.interview, { interviewId: o.i2 })).rejects.toThrow(
      /No existe o no tienes acceso/,
    );
    await expect(
      coach.as.mutation(api.comment.add, { interviewId: o.i2, body: "x" }),
    ).rejects.toThrow(/No existe o no tienes acceso/);
    await expect(coach.as.query(api.media.listForInterview, { interviewId: o.i2 })).rejects.toThrow(
      /No existe o no tienes acceso/,
    );

    const list = await coach.as.query(api.viewer.myInterviews, {});
    expect(list.map((i) => i._id)).toEqual([o.i1]);
  });

  test("no crea enlaces de cliente ni invita", async () => {
    const h = await setup();
    const o = await h.owner();
    const coach = await h.invited(o.as, "coach@example.com", "coach", [o.p1]);
    await expect(
      coach.as.mutation(api.share.create, { interviewId: o.i1, label: "Cliente" }),
    ).rejects.toThrow(/no cambiarlo/);
    await expect(
      coach.as.mutation(api.member.invite, {
        email: "otro@example.com",
        role: "coach",
        projectIds: [],
        workspaceId: o.workspaceId,
      }),
    ).rejects.toThrow(/Solo el dueño/);
  });
});

describe("editor", () => {
  test("no puede invitar ni cambiar personas", async () => {
    const h = await setup();
    const o = await h.owner();
    const editor = await h.invited(o.as, "editor@example.com", "editor", [o.p1]);
    await expect(
      editor.as.mutation(api.member.invite, {
        email: "otro@example.com",
        role: "coach",
        projectIds: [o.p1],
        workspaceId: o.workspaceId,
      }),
    ).rejects.toThrow(/Solo el dueño/);
    await expect(
      editor.as.query(api.member.list, { workspaceId: o.workspaceId }),
    ).rejects.toThrow(/Solo el dueño/);
    // Pero sí escribe en su proyecto: crea un enlace de cliente.
    const link = await editor.as.mutation(api.share.create, { interviewId: o.i1, label: "C" });
    expect(link.url).toMatch(/^https:\/\/web\.example\.com\/l\/[A-Za-z0-9_-]{43}$/);
  });
});

describe("admin", () => {
  test("invita en el espacio del que es admin, pero no toca al dueño", async () => {
    const h = await setup();
    const o = await h.owner();
    const admin = await h.invited(o.as, "admin@example.com", "admin", []);
    // Sin espacio propio, `member.*` usa el único en el que es admin.
    await admin.as.mutation(api.member.invite, {
      email: "coach@example.com",
      role: "coach",
      projectIds: [o.p2],
    });
    const { members, invitations } = await admin.as.query(api.member.list, {});
    expect(members.map((m) => m.role).sort()).toEqual(["admin", "owner"]);
    expect(invitations.map((i) => i.email)).toEqual(["coach@example.com"]);
    await expect(
      admin.as.mutation(api.member.update, { memberId: o.memberId, status: "disabled" }),
    ).rejects.toThrow(/No se puede cambiar al dueño/);
  });
});

describe("espacios separados", () => {
  test("nadie de otro espacio ve nada", async () => {
    const h = await setup();
    const a = await h.owner("a@example.com");
    const b = await h.owner("b@example.com");

    await expect(b.as.query(api.viewer.interview, { interviewId: a.i1 })).rejects.toThrow(
      /No existe o no tienes acceso/,
    );
    await expect(b.as.query(api.comment.list, { interviewId: a.i1 })).rejects.toThrow(
      /No existe o no tienes acceso/,
    );
    await expect(b.as.query(api.share.list, { interviewId: a.i1 })).rejects.toThrow(
      /No existe o no tienes acceso/,
    );
    await expect(
      b.as.query(api.member.list, { workspaceId: a.workspaceId }),
    ).rejects.toThrow(/No existe o no tienes acceso/);
    await expect(
      b.as.mutation(api.member.invite, {
        email: "x@example.com",
        role: "coach",
        projectIds: [b.p1],
        workspaceId: a.workspaceId,
      }),
    ).rejects.toThrow(/No existe o no tienes acceso/);
    // Ni colando un proyecto de otro espacio en su propia invitación.
    await expect(
      b.as.mutation(api.member.invite, { email: "x@example.com", role: "coach", projectIds: [a.p1] }),
    ).rejects.toThrow(/Alguno de esos proyectos no existe/);

    const list = await b.as.query(api.viewer.myInterviews, {});
    expect(list.every((i) => i.workspaceId === b.workspaceId)).toBe(true);

    // Su sync escribe en su espacio, aunque use los mismos localId.
    const pulled = await a.as.query(api.sync.pull, { since: 0 });
    expect(pulled.projects.map((x) => x.localId).sort()).toEqual(["p1", "p2"]);
  });

  test("sin sesión no se llega a nada", async () => {
    const h = await setup();
    const o = await h.owner();
    await expect(h.t.query(api.viewer.interview, { interviewId: o.i1 })).rejects.toThrow(
      /Inicia sesión/,
    );
    await expect(h.t.query(api.sync.pull, { since: 0 })).rejects.toThrow(/Inicia sesión/);
  });

  test("un member desactivado pierde el acceso", async () => {
    const h = await setup();
    const o = await h.owner();
    const coach = await h.invited(o.as, "coach@example.com", "coach", [o.p1]);
    const { members } = await o.as.query(api.member.list, {});
    const coachMember = members.find((m) => m.email === "coach@example.com")!;
    await o.as.mutation(api.member.update, { memberId: coachMember._id, status: "disabled" });
    await expect(coach.as.query(api.viewer.interview, { interviewId: o.i1 })).rejects.toThrow(
      /No existe o no tienes acceso/,
    );
  });

  test("lo borrado no se ve en la web", async () => {
    const h = await setup();
    const o = await h.owner();
    await o.as.mutation(api.sync.markDeleted, { kind: "project", localIds: ["p1"], deletedAt: Date.now() });
    await expect(o.as.query(api.viewer.interview, { interviewId: o.i1 })).rejects.toThrow(
      /No existe o no tienes acceso/,
    );
    const list = await o.as.query(api.viewer.myInterviews, {});
    expect(list.map((i) => i._id)).toEqual([o.i2]);
  });
});

describe("comentarios", () => {
  test("solo su autor edita o borra; resuelven autor, dueño o admin", async () => {
    const h = await setup();
    const o = await h.owner();
    const coach = await h.invited(o.as, "coach@example.com", "coach", [o.p1]);
    const editor = await h.invited(o.as, "editor@example.com", "editor", [o.p1]);
    const commentId = await coach.as.mutation(api.comment.add, { interviewId: o.i1, body: " Ojo aquí " });

    await expect(
      editor.as.mutation(api.comment.edit, { commentId, body: "cambiado" }),
    ).rejects.toThrow(/Solo quien escribió/);
    await expect(editor.as.mutation(api.comment.remove, { commentId })).rejects.toThrow(
      /Solo quien escribió/,
    );
    await expect(
      editor.as.mutation(api.comment.resolve, { commentId, resolved: true }),
    ).rejects.toThrow(/Solo quien lo escribió/);

    await coach.as.mutation(api.comment.edit, { commentId, body: "Ojo aquí, minuto 3" });
    await o.as.mutation(api.comment.resolve, { commentId, resolved: true });
    const [c] = await editor.as.query(api.comment.list, { interviewId: o.i1 });
    expect(c).toMatchObject({ body: "Ojo aquí, minuto 3", authorName: "coach", isMine: false });
    expect(c.resolvedAt).toBeTypeOf("number");

    await coach.as.mutation(api.comment.remove, { commentId });
    expect(await o.as.query(api.comment.list, { interviewId: o.i1 })).toEqual([]);
  });
});
