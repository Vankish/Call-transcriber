// Convex Auth firma sus propios JWT con CONVEX_SITE_URL como emisor; esa
// variable la pone Convex en cada despliegue. JWT_PRIVATE_KEY y JWKS se ponen
// una vez por despliegue (ver docs de Convex Auth, "Manual setup").
const authConfig = {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
