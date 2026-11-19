// US #10 — Cloudflare Access token verification module (supports C45 and C46).
//
// Contract:
// - `src/lib/auth/cloudflare-access.ts` exports
//     verifyAccessToken(
//       token: string | null | undefined,
//       options: {
//         teamDomain: string;          // e.g. "myteam.cloudflareaccess.com"
//         audience: string;            // Access application AUD tag
//         adminEmails: readonly string[];
//         jwks?: JWTVerifyGetKey;      // injectable key source (jose); defaults to the
//                                      // cached remote JWKS of the team certs URL
//       },
//     ): Promise<{ ok: true; email: string } | { ok: false }>
//   (extra fields allowed, e.g. a server-side `reason` on failures).
// - It never throws on a bad token: it resolves `{ ok: false }`.
import { createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyAccessToken } from "../../src/lib/auth/cloudflare-access";
import {
  ADMIN_EMAIL,
  AUD,
  hs256AccessToken,
  makeAccessKeys,
  signAccessToken,
  TEAM_DOMAIN,
  unsignedAccessToken,
  type AccessKeys,
} from "../helpers/access";

let keys: AccessKeys;
let otherKeys: AccessKeys;

beforeAll(async () => {
  keys = await makeAccessKeys("test-key-1");
  otherKeys = await makeAccessKeys("test-key-1");
});

function options(overrides: Partial<{ adminEmails: string[]; audience: string; teamDomain: string }> = {}) {
  return {
    teamDomain: TEAM_DOMAIN,
    audience: AUD,
    adminEmails: [ADMIN_EMAIL],
    jwks: createLocalJWKSet(keys.jwks),
    ...overrides,
  };
}

describe("verifyAccessToken", () => {
  it("C46 — given a valid RS256 token for an admin e-mail, when it is verified, then it is accepted with that e-mail", async () => {
    const result = await verifyAccessToken(await signAccessToken(keys), options());

    expect(result).toMatchObject({ ok: true, email: ADMIN_EMAIL });
  });

  it("C46 — given an admin e-mail with a different case, when it is verified, then it is accepted", async () => {
    const token = await signAccessToken(keys, { email: "OWNER@example.com" });
    const result = await verifyAccessToken(token, options({ adminEmails: ["Owner@Example.com"] }));

    expect(result.ok).toBe(true);
  });

  it("C45 — given no token, when it is verified, then it is refused", async () => {
    expect((await verifyAccessToken(undefined, options())).ok).toBe(false);
    expect((await verifyAccessToken(null, options())).ok).toBe(false);
    expect((await verifyAccessToken("", options())).ok).toBe(false);
  });

  it("C45 — given malformed, unsigned or HS256 tokens, when they are verified, then they are refused without throwing", async () => {
    for (const token of ["not-a-jwt", "a.b.c", unsignedAccessToken(), await hs256AccessToken()]) {
      await expect(verifyAccessToken(token, options())).resolves.toMatchObject({ ok: false });
    }
  });

  it("C45 — given a token signed by another key, when it is verified, then it is refused", async () => {
    const result = await verifyAccessToken(await signAccessToken(otherKeys), options());

    expect(result.ok).toBe(false);
  });

  it("C45 — given a wrong audience, a wrong issuer or an expired token, when it is verified, then it is refused", async () => {
    const now = Math.floor(Date.now() / 1000);
    const tokens = [
      await signAccessToken(keys, { audience: ["another-application-aud"] }),
      await signAccessToken(keys, { issuer: "https://another-team.cloudflareaccess.com" }),
      await signAccessToken(keys, { issuedAt: now - 7200, expiresAt: now - 3600 }),
    ];
    for (const token of tokens) {
      expect((await verifyAccessToken(token, options())).ok).toBe(false);
    }
  });

  it("C45 — given a valid token for an e-mail outside the admin list, or without e-mail, when it is verified, then it is refused", async () => {
    const outsider = await signAccessToken(keys, { email: "visitor@example.org" });
    const noEmail = await signAccessToken(keys, { email: null });

    expect((await verifyAccessToken(outsider, options())).ok).toBe(false);
    expect((await verifyAccessToken(noEmail, options())).ok).toBe(false);
  });

  it("C45 — given an empty admin list, when a valid token is verified, then it is refused (fail closed)", async () => {
    const result = await verifyAccessToken(await signAccessToken(keys), options({ adminEmails: [] }));

    expect(result.ok).toBe(false);
  });
});
