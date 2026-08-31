import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom", setupFiles: [], exclude: ["tests/**", "node_modules/**"] },
});
