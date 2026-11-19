// US #10 — only the owner can open /admin (C44, C45, C46 on the middleware side).
//
// Contract:
// - `src/middleware.ts` exports `middleware(request: NextRequest)` (sync or async) and
//   `config` with a `matcher` that covers `/admin` and `/admin/...` only: public pages
//   and `/api/health` never go through the Access check.
// - The token is read from the `Cf-Access-Jwt-Assertion` request header and verified
//   as RS256 against the Access team keys, fetched from
//   `https://${CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs` (the tests double the
//   global `fetch`), with issuer `https://${CF_ACCESS_TEAM_DOMAIN}`, audience
//   `CF_ACCESS_AUD`, and an `email` claim that must be one of `ADMIN_EMAILS`
//   (comma-separated, spaces allowed, case-insensitive).
// - Accepted request: the middleware lets it through (`NextResponse.next()` or no response).
// - Refused request: HTTP 403, `text/plain` body with a short French refusal
//   (e.g. « Accès refusé. »), identical whatever the reason, `Cache-Control: no-store`.
// - Fail closed: missing CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD or ADMIN_EMAILS → 403 and a
//   server-side warning (`console.warn` or `console.error`).
// - `ADMIN_AUTH_DISABLED=true` lets every /admin request through only when
//   NODE_ENV !== "production".
import type { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_EMAIL,
  AUD,
  CERTS_URL,
  hs256AccessToken,
  makeAccessKeys,
  OTHER_ADMIN_EMAIL,
  signAccessToken,
  stubAccessCerts,
  stubAccessEnv,
  unsignedAccessToken,
  type AccessKeys,
} from "./helpers/access";

type MiddlewareResult = Response | null | undefined | void;
type Middleware = (request: NextRequest) => MiddlewareResult | Promise<MiddlewareResult>;

async function loadMiddleware(): Promise<{ middleware: Middleware; config: { matcher?: unknown } }> {
  const mod = await import("../src/middleware");
  return mod as unknown as { middleware: Middleware; config: { matcher?: unknown } };
}

async function callMiddleware(path: string, token?: string): Promise<MiddlewareResult> {
  const { NextRequest } = await import("next/server");
  const { middleware } = await loadMiddleware();
  const headers = new Headers();
  if (token !== undefined) headers.set("Cf-Access-Jwt-Assertion", token);
  return middleware(new NextRequest(`http://localhost:3000${path}`, { headers }));
}

function expectPassThrough(result: MiddlewareResult): void {
  if (result === undefined || result === null) return;
  expect(result.status, "the request must not be refused").not.toBe(403);
  expect(result.status).toBe(200);
  // NextResponse.next() marks the response with this header; rewrites and redirects do not.
  expect(result.headers.get("x-middleware-next")).toBe("1");
}

const REFUSAL_DETAILS = /token|jeton|jwt|signature|expir|e-?mail|audience|issuer|émetteur|config/i;

async function expectDenied(result: MiddlewareResult): Promise<string> {
  expect(result, "the middleware must answer with a 403 response").toBeTruthy();
  const response = result as Response;
  expect(response.status).toBe(403);
  expect(response.headers.get("content-type") ?? "").toMatch(/^text\/plain/);
  expect(response.headers.get("cache-control") ?? "").toMatch(/no-store/);
  const body = (await response.text()).trim();
  expect(body.length).toBeGreaterThan(0);
  expect(body.length).toBeLessThanOrEqual(120);
  expect(body).toMatch(/accès refusé|refusé|interdit|non autorisé/i);
  expect(body, "the refusal must not explain why").not.toMatch(REFUSAL_DETAILS);
  return body;
}

let keys: AccessKeys;
let otherKeys: AccessKeys;

beforeAll(async () => {
  keys = await makeAccessKeys("test-key-1");
  // Same kid, different key: a token forged by someone who does not hold the Access key.
  otherKeys = await makeAccessKeys("test-key-1");
});

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  stubAccessCerts(keys.jwks);
  stubAccessEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("C44 — public pages display without any login", () => {
  it.each(["/", "/api/health", "/archives", "/brief/2026-11-19", "/marches"])(
    "C44 — given a visitor, when they open the public page %s, then the Access check does not run on it",
    async (path) => {
      const { config } = await loadMiddleware();
      expect(config.matcher, "the middleware must declare a matcher").toBeDefined();

      expect(
        unstable_doesMiddlewareMatch({ config: config as Parameters<typeof unstable_doesMiddlewareMatch>[0]["config"], url: path }),
      ).toBe(false);
    },
  );

  it("C44 — given a visitor without any Access token nor Access config, when they open the home page, then it renders in French", async () => {
    stubAccessEnv({ CF_ACCESS_TEAM_DOMAIN: undefined, CF_ACCESS_AUD: undefined, ADMIN_EMAILS: undefined });
    const { config } = await loadMiddleware();
    expect(
      unstable_doesMiddlewareMatch({ config: config as Parameters<typeof unstable_doesMiddlewareMatch>[0]["config"], url: "/" }),
    ).toBe(false);

    const { default: HomePage } = await import("../src/app/page");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const element = await (HomePage as (props: unknown) => unknown)({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
    expect(html).toMatch(/bourse|marchés/i);
    expect(html).not.toMatch(/accès refusé/i);
  });
});

describe("C45 — /admin without a valid Access token answers 403", () => {
  it.each(["/admin", "/admin/watchlist", "/admin/journal/mcp"])(
    "C45 — given the path %s, when the middleware matcher is evaluated, then the Access check runs on it",
    async (path) => {
      const { config } = await loadMiddleware();
      expect(
        unstable_doesMiddlewareMatch({ config: config as Parameters<typeof unstable_doesMiddlewareMatch>[0]["config"], url: path }),
      ).toBe(true);
    },
  );

  it("C45 — given a request on /admin without Cf-Access-Jwt-Assertion, when it reaches the app, then the app answers 403", async () => {
    await expectDenied(await callMiddleware("/admin"));
  });

  it("C45 — given a request on an /admin sub-page without a token, when it reaches the app, then the app answers 403", async () => {
    await expectDenied(await callMiddleware("/admin/watchlist"));
  });

  it("C45 — given an empty Cf-Access-Jwt-Assertion header, when it reaches the app, then the app answers 403", async () => {
    await expectDenied(await callMiddleware("/admin", ""));
  });

  it("C45 — given a garbage token, when it reaches the app, then the app answers 403", async () => {
    await expectDenied(await callMiddleware("/admin", "not-a-jwt"));
  });

  it("C45 — given an unsigned token (alg none), when it reaches the app, then the app answers 403", async () => {
    await expectDenied(await callMiddleware("/admin", unsignedAccessToken()));
  });

  it("C45 — given an HS256 token signed with a shared secret, when it reaches the app, then the app answers 403", async () => {
    await expectDenied(await callMiddleware("/admin", await hs256AccessToken()));
  });

  it("C45 — given a token signed by a key that is not the Access team key, when it reaches the app, then the app answers 403", async () => {
    await expectDenied(await callMiddleware("/admin", await signAccessToken(otherKeys)));
  });

  it("C45 — given a token for another Access application (wrong audience), when it reaches the app, then the app answers 403", async () => {
    const token = await signAccessToken(keys, { audience: ["another-application-aud"] });
    await expectDenied(await callMiddleware("/admin", token));
  });

  it("C45 — given a token issued by another Access team (wrong issuer), when it reaches the app, then the app answers 403", async () => {
    const token = await signAccessToken(keys, { issuer: "https://another-team.cloudflareaccess.com" });
    await expectDenied(await callMiddleware("/admin", token));
  });

  it("C45 — given an expired token, when it reaches the app, then the app answers 403", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signAccessToken(keys, { issuedAt: now - 7200, expiresAt: now - 3600 });
    await expectDenied(await callMiddleware("/admin", token));
  });

  it("C45 — given a valid token for an e-mail that is not an admin, when it reaches the app, then the app answers 403", async () => {
    const token = await signAccessToken(keys, { email: "visitor@example.org" });
    await expectDenied(await callMiddleware("/admin", token));
  });

  it("C45 — given a valid token without an email claim, when it reaches the app, then the app answers 403", async () => {
    const token = await signAccessToken(keys, { email: null });
    await expectDenied(await callMiddleware("/admin", token));
  });

  it("C45 — given different refusal reasons, when the app answers 403, then the body is the same and says nothing about the reason", async () => {
    const now = Math.floor(Date.now() / 1000);
    const bodies = [
      await expectDenied(await callMiddleware("/admin")),
      await expectDenied(await callMiddleware("/admin", "not-a-jwt")),
      await expectDenied(await callMiddleware("/admin", await signAccessToken(otherKeys))),
      await expectDenied(await callMiddleware("/admin", await signAccessToken(keys, { expiresAt: now - 60, issuedAt: now - 120 }))),
      await expectDenied(await callMiddleware("/admin", await signAccessToken(keys, { email: "visitor@example.org" }))),
    ];
    expect(new Set(bodies).size).toBe(1);
  });

  it.each(["CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "ADMIN_EMAILS"])(
    "C45 — given %s is missing from the config, when a request with an otherwise valid token reaches /admin, then the app fails closed with 403 and logs a warning",
    async (missing) => {
      stubAccessEnv({ [missing]: undefined });
      const token = await signAccessToken(keys);

      await expectDenied(await callMiddleware("/admin", token));

      const warned = vi.mocked(console.warn).mock.calls.length + vi.mocked(console.error).mock.calls.length;
      expect(warned, "a server-side warning must be logged").toBeGreaterThan(0);
    },
  );

  it("C45 — given a blank ADMIN_EMAILS, when a request with an otherwise valid token reaches /admin, then the app answers 403", async () => {
    stubAccessEnv({ ADMIN_EMAILS: " , " });
    await expectDenied(await callMiddleware("/admin", await signAccessToken(keys)));
  });

  it("C45 — given ADMIN_AUTH_DISABLED=true in production, when a request without a token reaches /admin, then the app still answers 403", async () => {
    stubAccessEnv({ ADMIN_AUTH_DISABLED: "true" });
    vi.stubEnv("NODE_ENV", "production");

    await expectDenied(await callMiddleware("/admin"));
  });
});

describe("C46 — a valid Access token for the owner's e-mail opens /admin", () => {
  it("C46 — given a valid Access token for my e-mail, when I open /admin, then the middleware lets the request through", async () => {
    const fetchStub = stubAccessCerts(keys.jwks);
    const token = await signAccessToken(keys, { email: ADMIN_EMAIL });

    expectPassThrough(await callMiddleware("/admin", token));

    // The keys come from the Access team certs endpoint (doubled here), never from elsewhere.
    const urls = fetchStub.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url,
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toBe(CERTS_URL);
  });

  it("C46 — given a valid Access token for my e-mail, when I open an /admin sub-page, then the middleware lets the request through", async () => {
    expectPassThrough(await callMiddleware("/admin/watchlist", await signAccessToken(keys)));
  });

  it("C46 — given several admin e-mails configured, when the second one opens /admin, then the middleware lets the request through", async () => {
    expectPassThrough(await callMiddleware("/admin", await signAccessToken(keys, { email: OTHER_ADMIN_EMAIL })));
  });

  it("C46 — given my e-mail with a different case in the token, when I open /admin, then the middleware lets the request through", async () => {
    stubAccessEnv({ ADMIN_EMAILS: "Owner@Example.COM" });
    expectPassThrough(await callMiddleware("/admin", await signAccessToken(keys, { email: "owner@EXAMPLE.com" })));
  });

  it("C46 — given a token whose audience lists the configured AUD among others, when I open /admin, then the middleware lets the request through", async () => {
    const token = await signAccessToken(keys, { audience: ["another-application-aud", AUD] });
    expectPassThrough(await callMiddleware("/admin", token));
  });
});

describe("US #10 notes — local dev flag", () => {
  it.each(["development", "test"])(
    "given ADMIN_AUTH_DISABLED=true and NODE_ENV=%s, when a request without a token reaches /admin, then the middleware lets it through",
    async (nodeEnv) => {
      stubAccessEnv({ ADMIN_AUTH_DISABLED: "true", CF_ACCESS_TEAM_DOMAIN: undefined, CF_ACCESS_AUD: undefined, ADMIN_EMAILS: undefined });
      vi.stubEnv("NODE_ENV", nodeEnv);

      expectPassThrough(await callMiddleware("/admin"));
    },
  );

  it("given ADMIN_AUTH_DISABLED is unset in development, when a request without a token reaches /admin, then the app answers 403", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expectDenied(await callMiddleware("/admin"));
  });

  it("given ADMIN_AUTH_DISABLED=false in development, when a request without a token reaches /admin, then the app answers 403", async () => {
    stubAccessEnv({ ADMIN_AUTH_DISABLED: "false" });
    vi.stubEnv("NODE_ENV", "development");
    await expectDenied(await callMiddleware("/admin"));
  });
});
