// Storage of the OAuth clients, authorization codes and tokens. Codes and tokens are random
// 32-byte secrets; only their SHA-256 hash is stored, so a copy of the database grants nothing.
// Expiries are milliseconds since the epoch (`Date.now()`), flags are 0 or 1.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { currentCredential } from "./config";
import { getDb } from "@/lib/db/client";
import { oauthClients, oauthCodes, oauthTokens } from "@/lib/db/schema";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
/** A login lasts at most this long, however often its refresh token is rotated. */
export const REFRESH_MAX_LIFETIME_MS = 90 * 24 * 3600 * 1000;

export function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

function hash(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export type OAuthClient = { clientId: string; redirectUris: string[]; clientName: string | null };

export function createClient(redirectUris: string[], clientName: string | null): OAuthClient {
  const clientId = randomBytes(16).toString("base64url");
  getDb().insert(oauthClients).values({ clientId, redirectUris, clientName }).run();
  return { clientId, redirectUris, clientName };
}

export function findClient(clientId: string): OAuthClient | undefined {
  return getDb().select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).get();
}

/** Stores a new authorization code for the client and returns the raw code to hand over. */
export function issueCode(input: { clientId: string; redirectUri: string; codeChallenge: string }): string {
  const code = randomSecret();
  getDb()
    .insert(oauthCodes)
    .values({ codeHash: hash(code), ...input, expiresAt: Date.now() + CODE_TTL_MS })
    .run();
  return code;
}

export type CodeGrant = { codeHash: string; clientId: string; redirectUri: string; codeChallenge: string; expiresAt: number };

/**
 * Marks the code as used and returns it, or undefined when unknown or already used. One atomic
 * statement, so two concurrent exchanges cannot both win; a code is burnt by its first attempt.
 * A code presented again is a sign it leaked: the tokens it produced are revoked.
 */
export function consumeCode(code: string): CodeGrant | undefined {
  const codeHash = hash(code);
  const grant = getDb()
    .update(oauthCodes)
    .set({ used: 1 })
    .where(and(eq(oauthCodes.codeHash, codeHash), eq(oauthCodes.used, 0)))
    .returning()
    .get();
  if (!grant) getDb().update(oauthTokens).set({ revoked: 1 }).where(eq(oauthTokens.codeHash, codeHash)).run();
  return grant;
}

export type IssuedTokens = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string };

/** Where a pair of tokens comes from: the login that started the chain and the code of that login. */
export type Lineage = { grantedAt: number; codeHash: string };

/**
 * Issues an access token (1 h) and a refresh token for the client, bound to the current password.
 * The refresh token never outlives `REFRESH_MAX_LIFETIME_MS` after `lineage.grantedAt`. Returns
 * undefined when no usable password is configured.
 */
export function issueTokens(clientId: string, lineage: Lineage): IssuedTokens | undefined {
  const credential = currentCredential();
  if (!credential) return undefined;
  const accessToken = randomSecret();
  const refreshToken = randomSecret();
  const now = Date.now();
  const { grantedAt, codeHash } = lineage;
  getDb()
    .insert(oauthTokens)
    .values([
      { tokenHash: hash(accessToken), kind: "access", clientId, expiresAt: now + ACCESS_TOKEN_TTL_SECONDS * 1000, grantedAt, credential, codeHash },
      {
        tokenHash: hash(refreshToken),
        kind: "refresh",
        clientId,
        expiresAt: Math.min(now + REFRESH_TOKEN_TTL_MS, grantedAt + REFRESH_MAX_LIFETIME_MS),
        grantedAt,
        credential,
        codeHash,
      },
    ])
    .run();
  return { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refreshToken };
}

/**
 * Revokes a live refresh token of the client and returns its lineage; undefined when it is
 * unknown, of another client, expired, older than 90 days, issued under another password or
 * already revoked. One atomic statement, like `consumeCode`.
 */
export function revokeRefreshToken(refreshToken: string, clientId: string): Lineage | undefined {
  const credential = currentCredential();
  if (!credential) return undefined;
  const now = Date.now();
  return getDb()
    .update(oauthTokens)
    .set({ revoked: 1 })
    .where(
      and(
        eq(oauthTokens.tokenHash, hash(refreshToken)),
        eq(oauthTokens.kind, "refresh"),
        eq(oauthTokens.clientId, clientId),
        eq(oauthTokens.revoked, 0),
        eq(oauthTokens.credential, credential),
        gt(oauthTokens.expiresAt, now),
        gt(oauthTokens.grantedAt, now - REFRESH_MAX_LIFETIME_MS),
      ),
    )
    .returning({ grantedAt: oauthTokens.grantedAt, codeHash: oauthTokens.codeHash })
    .get();
}

/** True for a live (unexpired, unrevoked) access token of the current password; any storage failure refuses. */
export function isValidAccessToken(token: string): boolean {
  try {
    const credential = currentCredential();
    if (!credential) return false;
    const row = getDb()
      .select({ tokenHash: oauthTokens.tokenHash })
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.tokenHash, hash(token)),
          eq(oauthTokens.kind, "access"),
          eq(oauthTokens.revoked, 0),
          eq(oauthTokens.credential, credential),
          gt(oauthTokens.expiresAt, Date.now()),
        ),
      )
      .get();
    return row !== undefined;
  } catch (error) {
    console.error("OAuth access token lookup failed", error);
    return false;
  }
}
