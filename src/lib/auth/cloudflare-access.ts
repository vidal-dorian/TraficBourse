// Cloudflare Access verification for /admin (CLAUDE.md §8).
//
// Cloudflare Access already guards /admin at the edge; the app checks the
// `Cf-Access-Jwt-Assertion` token again so a request that bypasses Cloudflare
// (or a misconfigured Access rule) can never open the admin pages.
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

export type AccessConfig = {
  /** Access team domain, e.g. "myteam.cloudflareaccess.com" (no scheme, no path). */
  teamDomain: string;
  /** Application Audience (AUD) tag of the Access application protecting /admin. */
  audience: string;
  /** Lower-cased admin e-mails. */
  adminEmails: string[];
};

export type AccessConfigResult = { ok: true; config: AccessConfig } | { ok: false; problems: string[] };

export type VerifyOptions = {
  teamDomain: string;
  audience: string;
  adminEmails: readonly string[];
  /** Key source; defaults to the cached remote JWKS of the team certs URL. */
  jwks?: JWTVerifyGetKey;
};

/** Server-side only: never sent to the visitor. */
export type RefusalReason = "missing_token" | "no_admin_emails" | "invalid_token" | "keys_unavailable" | "not_admin";

export type VerifyResult = { ok: true; email: string } | { ok: false; reason: RefusalReason };

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** Splits a comma-separated list of e-mails, trimming spaces and ignoring case. */
export function parseAdminEmails(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

/** Reads the Access settings from the environment; any missing or invalid value is reported. */
export function readAccessConfig(env: Record<string, string | undefined>): AccessConfigResult {
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN ?? "").trim();
  const audience = (env.CF_ACCESS_AUD ?? "").trim();
  const adminEmails = parseAdminEmails(env.ADMIN_EMAILS);

  const problems: string[] = [];
  if (!teamDomain) problems.push("CF_ACCESS_TEAM_DOMAIN is not set");
  else if (!HOSTNAME.test(teamDomain)) problems.push("CF_ACCESS_TEAM_DOMAIN must be a bare host name");
  if (!audience) problems.push("CF_ACCESS_AUD is not set");
  if (adminEmails.length === 0) problems.push("ADMIN_EMAILS is not set");

  return problems.length > 0 ? { ok: false, problems } : { ok: true, config: { teamDomain, audience, adminEmails } };
}

/**
 * Local dev escape hatch: `ADMIN_AUTH_DISABLED=true` skips the check, but never when
 * NODE_ENV is "production", so a stray env var cannot open the production image.
 */
export function isAdminAuthDisabled(env: Record<string, string | undefined>): boolean {
  return env.ADMIN_AUTH_DISABLED === "true" && env.NODE_ENV !== "production";
}

// One remote key set per team domain: jose caches the fetched keys and refreshes them
// when an unknown `kid` shows up (Access rotates its keys).
const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function remoteKeySet(teamDomain: string): JWTVerifyGetKey {
  let keySet = remoteKeySets.get(teamDomain);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    remoteKeySets.set(teamDomain, keySet);
  }
  return keySet;
}

function isKeyFetchFailure(error: unknown): boolean {
  if (!(error instanceof errors.JOSEError)) return true;
  return error.code === "ERR_JWKS_TIMEOUT" || error.code === "ERR_JWKS_INVALID";
}

/**
 * Verifies an Access application token: RS256 signature from the team keys, issuer,
 * audience, expiry, and an `email` claim listed in `adminEmails` (case-insensitive).
 * Never throws: any failure resolves `{ ok: false }`.
 */
export async function verifyAccessToken(token: string | null | undefined, options: VerifyOptions): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: "missing_token" };

  const admins = new Set(options.adminEmails.map((email) => email.trim().toLowerCase()).filter(Boolean));
  if (admins.size === 0) return { ok: false, reason: "no_admin_emails" };

  try {
    const { payload } = await jwtVerify(token, options.jwks ?? remoteKeySet(options.teamDomain), {
      issuer: `https://${options.teamDomain}`,
      audience: options.audience,
      algorithms: ["RS256"],
    });
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    if (!email || !admins.has(email.toLowerCase())) return { ok: false, reason: "not_admin" };
    return { ok: true, email };
  } catch (error) {
    return { ok: false, reason: isKeyFetchFailure(error) ? "keys_unavailable" : "invalid_token" };
  }
}
