import type { MutationCtx } from "./_generated/server";

/**
 * Límite sencillo de peticiones: ventana fija de un minuto por clave. Basta
 * para que un enlace filtrado no se pueda martillear ni sirva para tirar de la
 * transcripción en bucle. Si hiciera falta algo fino (ventana deslizante,
 * ráfagas), el componente @convex-dev/rate-limiter lo da hecho.
 *
 * Devuelve false si ya se pasó del límite; no lanza, para que quien llama
 * decida qué contestar (a un cliente sin sesión, lo mínimo).
 */
export const takeRateLimit = async (
  ctx: Pick<MutationCtx, "db">,
  key: string,
  perMinute: number,
  now: number,
): Promise<boolean> => {
  const windowStart = now - (now % 60_000);
  const row = await ctx.db
    .query("rateLimit")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (row === null) {
    await ctx.db.insert("rateLimit", { key, windowStart, count: 1 });
    return true;
  }
  if (row.windowStart !== windowStart) {
    await ctx.db.patch(row._id, { windowStart, count: 1 });
    return true;
  }
  if (row.count >= perMinute) return false;
  await ctx.db.patch(row._id, { count: row.count + 1 });
  return true;
};
