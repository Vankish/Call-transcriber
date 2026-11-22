import { ConvexError } from "convex/values";

/**
 * Los errores que ve la persona en la web o en la app. El `code` es estable y
 * en inglés para que la interfaz lo reconozca (y lo traduzca); el `message` va
 * en español porque es el idioma de origen de la app y el que se enseña si la
 * interfaz no conoce el código.
 */
export type ErrorCode =
  | "unauthenticated"
  | "not_found"
  | "forbidden"
  | "read_only"
  | "no_workspace"
  | "workspace_required"
  | "invalid_argument"
  | "batch_too_large"
  | "already_member"
  | "owner_locked"
  | "not_pending"
  | "too_large"
  | "upload_state"
  | "storage_error"
  | "not_configured"
  | "rate_limited"
  | "invalid_redirect"
  | "invalid_credentials"
  | "account_exists"
  | "too_many_attempts"
  | "weak_password";

export const fail = (code: ErrorCode, message: string): ConvexError<{
  code: ErrorCode;
  message: string;
}> => new ConvexError({ code, message });

// Lo que no se puede leer se cuenta como "no existe": así un id ajeno no
// confirma que exista algo detrás.
export const notFound = () =>
  fail("not_found", "No existe o no tienes acceso.");
