// El `api` tipado de convex/_generated arrastra al compilador de la web los
// archivos de convex/, que leen `process.env` (existe en el runtime de Convex,
// no en el navegador). Se declara solo eso, en vez de cargar todos los tipos de
// Node en la web, para que usar `process` en código de la web siga sin tener
// sentido (en el navegador vale undefined).
declare const process: { env: Record<string, string | undefined> }
