/// <reference types="vite/client" />

// Los módulos de convex/ para convexTest(schema, modules). Se dejan fuera los
// archivos con dos puntos en el nombre (pruebas, este mismo, tipos .d.ts), que
// Convex tampoco despliega. El patrón con `!(...)` de la documentación de
// convex-test no lo entiende el glob de Vite 8: de ahí la lista con negaciones.
export const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.*.ts",
  "!./**/*.*.js",
]);
