// US #10 — config helpers of the Cloudflare Access check (env parsing, dev flag, key fetch failures).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAdminAuthDisabled,
  parseAdminEmails,
  readAccessConfig,
  verifyAccessToken,
} from "../../src/lib/auth/cloudflare-access";
import { ADMIN_EMAIL, AUD, makeAccessKeys, signAccessToken, TEAM_DOMAIN } from "../helpers/access";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseAdminEmails", () => {
  it("splits on commas, trims spaces, lower-cases and drops blanks", () => {
    expect(parseAdminEmails(" Owner@Example.com ,, second@example.org , ")).toEqual([
      "owner@example.com",
      "second@example.org",
    ]);
  });

  it("returns an empty list for a missing or blank value", () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails(" , ")).toEqual([]);
  });
});

describe("readAccessConfig", () => {
  const valid = { CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN_EMAIL };

  it("returns the trimmed config when every value is set", () => {
    expect(readAccessConfig({ ...valid, CF_ACCESS_AUD: ` ${AUD} ` })).toEqual({
      ok: true,
      config: { teamDomain: TEAM_DOMAIN, audience: AUD, adminEmails: [ADMIN_EMAIL] },
    });
  });

  it("reports every missing value at once", () => {
    const result = readAccessConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toHaveLength(3);
  });

  it.each(["https://myteam.cloudflareaccess.com", "myteam.cloudflareaccess.com/", "localhost"])(
    "refuses a team domain that is not a bare host name (%s)",
    (teamDomain) => {
      expect(readAccessConfig({ ...valid, CF_ACCESS_TEAM_DOMAIN: teamDomain }).ok).toBe(false);
    },
  );
});

describe("isAdminAuthDisabled", () => {
  it.each([
    [{ ADMIN_AUTH_DISABLED: "true", NODE_ENV: "development" }, true],
    [{ ADMIN_AUTH_DISABLED: "true", NODE_ENV: "test" }, true],
    [{ ADMIN_AUTH_DISABLED: "true", NODE_ENV: "production" }, false],
    [{ ADMIN_AUTH_DISABLED: "1", NODE_ENV: "development" }, false],
    [{ ADMIN_AUTH_DISABLED: "TRUE", NODE_ENV: "development" }, false],
    [{ NODE_ENV: "development" }, false],
  ])("given %o, returns %s", (env, expected) => {
    expect(isAdminAuthDisabled(env)).toBe(expected);
  });
});

describe("verifyAccessToken with the remote team keys", () => {
  it("reports keys_unavailable when the certs endpoint cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const token = await signAccessToken(await makeAccessKeys());

    const result = await verifyAccessToken(token, {
      // A domain no other test uses, so no cached key set is reused.
      teamDomain: "unreachable-team.cloudflareaccess.com",
      audience: AUD,
      adminEmails: [ADMIN_EMAIL],
    });

    expect(result).toEqual({ ok: false, reason: "keys_unavailable" });
  });
});
