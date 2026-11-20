// Bearer token check for /api/mcp (CLAUDE.md §8, option A).
//
// Cloudflare Access is bypassed on /api/mcp (Claude cannot pass it), so the app checks the
// static `Authorization: Bearer <token>` sent by the Claude connector against `MCP_TOKEN`.
import { createHash, timingSafeEqual } from "node:crypto";

/** Server-side only: never sent to the caller. */
export type McpAuthRefusal = "not_configured" | "missing_token" | "invalid_token";

export type McpAuthResult = { ok: true } | { ok: false; reason: McpAuthRefusal };

const BEARER = /^Bearer[ \t]+(\S+)[ \t]*$/i;

/** The token of an `Authorization: Bearer <token>` header, or undefined for any other shape. */
export function parseBearerToken(header: string | null | undefined): string | undefined {
  return BEARER.exec(header ?? "")?.[1];
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Compares two tokens in constant time. Both sides are hashed first so the comparison
 * always runs on 32 bytes and leaks neither the content nor the length of the token.
 */
export function tokensMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(sha256(provided), sha256(expected));
}

/** Checks the request's bearer token against `MCP_TOKEN`; unset or blank config refuses everything. */
export function checkMcpAuth(request: Request, env: Record<string, string | undefined> = process.env): McpAuthResult {
  const expected = (env.MCP_TOKEN ?? "").trim();
  if (!expected) return { ok: false, reason: "not_configured" };

  const provided = parseBearerToken(request.headers.get("authorization"));
  if (!provided) return { ok: false, reason: "missing_token" };

  return tokensMatch(provided, expected) ? { ok: true } : { ok: false, reason: "invalid_token" };
}
