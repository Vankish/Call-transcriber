import { getAuthUserId } from "@convex-dev/auth/server";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { fail } from "./errors";

/**
 * El usuario con sesión, o un error. La identidad sale siempre del token de
 * Convex Auth, nunca de un argumento.
 */
export const requireUser = async (
  ctx: Pick<QueryCtx, "auth">,
): Promise<Id<"users">> => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw fail("unauthenticated", "Inicia sesión primero.");
  }
  return userId;
};
