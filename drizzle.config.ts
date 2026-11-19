import { defineConfig } from "drizzle-kit";
import { resolveDatabasePath } from "./src/lib/db/client";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dbCredentials: {
    url: resolveDatabasePath(),
  },
});
