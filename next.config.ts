import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (see CLAUDE.md §4).
  output: "standalone",
  // Native module: load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
