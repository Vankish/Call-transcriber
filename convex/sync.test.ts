import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { candidate, interview, project, setup, T0 } from "./test.helpers";

describe("sync desde el escritorio", () => {
  test("subir dos veces no duplica: upsert por localId", async () => {
    const h = await setup();
    const o = await h.owner();
    const again = await o.as.mutation(api.sync.pushProjects, { items: [project("p1")] });
    // Mismo updatedAt: es un reintento, cuenta como aplicado.
    expect(again).toEqual({ applied: ["p1"], skipped: [] });
    const rows = await h.t.run((ctx) => ctx.db.query("project").collect());
    expect(rows.filter((r) => r.localId === "p1")).toHaveLength(1);
  });

  test("gana el updatedAt mayor; lo viejo se ignora y se dice", async () => {
    const h = await setup();
    const o = await h.owner();
    const newer = { ...project("p1", T0 + 10), name: "Nuevo" };
    expect(await o.as.mutation(api.sync.pushProjects, { items: [newer] })).toEqual({
      applied: ["p1"],
      skipped: [],
    });
    const older = { ...project("p1", T0 + 5), name: "Viejo" };
    expect(await o.as.mutation(api.sync.pushProjects, { items: [older] })).toEqual({
      applied: [],
      skipped: ["p1"],
    });
    const row = await h.t.run((ctx) => ctx.db.get(o.p1));
    expect(row?.name).toBe("Nuevo");
  });

  test("borrar es poner deletedAt, y lo borrado no resucita con un push", async () => {
    const h = await setup();
    const o = await h.owner();
    const deletedAt = T0 + 100;
    expect(
      await o.as.mutation(api.sync.markDeleted, {
        kind: "interview",
        localIds: ["i1", "no-existe"],
        deletedAt,
      }),
    ).toEqual({ applied: ["i1"], skipped: ["no-existe"] });
    const row = await h.t.run((ctx) => ctx.db.get(o.i1));
    expect(row).toMatchObject({ deletedAt, updatedAt: deletedAt });

    const late = await o.as.mutation(api.sync.pushInterviews, {
      items: [interview("i1", "c1", T0 + 200)],
    });
    expect(late.skipped).toEqual(["i1"]);

    // `pull` lleva el borrado al otro PC.
    const pulled = await o.as.query(api.sync.pull, { since: T0 });
    expect(pulled.interviews).toEqual([expect.objectContaining({ localId: "i1", deletedAt })]);
  });

  test("un hijo sin su padre arriba se salta sin tirar el lote", async () => {
    const h = await setup();
    const o = await h.owner();
    const result = await o.as.mutation(api.sync.pushCandidates, {
      items: [candidate("huerfano", "p-que-no-existe"), candidate("c3", "p1")],
    });
    expect(result).toEqual({ applied: ["c3"], skipped: ["huerfano"] });
  });

  test("mover un perfil de carpeta mueve sus llamadas (y los permisos con ellas)", async () => {
    const h = await setup();
    const o = await h.owner();
    const coach = await h.invited(o.as, "coach@example.com", "coach", [o.p2]);
    await expect(coach.as.query(api.viewer.interview, { interviewId: o.i1 })).rejects.toThrow();
    await o.as.mutation(api.sync.pushCandidates, { items: [candidate("c1", "p2", T0 + 1)] });
    const seen = await coach.as.query(api.viewer.interview, { interviewId: o.i1 });
    expect(seen.project._id).toBe(o.p2);
  });

  test("más de 100 filas por llamada se rechaza", async () => {
    const h = await setup();
    const o = await h.owner();
    const items = Array.from({ length: 101 }, (_, n) => project(`x${n}`));
    await expect(o.as.mutation(api.sync.pushProjects, { items })).rejects.toThrow(/como mucho 100/);
  });

  test("transcripción: upsert por llamada y gana la más nueva", async () => {
    const h = await setup();
    const o = await h.owner();
    const push = (edited: string, updatedAt: number) =>
      o.as.mutation(api.sync.pushTranscript, {
        interviewLocalId: "i1",
        original: "o",
        edited,
        segments: [{ startSec: 0, endSec: 2, speaker: "A", text: edited }],
        updatedAt,
      });
    expect(await push("v2", T0 + 2)).toEqual({ applied: ["i1"], skipped: [] });
    expect(await push("v1", T0 + 1)).toEqual({ applied: [], skipped: ["i1"] });
    const rows = await h.t.run((ctx) => ctx.db.query("transcript").collect());
    expect(rows.filter((r) => r.interviewId === o.i1).map((r) => r.edited)).toEqual(["v2"]);
  });

  test("pull devuelve las filas como las ve el escritorio, con los localId del padre", async () => {
    const h = await setup();
    const o = await h.owner();
    const all = await o.as.query(api.sync.pull, { since: 0 });
    expect(all.hasMore).toBe(false);
    expect(all.until).toBe(T0);
    expect(all.candidates.find((c) => c.localId === "c1")).toMatchObject({ projectLocalId: "p1" });
    expect(all.interviews.find((i) => i.localId === "i1")).toMatchObject({ candidateLocalId: "c1" });
    expect(all.transcripts).toEqual([
      expect.objectContaining({ interviewLocalId: "i1", edited: "[Entrevistador] Hola" }),
    ]);
    const nothing = await o.as.query(api.sync.pull, { since: T0 });
    expect(nothing.projects).toEqual([]);
  });

  test("pull va por páginas sin perder filas", async () => {
    const h = await setup();
    const o = await h.owner();
    for (let batch = 0; batch < 3; batch++) {
      await o.as.mutation(api.sync.pushProjects, {
        items: Array.from({ length: 100 }, (_, n) => project(`b${batch}-${n}`, T0 + 1 + batch * 100 + n)),
      });
    }
    const seen = new Set<string>();
    let since = 0;
    for (let page = 0; page < 10; page++) {
      const r = await o.as.query(api.sync.pull, { since });
      r.projects.forEach((p) => seen.add(p.localId));
      since = r.until;
      if (!r.hasMore) break;
    }
    expect(seen.size).toBe(302);
  });

  test("ensureMine es idempotente y un coach sin espacio no puede sincronizar", async () => {
    const h = await setup();
    const o = await h.owner();
    expect(await o.as.mutation(api.workspace.ensureMine, {})).toEqual({
      workspaceId: o.workspaceId,
      memberId: o.memberId,
    });
    expect(await o.as.query(api.workspace.mine, {})).toEqual({
      workspaceId: o.workspaceId,
      memberId: o.memberId,
      role: "owner",
    });
    const coach = await h.invited(o.as, "coach@example.com", "coach", [o.p1]);
    expect(await coach.as.query(api.workspace.mine, {})).toBeNull();
    expect(await coach.as.query(api.workspace.memberships, {})).toEqual([
      expect.objectContaining({ workspaceId: o.workspaceId, role: "coach", projectIds: [o.p1] }),
    ]);
    await expect(
      coach.as.mutation(api.sync.pushProjects, { items: [project("p1", T0 + 9)] }),
    ).rejects.toThrow(/Todavía no tienes un espacio/);
  });
});
