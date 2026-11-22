import { fail } from "./errors";

/**
 * A dónde puede volver el navegador tras entrar con Google (callback
 * `redirect` de Convex Auth). Sin esta lista cualquiera podría montar un enlace
 * de "entrar" que, al volver, entregase el código de sesión a otra web.
 *
 * - La app de escritorio abre Google en el navegador del sistema y escucha la
 *   vuelta en un servidor local: esa dirección exacta, y ninguna otra de
 *   localhost.
 * - Rutas relativas ("/..." o "?..."), resueltas contra SITE_URL (la web).
 * - Direcciones que empiezan por SITE_URL, siempre que lo siguiente sea el fin,
 *   "/" o "?": así "https://web.com.otra.com" no pasa por empezar igual.
 */
export const DESKTOP_AUTH_CALLBACK = "http://localhost:3000/convex-auth";

export const checkRedirect = (redirectTo: string, rawSiteUrl: string | undefined): string => {
  if (redirectTo === DESKTOP_AUTH_CALLBACK) return redirectTo;
  const site = (rawSiteUrl ?? "").trim().replace(/\/+$/, "");
  if (site !== "") {
    // "//otra.com" sería una dirección de otro sitio para el navegador.
    if (redirectTo.startsWith("?") || (redirectTo.startsWith("/") && !redirectTo.startsWith("//"))) {
      return `${site}${redirectTo}`;
    }
    if (redirectTo.startsWith(site)) {
      const after = redirectTo[site.length];
      if (after === undefined || after === "/" || after === "?") return redirectTo;
    }
  }
  throw fail("invalid_redirect", "Esa dirección de vuelta no está permitida.");
};
