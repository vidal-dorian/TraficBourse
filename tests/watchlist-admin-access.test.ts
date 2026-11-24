// US #24 — C92: a visitor without Cloudflare Access cannot add or remove a stock.
//
// Two layers, because Next.js server actions can be POSTed to ANY path with a `Next-Action`
// header, which the middleware's path matcher never sees:
// 1. `src/middleware.ts` keeps covering `/admin/watchlist` (matcher + 403 without a valid token).
// 2. The write entry points re-check Access themselves. Contract (`src/lib/watchlist/owner-actions.ts`):
//    - `addStockAsOwner(ctx, result): Promise<{ ok: true; symbol: string; stored: number } | { ok: false; reason: "forbidden" }>`
//    - `removeStockAsOwner(ctx, symbol): Promise<{ ok: true } | { ok: false; reason: "forbidden" }>`
//    - `ctx = { headers: Headers; env: Record<string, string | undefined>; db: Db; provider: MarketDataProvider; now?: Date }`
//      (`provider` is not needed by `removeStockAsOwner`). The token is read from `Cf-Access-Jwt-Assertion`
//      and checked with `readAccessConfig` / `verifyAccessToken` (src/lib/auth/cloudflare-access.ts);
//      `ADMIN_AUTH_DISABLED=true` outside production lets it through. Any failure or missing config is
//      "forbidden", checked BEFORE any read of the provider or write to the database.
//    - The server actions of the page are thin wrappers that call these with `headers()` and `process.env`.
import type { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hs256AccessToken,
  makeAccessKeys,
  OTHER_ADMIN_EMAIL,
  signAccessToken,
  stubAccessCerts,
  stubAccessEnv,
  unsignedAccessToken,
  type AccessKeys,
} from "./helpers/access";
import { bar, fakeProvider, openMigrated } from "./helpers/prices";
import { AIR_LIQUIDE } from "./helpers/watchlist";

type Middleware = (request: NextRequest) => Promise<Response | null | undefined | void> | Response | null | undefined | void;

let keys: AccessKeys;
let otherKeys: AccessKeys;
const NOW = new Date("2026-11-23T07:00:00Z");

beforeAll(async () => {
  keys = await makeAccessKeys("test-key-1");
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

function headersWith(token?: string): Headers {
  const headers = new Headers();
  if (token !== undefined) headers.set("Cf-Access-Jwt-Assertion", token);
  return headers;
}

function setup() {
  const { sqlite, db } = openMigrated();
  const provider = fakeProvider({ "AI.PA": [bar("2026-11-20", 171)] });
  return { sqlite, db, provider, ctx: (headers: Headers) => ({ headers, env: { ...process.env }, db, provider, now: NOW }) };
}

function followed(sqlite: ReturnType<typeof openMigrated>["sqlite"]) {
  return sqlite.prepare("SELECT symbol FROM instruments WHERE in_watchlist = 1").all();
}

describe("C92 — the middleware covers the watchlist page", () => {
  it("C92 — given a visitor, when they open /admin/watchlist without a token, then the middleware answers 403", async () => {
    const { config, middleware } = (await import("../src/middleware")) as unknown as {
      config: Parameters<typeof unstable_doesMiddlewareMatch>[0]["config"];
      middleware: Middleware;
    };
    expect(unstable_doesMiddlewareMatch({ config, url: "/admin/watchlist" })).toBe(true);

    const { NextRequest } = await import("next/server");
    const response = (await middleware(new NextRequest("http://localhost:3000/admin/watchlist"))) as Response;
    expect(response.status).toBe(403);
  });
});

describe("C92 — the write entry points refuse a visitor without Access", () => {
  const refusals: [string, () => Promise<string | undefined>][] = [
    ["no token", async () => undefined],
    ["a token signed by someone else", async () => signAccessToken(otherKeys)],
    ["an unsigned token", async () => unsignedAccessToken()],
    ["an HS256 token", async () => hs256AccessToken()],
    ["an expired token", async () => signAccessToken(keys, { expiresAt: Math.floor(Date.now() / 1000) - 60, issuedAt: Math.floor(Date.now() / 1000) - 600 })],
    ["a token for another audience", async () => signAccessToken(keys, { audience: "other-aud" })],
    ["an e-mail that is not the owner's", async () => signAccessToken(keys, { email: "stranger@example.com" })],
  ];

  it.each(refusals)("C92 — given %s, when they add a stock, then it is refused and nothing is written nor fetched", async (_name, makeToken) => {
    const { addStockAsOwner } = await import("../src/lib/watchlist/owner-actions");
    const { sqlite, provider, ctx } = setup();
    const before = sqlite.prepare("SELECT COUNT(*) AS n FROM instruments").get();

    const outcome = await addStockAsOwner(ctx(headersWith(await makeToken())), AIR_LIQUIDE);

    expect(outcome).toEqual({ ok: false, reason: "forbidden" });
    expect(provider.calls).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM instruments").get()).toEqual(before);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM prices_daily").get()).toEqual({ n: 0 });
  });

  it.each(refusals)("C92 — given %s, when they remove a stock, then it is refused and the stock stays followed", async (_name, makeToken) => {
    const { removeStockAsOwner } = await import("../src/lib/watchlist/owner-actions");
    const { sqlite, ctx } = setup();
    sqlite.prepare("UPDATE instruments SET in_watchlist = 1 WHERE symbol = '^FCHI'").run();

    const outcome = await removeStockAsOwner(ctx(headersWith(await makeToken())), "^FCHI");

    expect(outcome).toEqual({ ok: false, reason: "forbidden" });
    expect(followed(sqlite)).toEqual([{ symbol: "^FCHI" }]);
  });

  it("C92 — given the Access configuration is missing, when someone adds a stock, then it is refused (fail closed)", async () => {
    stubAccessEnv({ CF_ACCESS_TEAM_DOMAIN: undefined, CF_ACCESS_AUD: undefined, ADMIN_EMAILS: undefined });
    const { addStockAsOwner } = await import("../src/lib/watchlist/owner-actions");
    const { sqlite, ctx } = setup();

    const outcome = await addStockAsOwner(ctx(headersWith(await signAccessToken(keys))), AIR_LIQUIDE);

    expect(outcome).toEqual({ ok: false, reason: "forbidden" });
    expect(followed(sqlite)).toEqual([]);
  });

  it("C92 — given ADMIN_AUTH_DISABLED in production, when someone without a token adds a stock, then it is still refused", async () => {
    stubAccessEnv({ ADMIN_AUTH_DISABLED: "true" });
    vi.stubEnv("NODE_ENV", "production");
    const { addStockAsOwner } = await import("../src/lib/watchlist/owner-actions");
    const { sqlite, ctx } = setup();

    expect(await addStockAsOwner(ctx(headersWith()), AIR_LIQUIDE)).toEqual({ ok: false, reason: "forbidden" });
    expect(followed(sqlite)).toEqual([]);
  });
});

describe("C92 — the owner, with a valid Access token, can write", () => {
  it("C92 — given a valid token for an admin e-mail, when I add a stock, then it is followed and its history stored", async () => {
    const { addStockAsOwner } = await import("../src/lib/watchlist/owner-actions");
    const { sqlite, ctx } = setup();

    const outcome = await addStockAsOwner(ctx(headersWith(await signAccessToken(keys))), AIR_LIQUIDE);

    expect(outcome).toEqual({ ok: true, symbol: "AI.PA", stored: 1 });
    expect(followed(sqlite)).toEqual([{ symbol: "AI.PA" }]);
  });

  it("C92 — given a valid token for the second admin e-mail, when I remove a stock, then it is no longer followed", async () => {
    const { removeStockAsOwner } = await import("../src/lib/watchlist/owner-actions");
    const { sqlite, ctx } = setup();
    sqlite.prepare("UPDATE instruments SET in_watchlist = 1 WHERE symbol = '^FCHI'").run();

    const outcome = await removeStockAsOwner(ctx(headersWith(await signAccessToken(keys, { email: OTHER_ADMIN_EMAIL }))), "^FCHI");

    expect(outcome).toEqual({ ok: true });
    expect(followed(sqlite)).toEqual([]);
  });

  it("C92 — given ADMIN_AUTH_DISABLED in local dev, when I add a stock without a token, then it works", async () => {
    stubAccessEnv({ ADMIN_AUTH_DISABLED: "true" });
    vi.stubEnv("NODE_ENV", "development");
    const { addStockAsOwner } = await import("../src/lib/watchlist/owner-actions");
    const { sqlite, ctx } = setup();

    expect((await addStockAsOwner(ctx(headersWith()), AIR_LIQUIDE)).ok).toBe(true);
    expect(followed(sqlite)).toEqual([{ symbol: "AI.PA" }]);
  });
});
