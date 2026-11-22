import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { setup } from "./test.helpers";

describe("project.list", () => {
  test("el dueño ve todas las carpetas, también las que aún no tienen llamadas", async () => {
    const h = await setup();
    const o = await h.owner();
    await o.as.mutation(api.sync.pushProjects, {
      items: [{ localId: "vacia", name: "A vacía", company: "", kind: "clientes", status: "active", evaluationCriteria: [], interviewers: [], createdAt: 1, updatedAt: 1 }],
    });
    const list = await o.as.query(api.project.list, { workspaceId: o.workspaceId });
    expect(list.map((p) => p.name)).toEqual(["A vacía", "Proyecto p1", "Proyecto p2"]);
  });

  test("un coach solo ve las suyas, y nadie ve las de otro espacio ni las borradas", async () => {
    const h = await setup();
    const o = await h.owner();
    const coach = await h.invited(o.as, "coach@example.com", "coach", [o.p1]);
    expect((await coach.as.query(api.project.list, {})).map((p) => p._id)).toEqual([o.p1]);
    expect((await coach.as.query(api.project.list, { workspaceId: o.workspaceId })).map((p) => p._id)).toEqual([o.p1]);

    const other = await h.owner("otra@example.com");
    await expect(other.as.query(api.project.list, { workspaceId: o.workspaceId })).rejects.toThrow(/No existe/);

    await o.as.mutation(api.sync.markDeleted, { kind: "project", localIds: ["p1"], deletedAt: Date.now() });
    expect(await coach.as.query(api.project.list, {})).toEqual([]);
  });
});

describe("lo que la web lee", () => {
  test("memberships trae memberId; myInterviews el tipo de carpeta y si hay vídeo", async () => {
    const h = await setup();
    const o = await h.owner();
    const coach = await h.invited(o.as, "coach@example.com", "coach", [o.p1]);
    const [m] = await coach.as.query(api.workspace.memberships, {});
    const commentId = await coach.as.mutation(api.comment.add, { interviewId: o.i1, body: "hola" });
    const [c] = await coach.as.query(api.comment.list, { interviewId: o.i1 });
    expect(c).toMatchObject({ _id: commentId, isMine: true, authorMemberId: m.memberId });

    const [row] = await coach.as.query(api.viewer.myInterviews, {});
    expect(row).toMatchObject({ projectKind: "entrevistas", projectCompany: "Acme", hasVideo: false });
  });
});
