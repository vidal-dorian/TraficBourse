import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" -> "./src/*" path alias of a standard Next.js tsconfig.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  oxc: {
    // Next.js sets "jsx": "preserve" in tsconfig; Vitest must compile JSX itself.
    // Vite 8 (Vitest 5) transforms TS/JSX with Oxc and ignores the old `esbuild` option.
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 60_000,
    // Builds the Docker image ahead of the gated Docker tests (no-op unless DOCKER_TESTS=1).
    globalSetup: ["tests/setup/docker-build-cache.ts"],
  },
});
