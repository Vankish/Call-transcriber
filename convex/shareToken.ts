import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * El token de un enlace de cliente. 32 bytes aleatorios (256 bits): adivinarlo
 * a base de probar no es una opción, ni siquiera sin límite de peticiones.
 * Base64url para que vaya tal cual en la URL.
 */
export const newShareToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** SHA-256 en hex: lo único que se guarda del token. */
export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const SHARE_LINK_DAYS = 7;
export const SHARE_LINK_MS = SHARE_LINK_DAYS * 24 * 60 * 60 * 1000;

// Un token de verdad mide 43 caracteres; algo muy distinto ni se busca.
const plausible = (token: string) => /^[A-Za-z0-9_-]{20,100}$/.test(token);

/**
 * El enlace vivo de ese token, con su llamada sin borrar, o null. Caducado,
 * revocado o inexistente dan lo mismo: quien abre no debe poder distinguirlos.
 */
export const liveShareLink = async (
  db: QueryCtx["db"],
  token: string,
  now: number,
): Promise<{ link: Doc<"shareLink">; interview: Doc<"interview"> } | null> => {
  if (!plausible(token)) return null;
  const tokenHash = await sha256Hex(token);
  const link = await db
    .query("shareLink")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (link === null || link.revokedAt !== undefined || link.expiresAt <= now) {
    return null;
  }
  const interview = await db.get(link.interviewId);
  if (interview === null || interview.deletedAt !== undefined) return null;
  return { link, interview };
};
