// MCP call log (CLAUDE.md §7): every tool call adds one row to `mcp_audit`.
import { getDb } from "@/lib/db/client";
import { mcpAudit } from "@/lib/db/schema";

/** Longest error text kept in the log: enough to diagnose, too short to hold a payload. */
export const MAX_AUDIT_ERROR_LENGTH = 200;

export type ToolCallRecord = {
  tool: string;
  ok: boolean;
  error: string | null;
  durationMs: number;
  at: Date;
};

/** One line, trimmed and cut to `MAX_AUDIT_ERROR_LENGTH` characters. */
export function shortError(message: string, fallback: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (!oneLine) return fallback;
  return oneLine.length > MAX_AUDIT_ERROR_LENGTH ? `${oneLine.slice(0, MAX_AUDIT_ERROR_LENGTH - 1)}…` : oneLine;
}

/**
 * Writes one audit row. A failing write is logged server side and swallowed: the audit must
 * never break a tool call nor expose database details to the caller.
 */
export function recordToolCall(record: ToolCallRecord): void {
  try {
    getDb().insert(mcpAudit).values(record).run();
  } catch (error) {
    console.error(`MCP audit write failed for tool ${record.tool}`, error);
  }
}
