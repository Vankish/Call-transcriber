import { afterEach, describe, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import { sha256Hex } from "./shareToken";
import { setup } from "./test.helpers";

const tokenOf = (url: string) => url.split("/l/")[1];
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

describe("enlaces de cliente", () => {
  test("se abre sin sesión y no lleva datos de contacto ni comentarios", async () => {
    const h = await setup();
    const o = await h.owner();
    await o.as.mutation(api.comment.add, { interviewId: o.i1, body: "interno" });
    const { url, shareLinkId } = await o.as.mutation(api.share.create, {
      interviewId: o.i1,
      label: "Cliente Acme",
    });
    const opened = await h.t.mutation(api.share.open, { token: tokenOf(url) });
    if (opened.expired) throw new Error("debería abrirse");
    expect(Object.keys(opened.candidate).sort()).toEqual(["_id", "name", "role"]);
    const text = JSON.stringify(opened);
    for (const secret of ["c1@cliente.com", "+34 600 000 000", "Notas privadas", "interno"]) {
      expect(text).not.toContain(secret);
    }
    expect(opened.transcript?.edited).toBe("[Entrevistador] Hola");

    // Se guarda el hash, no el token, y la visita queda apuntada.
    const link = await h.t.run((ctx) => ctx.db.get(shareLinkId));
    expect(link?.tokenHash).toBe(await sha256Hex(tokenOf(url)));
    expect(text).not.toContain(link!.tokenHash);
    expect(link?.openCount).toBe(1);
    const log = await h.t.run((ctx) => ctx.db.query("accessLog").collect());
    expect(log).toEqual([expect.objectContaining({ shareLinkId, action: "view" })]);

    const listed = await o.as.query(api.share.list, { interviewId: o.i1 });
    expect(listed).toEqual([expect.objectContaining({ label: "Cliente Acme", active: true, openCount: 1 })]);
    expect(JSON.stringify(listed)).not.toContain("tokenHash");
  });

  test("caducado a los 7 días, renovable otros 7", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    const h = await setup();
    const o = await h.owner();
    const { url, shareLinkId, expiresAt } = await o.as.mutation(api.share.create, {
      interviewId: o.i1,
      label: "C",
    });
    expect(Math.abs(expiresAt - (Date.now() + 7 * DAY))).toBeLessThan(1000);

    vi.setSystemTime(expiresAt + 1);
    expect(await h.t.mutation(api.share.open, { token: tokenOf(url) })).toEqual({ expired: true });

    const renewed = await o.as.mutation(api.share.renew, { shareLinkId });
    expect(Math.abs(renewed.expiresAt - (Date.now() + 7 * DAY))).toBeLessThan(1000);
    expect((await h.t.mutation(api.share.open, { token: tokenOf(url) })).expired).toBe(false);
  });

  test("revocado no abre, ni se puede renovar", async () => {
    const h = await setup();
    const o = await h.owner();
    const { url, shareLinkId } = await o.as.mutation(api.share.create, { interviewId: o.i1, label: "C" });
    await o.as.mutation(api.share.revoke, { shareLinkId });
    expect(await h.t.mutation(api.share.open, { token: tokenOf(url) })).toEqual({ expired: true });
    await expect(o.as.mutation(api.share.renew, { shareLinkId })).rejects.toThrow(/revocado/);
  });

  test("un token inventado o de una llamada borrada da lo mismo que uno caducado", async () => {
    const h = await setup();
    const o = await h.owner();
    expect(await h.t.mutation(api.share.open, { token: "x".repeat(43) })).toEqual({ expired: true });
    expect(await h.t.mutation(api.share.open, { token: "../../etc" })).toEqual({ expired: true });
    const { url } = await o.as.mutation(api.share.create, { interviewId: o.i1, label: "C" });
    await o.as.mutation(api.sync.markDeleted, { kind: "candidate", localIds: ["c1"], deletedAt: Date.now() });
    expect(await h.t.mutation(api.share.open, { token: tokenOf(url) })).toEqual({ expired: true });
  });

  test("tiene un límite de peticiones por minuto", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    const h = await setup();
    const o = await h.owner();
    const { url } = await o.as.mutation(api.share.create, { interviewId: o.i1, label: "C" });
    for (let n = 0; n < 30; n++) {
      await h.t.mutation(api.share.open, { token: tokenOf(url) });
    }
    await expect(h.t.mutation(api.share.open, { token: tokenOf(url) })).rejects.toThrow(
      /Demasiadas peticiones/,
    );
    vi.setSystemTime(Date.now() + 60_000);
    expect((await h.t.mutation(api.share.open, { token: tokenOf(url) })).expired).toBe(false);
  });

  test("un coach no ve ni gestiona los enlaces", async () => {
    const h = await setup();
    const o = await h.owner();
    const coach = await h.invited(o.as, "coach@example.com", "coach", [o.p1]);
    const { shareLinkId } = await o.as.mutation(api.share.create, { interviewId: o.i1, label: "C" });
    await expect(coach.as.query(api.share.list, { interviewId: o.i1 })).rejects.toThrow(/no cambiarlo/);
    await expect(coach.as.mutation(api.share.revoke, { shareLinkId })).rejects.toThrow(/no cambiarlo/);
  });
});
