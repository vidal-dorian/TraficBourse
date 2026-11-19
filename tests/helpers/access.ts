// Test doubles for Cloudflare Access (US #10).
//
// A locally generated RS256 key pair stands in for the Access team signing keys.
// `stubAccessCerts()` replaces the global `fetch` so that the team's public certs
// URL (`https://<team domain>/cdn-cgi/access/certs`) serves the local JWKS, and any
// other network call fails: Cloudflare is never called from the tests.
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JSONWebKeySet, type JWTPayload } from "jose";
import { vi } from "vitest";

export const TEAM_DOMAIN = "test-team.cloudflareaccess.com";
export const ISSUER = `https://${TEAM_DOMAIN}`;
export const CERTS_URL = `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`;
export const AUD = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
export const ADMIN_EMAIL = "owner@example.com";
export const OTHER_ADMIN_EMAIL = "second-owner@example.com";

export type AccessKeys = {
  kid: string;
  privateKey: CryptoKey;
  jwks: JSONWebKeySet;
};

/** A fresh RS256 key pair and the JWKS that publishes its public half. */
export async function makeAccessKeys(kid = "test-key-1"): Promise<AccessKeys> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  return { kid, privateKey, jwks: { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] } };
}

export type TokenOptions = {
  email?: string | null;
  issuer?: string;
  audience?: string | string[];
  /** Seconds since epoch. Defaults to 10 minutes from now. */
  expiresAt?: number;
  /** Seconds since epoch. Defaults to now. */
  issuedAt?: number;
  extraClaims?: JWTPayload;
};

/** Signs an Access-like application token (RS256) with the given key. */
export async function signAccessToken(keys: AccessKeys, options: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const email = options.email === undefined ? ADMIN_EMAIL : options.email;
  const claims: JWTPayload = { type: "app", identity_nonce: "nonce", ...options.extraClaims };
  if (email !== null) claims.email = email;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: keys.kid, typ: "JWT" })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? [AUD])
    .setSubject("7335d417-61da-459d-899c-0a01c76a2f94")
    .setIssuedAt(options.issuedAt ?? now)
    .setNotBefore(options.issuedAt ?? now)
    .setExpirationTime(options.expiresAt ?? now + 600)
    .sign(keys.privateKey);
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** An unsigned token (`alg: none`) carrying otherwise valid claims. */
export function unsignedAccessToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "none", typ: "JWT" });
  const payload = base64url({ email: ADMIN_EMAIL, iss: ISSUER, aud: [AUD], iat: now, exp: now + 600 });
  return `${header}.${payload}.`;
}

/** An HS256 token signed with a shared secret instead of the Access RSA key. */
export async function hs256AccessToken(): Promise<string> {
  return new SignJWT({ email: ADMIN_EMAIL })
    .setProtectedHeader({ alg: "HS256", kid: "test-key-1" })
    .setIssuer(ISSUER)
    .setAudience([AUD])
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode("a-shared-secret-that-is-not-the-access-key"));
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

/**
 * Replaces the global `fetch`: the Access certs URL of TEAM_DOMAIN answers with `jwks`,
 * anything else throws. Undo with `vi.unstubAllGlobals()`.
 */
export function stubAccessCerts(jwks: JSONWebKeySet) {
  const fetchStub = vi.fn(async (input: unknown) => {
    const url = urlOf(input);
    if (url === CERTS_URL) {
      return new Response(JSON.stringify({ ...jwks, public_cert: {}, public_certs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected network call in a test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

/** Valid Access configuration for the app, with ADMIN_AUTH_DISABLED unset. */
export function stubAccessEnv(overrides: Record<string, string | undefined> = {}): void {
  const env: Record<string, string | undefined> = {
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUD,
    ADMIN_EMAILS: `${ADMIN_EMAIL}, ${OTHER_ADMIN_EMAIL}`,
    ADMIN_AUTH_DISABLED: undefined,
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}
