import { httpRouter } from "convex/server";

import { auth } from "./auth";

const http = httpRouter();

// Rutas de Convex Auth: inicio y vuelta de Google (/api/auth/...) y las claves
// públicas con las que se comprueba la sesión (/.well-known/...).
auth.addHttpRoutes(http);

export default http;
