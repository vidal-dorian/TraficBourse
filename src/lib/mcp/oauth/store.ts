// Storage of the OAuth clients, authorization codes and tokens. Codes and tokens are random
// 32-byte secrets; only their SHA-256 hash is stored, so a copy of the database grants nothing.
// Expiries are milliseconds since the epoch (`Date.now()`), flags are 0 or 1.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { oauthClients, oauthCodes, oauthTokens } from "@/lib/db/schema";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

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

export type CodeGrant = { clientId: string; redirectUri: string; codeChallenge: string; expiresAt: number };

/**
 * Marks the code as used and returns it, or undefined when unknown or already used. One atomic
 * statement, so two concurrent exchanges cannot both win; a code is burnt by its first attempt.
 */
export function consumeCode(code: string): CodeGrant | undefined {
  return getDb()
    .update(oauthCodes)
    .set({ used: 1 })
    .where(and(eq(oauthCodes.codeHash, hash(code)), eq(oauthCodes.used, 0)))
    .returning()
    .get();
}

export type IssuedTokens = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string };

/** Issues an access token (1 h) and a refresh token for the client. */
export function issueTokens(clientId: string): IssuedTokens {
  const accessToken = randomSecret();
  const refreshToken = randomSecret();
  const now = Date.now();
  getDb()
    .insert(oauthTokens)
    .values([
      { tokenHash: hash(accessToken), kind: "access", clientId, expiresAt: now + ACCESS_TOKEN_TTL_SECONDS * 1000 },
      { tokenHash: hash(refreshToken), kind: "refresh", clientId, expiresAt: now + REFRESH_TOKEN_TTL_MS },
    ])
    .run();
  return { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refreshToken };
}

/**
 * Revokes a live refresh token of the client and returns true; false when it is unknown,
 * of another client, expired or already revoked. One atomic statement, like `consumeCode`.
 */
export function revokeRefreshToken(refreshToken: string, clientId: string): boolean {
  const revoked = getDb()
    .update(oauthTokens)
    .set({ revoked: 1 })
    .where(
      and(
        eq(oauthTokens.tokenHash, hash(refreshToken)),
        eq(oauthTokens.kind, "refresh"),
        eq(oauthTokens.clientId, clientId),
        eq(oauthTokens.revoked, 0),
        gt(oauthTokens.expiresAt, Date.now()),
      ),
    )
    .returning({ tokenHash: oauthTokens.tokenHash })
    .all();
  return revoked.length > 0;
}

/** True for a live (unexpired, unrevoked) access token; any storage failure refuses. */
export function isValidAccessToken(token: string): boolean {
  try {
    const row = getDb()
      .select({ tokenHash: oauthTokens.tokenHash })
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.tokenHash, hash(token)),
          eq(oauthTokens.kind, "access"),
          eq(oauthTokens.revoked, 0),
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
