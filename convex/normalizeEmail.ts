/**
 * El correo con el que se compara todo: invitaciones, members y cuentas. Google
 * lo da en minúsculas, pero quien escribe una invitación a mano no siempre; sin
 * esto "Ana@x.com" y "ana@x.com" serían dos personas.
 */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

// Comprobación mínima: lo justo para no guardar invitaciones a algo que nunca
// podrá iniciar sesión. La de verdad la hace el proveedor al entrar.
export const looksLikeEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
