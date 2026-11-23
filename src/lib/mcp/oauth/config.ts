// OAuth settings of the MCP connector (CLAUDE.md §8, option B), read from the environment at
// request time. Every value fails closed: when it is missing, the OAuth flow refuses.
/** The login password is the only thing between the internet and the tools: shorter ones are refused. */
export const MIN_PASSWORD_LENGTH = 16;

/** Redirect URIs a client may register when `MCP_OAUTH_REDIRECT_URIS` is not set: the Claude callbacks. */
export const DEFAULT_REDIRECT_URIS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];

/** Public origin of the app (no trailing slash), or undefined when `PUBLIC_URL` is unset or not an http(s) URL. */
export function getPublicUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const configured = env.PUBLIC_URL?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The owner's password typed on the login page; undefined when unset, blank or shorter than
 * `MIN_PASSWORD_LENGTH` (login always refused; the weak case is logged, never the value).
 */
export function getOwnerPassword(env: Record<string, string | undefined> = process.env): string | undefined {
  const configured = env.MCP_OAUTH_PASSWORD;
  if (!configured || !configured.trim()) return undefined;
  if (configured.length < MIN_PASSWORD_LENGTH) {
    console.error(`OAuth login refused: MCP_OAUTH_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters`);
    return undefined;
  }
  return configured;
}

/** Redirect URIs a client may register: `MCP_OAUTH_REDIRECT_URIS` (comma-separated) or the Claude callbacks. */
export function getAllowedRedirectUris(env: Record<string, string | undefined> = process.env): string[] {
  const listed = (env.MCP_OAUTH_REDIRECT_URIS ?? "")
    .split(",")
    .map((uri) => uri.trim())
    .filter(Boolean);
  return listed.length > 0 ? listed : DEFAULT_REDIRECT_URIS;
}

/** The MCP endpoint, i.e. the protected resource. */
export function resourceUrl(publicUrl: string): string {
  return `${publicUrl}/api/mcp`;
}

/** Where a client finds the RFC 9728 metadata of the MCP endpoint. */
export function resourceMetadataUrl(publicUrl: string): string {
  return `${publicUrl}/.well-known/oauth-protected-resource/api/mcp`;
}

const NO_STORE = { "Cache-Control": "no-store" };

/** JSON answer that no cache may keep (metadata, tokens, errors). */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** Answer of every OAuth endpoint when `PUBLIC_URL` is not configured. */
export function notConfigured(): Response {
  console.error("OAuth request refused: PUBLIC_URL is not set");
  return jsonResponse({ error: "temporarily_unavailable", error_description: "OAuth is not configured." }, 503);
}

/** Largest body the OAuth endpoints parse (they carry a handful of short fields). */
export const MAX_BODY_BYTES = 16 * 1024;

/** The request's body as text, or undefined when it is larger than `MAX_BODY_BYTES` (read in chunks, never fully buffered). */
export async function readBoundedText(request: Request): Promise<string | undefined> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
