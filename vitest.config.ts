import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // "server-only" lanza error fuera de React Server Components; en pruebas es inofensivo.
      "server-only": path.resolve(__dirname, "tests/stubs/empty.ts"),
    },
  },
});
