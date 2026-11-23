// Token endpoint (RFC 6749 + PKCE S256): authorization_code and refresh_token grants for public clients.
import { createHash, timingSafeEqual } from "node:crypto";
import { getPublicUrl, jsonResponse, notConfigured } from "./config";
import { consumeCode, findClient, issueTokens, revokeRefreshToken } from "./store";

type TokenError = "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type";

const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

function tokenError(error: TokenError, description: string): Response {
  return jsonResponse({ error, error_description: description }, error === "invalid_client" ? 401 : 400, { Pragma: "no-cache" });
}

/** True when `verifier` hashes (SHA-256, base64url) to the challenge sent at authorization. */
function pkceMatches(verifier: string, challenge: string): boolean {
  if (!CODE_VERIFIER.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

function exchangeCode(form: URLSearchParams, clientId: string): Response {
  const code = form.get("code");
  const redirectUri = form.get("redirect_uri");
  const verifier = form.get("code_verifier");
  if (!code || !redirectUri || !verifier) {
    return tokenError("invalid_request", "code, redirect_uri and code_verifier are required.");
  }

  const grant = consumeCode(code);
  const valid =
    grant !== undefined &&
    grant.clientId === clientId &&
    grant.redirectUri === redirectUri &&
    grant.expiresAt > Date.now() &&
    pkceMatches(verifier, grant.codeChallenge);
  if (!valid) return tokenError("invalid_grant", "The authorization code is invalid or expired.");

  return jsonResponse(issueTokens(clientId), 200, { Pragma: "no-cache" });
}

function refresh(form: URLSearchParams, clientId: string): Response {
  const refreshToken = form.get("refresh_token");
  if (!refreshToken) return tokenError("invalid_request", "refresh_token is required.");

  // Rotation: the old refresh token dies with the exchange, so a replay is refused.
  if (!revokeRefreshToken(refreshToken, clientId)) return tokenError("invalid_grant", "The refresh token is invalid or expired.");

  return jsonResponse(issueTokens(clientId), 200, { Pragma: "no-cache" });
}

/** POST /oauth/token (application/x-www-form-urlencoded) */
export async function issueToken(request: Request): Promise<Response> {
  if (!getPublicUrl()) return notConfigured();

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return tokenError("invalid_request", "The body must be form-urlencoded.");
  }

  const grantType = form.get("grant_type");
  if (!grantType) return tokenError("invalid_request", "grant_type is required.");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return tokenError("unsupported_grant_type", "Unsupported grant_type.");
  }

  // Public clients: no secret, the client_id only says whose code or token this is.
  const client = findClient(form.get("client_id") ?? "");
  if (!client) return tokenError("invalid_client", "Unknown client.");

  return grantType === "authorization_code" ? exchangeCode(form, client.clientId) : refresh(form, client.clientId);
}
