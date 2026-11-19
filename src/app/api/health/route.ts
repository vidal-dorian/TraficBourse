import { getSqlite } from "@/lib/db/client";

// Always checked live, never prerendered or cached.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Liveness of the app and state of the SQLite database. */
export function GET(_request: Request): Response {
  try {
    const sqlite = getSqlite();
    sqlite.prepare("SELECT 1").get();
    const journalMode = String(sqlite.pragma("journal_mode", { simple: true }));
    return Response.json({ status: "ok", db: { status: "ok", journalMode } }, { headers: NO_STORE });
  } catch (error) {
    // Details (paths, stack) stay in the server logs, never in the public response.
    console.error("Health check failed: database unavailable", error);
    return Response.json({ status: "error", db: { status: "error" } }, { status: 503, headers: NO_STORE });
  }
}
