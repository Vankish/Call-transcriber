import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

import type { DataModel, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { admitSignIn } from "./admitSignIn";
import { normalizeEmail } from "./normalizeEmail";

/**
 * Cuentas de la nube: Google o correo y contraseña, como el CRM de Orbit.
 *
 * Variables del despliegue:
 *   AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET: cliente OAuth de Google; la URL de
 *     vuelta es <CONVEX_SITE_URL>/api/auth/callback/google
 *   SITE_URL: dónde vive la web (a dónde vuelve Google tras entrar)
 *   JWT_PRIVATE_KEY, JWKS: claves con las que Convex Auth firma la sesión
 *
 * Entrar no da acceso a nada: ver `admitSignIn`. No hay correo de verificación
 * ni "he olvidado mi contraseña" (haría falta un servicio de envío de correo);
 * ver el riesgo que eso supone en el informe del frente A.
 */

const MIN_PASSWORD = 8;

const EmailPassword = Password<DataModel>({
  profile: (params) => {
    const email = normalizeEmail(
      typeof params.email === "string" ? params.email : "",
    );
    const name = typeof params.name === "string" ? params.name.trim() : "";
    return { email, name: name || email };
  },
  validatePasswordRequirements: (password) => {
    if (password.length < MIN_PASSWORD) {
      throw new Error(
        `La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres.`,
      );
    }
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    // `select_account`: en un PC compartido, que no entre solo con la última
    // cuenta de Google que se usó.
    Google({ authorization: { params: { prompt: "select_account" } } }),
    EmailPassword,
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId, profile }) {
      const db = ctx.db as unknown as MutationCtx["db"];
      const email = typeof profile.email === "string" ? profile.email : null;
      const name = typeof profile.name === "string" ? profile.name : null;
      await admitSignIn(db, userId as Id<"users">, email, name);
    },
  },
});
