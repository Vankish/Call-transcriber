import { defineConfig } from "vitest/config";

// Pruebas del backend de Convex (convex/*.test.ts) con convex-test. El runtime
// "edge-runtime" se parece al de Convex (sin Node), así que una función que
// solo funcionase en Node fallaría aquí antes que en el despliegue.
export default defineConfig({
  test: {
    include: ["convex/**/*.test.ts"],
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
