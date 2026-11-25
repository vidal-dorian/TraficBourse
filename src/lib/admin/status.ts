// Data of the admin status page (US #28): the latest MCP calls and the last prices job run.
import { desc } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { jobRuns, mcpAudit } from "@/lib/db/schema";

export const STATUS_CALLS_LIMIT = 50;

export interface AdminStatus {
  /** Newest first, at most `STATUS_CALLS_LIMIT`. */
  calls: { id: number; tool: string; ok: boolean; error: string | null; durationMs: number }[];
  lastRun: { at: Date; updatedCount: number; failed: { symbol: string; error: string }[] } | null;
}

/** Two queries: the latest audit rows and the latest job run. */
export function getAdminStatus(db: Db): AdminStatus {
  const calls = db
    .select({
      id: mcpAudit.id,
      tool: mcpAudit.tool,
      ok: mcpAudit.ok,
      error: mcpAudit.error,
      durationMs: mcpAudit.durationMs,
    })
    .from(mcpAudit)
    .orderBy(desc(mcpAudit.at), desc(mcpAudit.id))
    .limit(STATUS_CALLS_LIMIT)
    .all();
  const lastRun = db.select().from(jobRuns).orderBy(desc(jobRuns.at), desc(jobRuns.id)).limit(1).get() ?? null;
  return { calls, lastRun };
}
