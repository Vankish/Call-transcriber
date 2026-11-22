import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import type { DataModel, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { admitSignIn } from "./admitSignIn";
import { checkRedirect } from "./authRedirect";
import { fail } from "./errors";
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

const BasePassword = Password<DataModel>({
  profile: (params) => {
    const email = normalizeEmail(
      typeof params.email === "string" ? params.email : "",
    );
    const name = typeof params.name === "string" ? params.name.trim() : "";
    return { email, name: name || email };
  },
  validatePasswordRequirements: (password) => {
    if (password.length < MIN_PASSWORD) {
      throw fail(
        "weak_password",
        `La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres.`,
      );
    }
  },
});

/**
 * Convex Auth lanza `Error` normales ("InvalidSecret", "Account x already
 * exists"...) y en producción Convex los convierte todos en "Server Error": la
 * app no podría distinguir "contraseña mal" de "ese correo ya tiene cuenta".
 * Se traducen a ConvexError con `code`, que sí llega tal cual.
 *
 * Correo desconocido y contraseña mal dan el mismo código a propósito: así la
 * pantalla de entrar no sirve para averiguar quién tiene cuenta.
 */
export const passwordError = (error: unknown): unknown => {
  if (error instanceof ConvexError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/already exists/i.test(message)) {
    return fail("account_exists", "Ese correo ya tiene cuenta: entra con tu contraseña.");
  }
  if (/TooManyFailedAttempts/.test(message)) {
    return fail("too_many_attempts", "Demasiados intentos fallidos. Espera un rato y vuelve a probar.");
  }
  if (/InvalidAccountId|InvalidSecret|Invalid credentials/.test(message)) {
    return fail("invalid_credentials", "El correo o la contraseña no son correctos.");
  }
  return error;
};

// `Password` devuelve un ConvexCredentials cuya configuración de verdad vive en
// `options` (Convex Auth la mezcla encima al arrancar): hay que envolver el
// `authorize` de ahí, no el de fuera, que es un marcador vacío.
type CredentialsOptions = { authorize: (...args: never[]) => Promise<unknown> };
const baseOptions = (BasePassword as unknown as { options: CredentialsOptions }).options;
const EmailPassword = {
  ...BasePassword,
  options: {
    ...baseOptions,
    authorize: async (...args: Parameters<CredentialsOptions["authorize"]>) => {
      try {
        return await baseOptions.authorize(...args);
      } catch (error) {
        throw passwordError(error);
      }
    },
  },
} as typeof BasePassword;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    // `select_account`: en un PC compartido, que no entre solo con la última
    // cuenta de Google que se usó.
    Google({ authorization: { params: { prompt: "select_account" } } }),
    EmailPassword,
  ],
  callbacks: {
    async redirect({ redirectTo }) {
      return checkRedirect(redirectTo, process.env.SITE_URL);
    },
    async afterUserCreatedOrUpdated(ctx, { userId, profile }) {
      const db = ctx.db as unknown as MutationCtx["db"];
      const email = typeof profile.email === "string" ? profile.email : null;
      const name = typeof profile.name === "string" ? profile.name : null;
      await admitSignIn(db, userId as Id<"users">, email, name);
    },
  },
});
