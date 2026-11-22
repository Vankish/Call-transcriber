import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import { PART_SIZE } from "./media";
import { setR2ForTesting, type R2Port } from "./r2";
import { setup } from "./test.helpers";

/**
 * Subida por partes a R2 con un R2 falso en memoria: lo que se prueba es lo que
 * decide Convex (claves, partes, reanudar, deduplicar, permisos), no el SDK.
 */

type Call = { op: string; key: string; uploadId?: string; parts?: unknown };

const fakeR2 = () => {
  const calls: Call[] = [];
  let next = 0;
  const port: R2Port = {
    createMultipart: async (key) => {
      const uploadId = `up-${++next}`;
      calls.push({ op: "create", key, uploadId });
      return uploadId;
    },
    signPart: async (key, uploadId, partNumber, ttl) =>
      `https://r2.test/${key}?uploadId=${uploadId}&part=${partNumber}&ttl=${ttl}`,
    completeMultipart: async (key, uploadId, parts) => {
      calls.push({ op: "complete", key, uploadId, parts });
    },
    abortMultipart: async (key, uploadId) => {
      calls.push({ op: "abort", key, uploadId });
    },
    signGet: async (key, ttl) => `https://r2.test/${key}?get&ttl=${ttl}`,
  };
  return { port, calls };
};

let r2: ReturnType<typeof fakeR2>;
beforeEach(() => {
  r2 = fakeR2();
  setR2ForTesting(r2.port);
});
afterEach(() => {
  setR2ForTesting(null);
  vi.useRealTimers();
});

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const video = (sha256 = SHA_A, bytes = PART_SIZE * 2 + 10) => ({
  interviewLocalId: "i1",
  kind: "video" as const,
  mimeType: "video/webm",
  bytes,
  sha256,
  localRelPath: "Acme/Perfil c1/llamada.webm",
  durationSec: 1800,
});

describe("subida por partes", () => {
  test("empieza, firma, apunta partes, cierra y se reproduce", async () => {
    const h = await setup();
    const o = await h.owner();
    const start = await o.as.action(api.media.startUpload, video());
    expect(start).toMatchObject({ alreadyUploaded: false, partSize: 8 * 1024 * 1024, partsDone: [] });
    expect(r2.calls[0]).toMatchObject({
      op: "create",
      key: `${o.workspaceId}/${o.i1}/video.webm`,
    });

    const signed = await o.as.action(api.media.signParts, { mediaId: start.mediaId, partNumbers: [1, 2, 3] });
    expect(signed.map((s) => s.partNumber)).toEqual([1, 2, 3]);
    expect(signed[0].url).toContain("ttl=3600");
    await expect(
      o.as.action(api.media.signParts, { mediaId: start.mediaId, partNumbers: [4] }),
    ).rejects.toThrow(/La parte 4 no existe/);

    await o.as.mutation(api.media.completePart, { mediaId: start.mediaId, partNumber: 2, etag: '"e2"' });
    await o.as.mutation(api.media.completePart, { mediaId: start.mediaId, partNumber: 1, etag: '"e1"' });
    await expect(o.as.action(api.media.complete, { mediaId: start.mediaId })).rejects.toThrow(
      /Faltan partes/,
    );

    // Reanudar: otra llamada a startUpload con el mismo archivo sigue desde ahí.
    const resumed = await o.as.action(api.media.startUpload, video());
    expect(resumed.mediaId).toBe(start.mediaId);
    expect(resumed.partsDone.map((p) => p.partNumber)).toEqual([1, 2]);
    expect(r2.calls.filter((c) => c.op === "create")).toHaveLength(1);

    await o.as.mutation(api.media.completePart, { mediaId: start.mediaId, partNumber: 3, etag: '"e3"' });
    await o.as.action(api.media.complete, { mediaId: start.mediaId });
    expect(r2.calls[r2.calls.length - 1]).toMatchObject({
      op: "complete",
      uploadId: "up-1",
      parts: [
        { partNumber: 1, etag: '"e1"' },
        { partNumber: 2, etag: '"e2"' },
        { partNumber: 3, etag: '"e3"' },
      ],
    });

    const files = await o.as.query(api.media.listForInterview, { interviewId: o.i1 });
    expect(files).toEqual([expect.objectContaining({ kind: "video", uploadStatus: "done" })]);
    expect(JSON.stringify(files)).not.toContain("r2.test");

    const play = await o.as.action(api.media.playbackUrl, { mediaId: start.mediaId });
    expect(play.url).toContain(`${o.i1}/video.webm`);
    const log = await h.t.run((ctx) => ctx.db.query("accessLog").collect());
    expect(log).toEqual([expect.objectContaining({ action: "play_media", memberId: o.memberId })]);
  });

  test("lo que ya está subido (mismo sha256) no se vuelve a subir", async () => {
    const h = await setup();
    const o = await h.owner();
    const first = await o.as.action(api.media.startUpload, video(SHA_A, 10));
    await o.as.mutation(api.media.completePart, { mediaId: first.mediaId, partNumber: 1, etag: "e" });
    await o.as.action(api.media.complete, { mediaId: first.mediaId });

    const again = await o.as.action(api.media.startUpload, video(SHA_A, 10));
    expect(again).toMatchObject({ mediaId: first.mediaId, alreadyUploaded: true });

    // El mismo archivo en otra llamada tampoco se sube: reutiliza el objeto.
    const elsewhere = await o.as.action(api.media.startUpload, { ...video(SHA_A, 10), interviewLocalId: "i2" });
    expect(elsewhere.alreadyUploaded).toBe(true);
    expect(elsewhere.mediaId).not.toBe(first.mediaId);
    expect(r2.calls.filter((c) => c.op === "create")).toHaveLength(1);
  });

  test("una versión nueva sustituye a la anterior al terminar, y la subida a medias se cancela", async () => {
    vi.useFakeTimers();
    const h = await setup();
    const o = await h.owner();
    const v1 = await o.as.action(api.media.startUpload, video(SHA_A, 10));
    await o.as.mutation(api.media.completePart, { mediaId: v1.mediaId, partNumber: 1, etag: "e" });
    await o.as.action(api.media.complete, { mediaId: v1.mediaId });

    const half = await o.as.action(api.media.startUpload, video(SHA_B, 10));
    const v2 = await o.as.action(api.media.startUpload, video("c".repeat(64), 10));
    await h.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(r2.calls).toContainEqual(expect.objectContaining({ op: "abort", uploadId: "up-2" }));

    // Mientras v2 no acaba, se sigue viendo v1.
    let files = await o.as.query(api.media.listForInterview, { interviewId: o.i1 });
    expect(files.map((f) => [f._id, f.uploadStatus])).toEqual([
      [v1.mediaId, "done"],
      [v2.mediaId, "uploading"],
    ]);
    expect(files.some((f) => f._id === half.mediaId)).toBe(false);

    await o.as.mutation(api.media.completePart, { mediaId: v2.mediaId, partNumber: 1, etag: "e" });
    await o.as.action(api.media.complete, { mediaId: v2.mediaId });
    files = await o.as.query(api.media.listForInterview, { interviewId: o.i1 });
    expect(files.map((f) => f._id)).toEqual([v2.mediaId]);
  });

  test("cancelar aborta el multipart en R2", async () => {
    const h = await setup();
    const o = await h.owner();
    const start = await o.as.action(api.media.startUpload, video());
    await o.as.action(api.media.abort, { mediaId: start.mediaId });
    expect(r2.calls[r2.calls.length - 1]).toMatchObject({ op: "abort", uploadId: "up-1" });
    await expect(
      o.as.mutation(api.media.completePart, { mediaId: start.mediaId, partNumber: 1, etag: "e" }),
    ).rejects.toThrow(/No existe/);
  });

  test("argumentos que no se aceptan", async () => {
    const h = await setup();
    const o = await h.owner();
    await expect(o.as.action(api.media.startUpload, { ...video(), sha256: "nope" })).rejects.toThrow(
      /sha256/,
    );
    await expect(
      o.as.action(api.media.startUpload, { ...video(), localRelPath: "..\\..\\Windows\\x.webm" }),
    ).rejects.toThrow(/ruta del archivo/);
    await expect(
      o.as.action(api.media.startUpload, { ...video(), localRelPath: "C:\\x.webm" }),
    ).rejects.toThrow(/ruta del archivo/);
    await expect(
      o.as.action(api.media.startUpload, { ...video(), interviewLocalId: "no-subida" }),
    ).rejects.toThrow(/sincronízala primero/);
  });
});

describe("permisos de archivos", () => {
  const uploaded = async () => {
    const h = await setup();
    const o = await h.owner();
    const start = await o.as.action(api.media.startUpload, video(SHA_A, 10));
    await o.as.mutation(api.media.completePart, { mediaId: start.mediaId, partNumber: 1, etag: "e" });
    await o.as.action(api.media.complete, { mediaId: start.mediaId });
    return { h, o, mediaId: start.mediaId };
  };

  test("un coach de otro proyecto no reproduce ni firma nada", async () => {
    const { h, o, mediaId } = await uploaded();
    const coach = await h.invited(o.as, "coach@example.com", "coach", [o.p2]);
    await expect(coach.as.action(api.media.playbackUrl, { mediaId })).rejects.toThrow(/No existe/);
    await expect(coach.as.action(api.media.signParts, { mediaId, partNumbers: [1] })).rejects.toThrow(
      /No existe/,
    );
  });

  test("un coach del proyecto reproduce, pero no sube", async () => {
    const { h, o, mediaId } = await uploaded();
    const coach = await h.invited(o.as, "coach@example.com", "coach", [o.p1]);
    expect((await coach.as.action(api.media.playbackUrl, { mediaId })).url).toContain("video");
    await expect(
      coach.as.mutation(api.media.completePart, { mediaId, partNumber: 1, etag: "e" }),
    ).rejects.toThrow(/no cambiarlo/);
  });

  test("con un enlace de cliente vivo se reproduce sin sesión; revocado o de otra llamada, no", async () => {
    const { h, o, mediaId } = await uploaded();
    const { url, shareLinkId } = await o.as.mutation(api.share.create, { interviewId: o.i1, label: "C" });
    const token = url.split("/l/")[1];
    const play = await h.t.action(api.media.playbackUrl, { mediaId, shareToken: token });
    expect(play.expiresAt).toBeGreaterThan(Date.now());
    const log = await h.t.run((ctx) => ctx.db.query("accessLog").collect());
    expect(log).toEqual([expect.objectContaining({ action: "play_media", shareLinkId })]);

    const other = await o.as.mutation(api.share.create, { interviewId: o.i2, label: "Otro" });
    await expect(
      h.t.action(api.media.playbackUrl, { mediaId, shareToken: other.url.split("/l/")[1] }),
    ).rejects.toThrow(/No existe/);

    await o.as.mutation(api.share.revoke, { shareLinkId });
    await expect(h.t.action(api.media.playbackUrl, { mediaId, shareToken: token })).rejects.toThrow(
      /No existe/,
    );
    await expect(h.t.action(api.media.playbackUrl, { mediaId })).rejects.toThrow(/Inicia sesión/);
  });
});
