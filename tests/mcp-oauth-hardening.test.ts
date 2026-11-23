// US #12, hardening of the OAuth login (security review): brute-force lockout, weak password,
// revocation of tokens when the password changes, absolute refresh lifetime, body limits, and
// small login-page / registration details.
import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeRequest, makeMigratedDatabase, MCP_TEST_TOKEN } from "./helpers/mcp";
import {
  authorizeGet,
  dumpTable,
  authorizePost,
  call,
  CLAUDE_REDIRECT_URI,
  countRows,
  fullFlow,
  loadRoutes,
  makePkce,
  OWNER_PASSWORD,
  PUBLIC_URL,
  registerClient,
  registerRequest,
  tokenRequest,
  type Routes,
} from "./helpers/oauth";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

let databasePath: string;
let routes: Routes;

beforeEach(async () => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
  vi.stubEnv("PUBLIC_URL", PUBLIC_URL);
  vi.stubEnv("MCP_OAUTH_PASSWORD", OWNER_PASSWORD);
  vi.stubEnv("MCP_OAUTH_REDIRECT_URIS", undefined);
  vi.resetModules();
  routes = await loadRoutes();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function advance(ms: number): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + ms);
}

async function bearerStatus(token: string): Promise<number> {
  return (await call(routes.mcp, initializeRequest({ Authorization: `Bearer ${token}` }))).status;
}

async function authorizeParams() {
  const clientId = await registerClient(routes);
  const pkce = makePkce();
  return { clientId, pkce, params: { client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: pkce.challenge, state: "s" } };
}

describe("C53 — brute force on the login form", () => {
  it("C53 — given 5 wrong passwords, when the right one is typed, then 429, no code, and the lockout is logged without the guess", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { params } = await authorizeParams();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await call(routes.authorize, authorizePost(params, `guess-${attempt}-secret`))).status).toBe(401);
    }

    const locked = await call(routes.authorize, authorizePost(params, OWNER_PASSWORD));
    expect(locked.status).toBe(429);
    expect(locked.headers.get("location")).toBeNull();
    expect(locked.headers.get("cache-control")).toBe("no-store");
    expect(locked.headers.get("content-type")).toContain("text/html");
    expect(await locked.text()).toMatch(/Trop de tentatives/);
    expect(countRows(databasePath, "oauth_codes")).toBe(0);
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toMatch(/locked/i);
    expect(logged).not.toContain("guess-");
  });

  it("C53 — given a lockout, when 15 minutes have passed, then the right password works again", async () => {
    const { params } = await authorizeParams();
    for (let attempt = 0; attempt < 5; attempt++) await call(routes.authorize, authorizePost(params, "wrong password!!"));
    expect((await call(routes.authorize, authorizePost(params, OWNER_PASSWORD))).status).toBe(429);

    advance(15 * 60 * 1000 + 1000);
    expect((await call(routes.authorize, authorizePost(params, OWNER_PASSWORD))).status).toBe(302);
  });

  it("C53 — given 4 wrong passwords, when the right one is typed, then it is accepted", async () => {
    const { params } = await authorizeParams();
    for (let attempt = 0; attempt < 4; attempt++) await call(routes.authorize, authorizePost(params, "wrong password!!"));
    expect((await call(routes.authorize, authorizePost(params, OWNER_PASSWORD))).status).toBe(302);
  });
});

function fromAddress(address: string, request: Request): Request {
  return new Request(request, { headers: new Headers([...request.headers, ["CF-Connecting-IP", address]]) });
}

describe("C53 — the lockout is per client address", () => {
  it("C53 — given an attacker locked out, when the owner logs in from another address, then the login works", async () => {
    const { params } = await authorizeParams();
    for (let attempt = 0; attempt < 5; attempt++) {
      await call(routes.authorize, fromAddress("203.0.113.9", authorizePost(params, "wrong password!!")));
    }
    expect((await call(routes.authorize, fromAddress("203.0.113.9", authorizePost(params, OWNER_PASSWORD)))).status).toBe(429);
    expect((await call(routes.authorize, fromAddress("198.51.100.4", authorizePost(params, OWNER_PASSWORD)))).status).toBe(302);
  });

  it("C53 — given failures from many addresses, when the global ceiling of 50 is reached, then everyone is locked out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { params } = await authorizeParams();
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await call(routes.authorize, fromAddress(`192.0.2.${attempt}`, authorizePost(params, "wrong password!!")));
      expect(response.status).toBe(401);
    }
    expect((await call(routes.authorize, fromAddress("198.51.100.4", authorizePost(params, OWNER_PASSWORD)))).status).toBe(429);
  });
});

describe("C52 — nothing stored lets anyone check a guessed password quickly", () => {
  it("C52 — given tokens issued, when the database is read, then no value is a plain hash of the password and the verifier is scrypt", async () => {
    await fullFlow(routes);
    const db = new DatabaseSync(databasePath, { readOnly: true });
    const meta = JSON.stringify(db.prepare("SELECT * FROM app_meta").all());
    db.close();
    const stored = `${meta}${dumpTable(databasePath, "oauth_tokens")}`;

    const fast = [
      createHash("sha256").update(OWNER_PASSWORD).digest("hex"),
      createHash("sha256").update(OWNER_PASSWORD).digest("base64url"),
      createHmac("sha256", "trafic-bourse oauth credential v1").update(OWNER_PASSWORD).digest("hex"),
      OWNER_PASSWORD,
    ];
    for (const value of fast) expect(stored).not.toContain(value);
    expect(meta).toMatch(/scrypt\$32768\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}/);
  });

  it("C52 — given the same password after a restart, when a token is checked, then it is still valid; a new password is a new generation", async () => {
    const { tokens } = await fullFlow(routes);
    vi.resetModules();
    routes = await loadRoutes();
    expect(await bearerStatus(tokens.access_token)).toBe(200);

    vi.stubEnv("MCP_OAUTH_PASSWORD", "yet another long password");
    expect(await bearerStatus(tokens.access_token)).toBe(401);
    vi.stubEnv("MCP_OAUTH_PASSWORD", OWNER_PASSWORD);
    // Back to the old password: it is a third generation, the old tokens stay dead.
    expect(await bearerStatus(tokens.access_token)).toBe(401);
  });
});

describe("C53 — a weak password is refused", () => {
  it("C53 — given a MCP_OAUTH_PASSWORD of 15 characters, when it is typed, then it is refused, logged, and no code is issued", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const weak = "a".repeat(15);
    vi.stubEnv("MCP_OAUTH_PASSWORD", weak);
    const { params } = await authorizeParams();

    expect((await call(routes.authorize, authorizePost(params, weak))).status).toBe(401);
    expect(countRows(databasePath, "oauth_codes")).toBe(0);
    expect(error.mock.calls.flat().join(" ")).toMatch(/shorter than 16/);
    expect(error.mock.calls.flat().join(" ")).not.toContain(weak);
  });

  it("C53 — given a password of exactly 16 characters, when it is typed, then it is accepted", async () => {
    const password = "b".repeat(16);
    vi.stubEnv("MCP_OAUTH_PASSWORD", password);
    const { params } = await authorizeParams();
    expect((await call(routes.authorize, authorizePost(params, password))).status).toBe(302);
  });
});

describe("C52 — tokens die with the password and with age", () => {
  it("C52 — given tokens issued, when the password is changed, then the access token and the refresh token both fail", async () => {
    const { clientId, tokens } = await fullFlow(routes);
    expect(await bearerStatus(tokens.access_token)).toBe(200);

    vi.stubEnv("MCP_OAUTH_PASSWORD", "another long owner password");
    expect(await bearerStatus(tokens.access_token)).toBe(401);
    const refreshed = await call(
      routes.token,
      tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }),
    );
    expect(refreshed.status).toBe(400);
    expect(((await refreshed.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("C52 — given tokens issued, when the password is removed, then they stop working", async () => {
    const { tokens } = await fullFlow(routes);
    vi.stubEnv("MCP_OAUTH_PASSWORD", "");
    expect(await bearerStatus(tokens.access_token)).toBe(401);
  });

  it("C52 — given a login 91 days old kept alive by refreshes, when it is refreshed again, then invalid_grant", async () => {
    const { clientId, tokens } = await fullFlow(routes);
    let refreshToken = tokens.refresh_token;
    const day = 24 * 3600 * 1000;
    // Each refresh is within the 30 days of the previous one, yet the chain stops 90 days after the login.
    for (let step = 0; step < 2; step++) {
      advance(29 * day);
      const response = await call(routes.token, tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }));
      expect(response.status).toBe(200);
      refreshToken = ((await response.json()) as { refresh_token: string }).refresh_token;
    }
    advance(29 * day); // 87 days
    const lastAllowed = await call(routes.token, tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }));
    expect(lastAllowed.status).toBe(200);
    refreshToken = ((await lastAllowed.json()) as { refresh_token: string }).refresh_token;

    advance(4 * day); // 91 days
    const refused = await call(routes.token, tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }));
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("C52 — given a code presented a second time, when it was already exchanged, then the tokens it produced are revoked", async () => {
    const clientId = await registerClient(routes);
    const pkce = makePkce();
    const params = { client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: pkce.challenge };
    const redirect = await call(routes.authorize, authorizePost(params, OWNER_PASSWORD));
    const code = new URL(redirect.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const exchange = () =>
      call(
        routes.token,
        tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_verifier: pkce.verifier }),
      );

    const first = (await (await exchange()).json()) as { access_token: string };
    expect(await bearerStatus(first.access_token)).toBe(200);
    expect((await exchange()).status).toBe(400);
    expect(await bearerStatus(first.access_token)).toBe(401);
  });
});

describe("C51 — login page and endpoints, details", () => {
  it("C51 — given a client named with markup, when the login page opens, then the name is escaped and the warning is shown", async () => {
    const response = await call(
      routes.register,
      registerRequest({ client_name: `<script>alert(1)</script>`, redirect_uris: [CLAUDE_REDIRECT_URI] }),
    );
    const clientId = ((await response.json()) as { client_id: string }).client_id;
    const page = await call(
      routes.authorize,
      authorizeGet({ client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: makePkce().challenge }),
    );
    const html = await page.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&#60;script&#62;alert(1)&#60;/script&#62;");
    expect(html).toContain("Ne saisissez ce mot de passe que si vous venez d'ajouter le connecteur vous-même dans Claude.");
  });

  it("C51 — given a redirect URI no longer on the allowlist, when authorize is opened or submitted, then 400 and no code", async () => {
    const { params } = await authorizeParams();
    vi.stubEnv("MCP_OAUTH_REDIRECT_URIS", "https://other.example.com/cb");
    expect((await call(routes.authorize, authorizeGet(params))).status).toBe(400);
    expect((await call(routes.authorize, authorizePost(params, OWNER_PASSWORD))).status).toBe(400);
    expect(countRows(databasePath, "oauth_codes")).toBe(0);
  });

  it("C51 — given a state longer than 2048 characters, when authorize is opened or submitted, then the 400 page", async () => {
    const { params } = await authorizeParams();
    const long = { ...params, state: "x".repeat(2049) };
    expect((await call(routes.authorize, authorizeGet(long))).status).toBe(400);
    expect((await call(routes.authorize, authorizePost(long, OWNER_PASSWORD))).status).toBe(400);
    expect(countRows(databasePath, "oauth_codes")).toBe(0);
  });

  it("C51 — given a registration asking for client_secret_basic, when it is registered, then the answer says none", async () => {
    const response = await call(
      routes.register,
      registerRequest({ redirect_uris: [CLAUDE_REDIRECT_URI], token_endpoint_auth_method: "client_secret_basic" }),
    );
    expect(response.status).toBe(201);
    expect(((await response.json()) as { token_endpoint_auth_method: string }).token_endpoint_auth_method).toBe("none");
  });

  it("C51 — given a body over 16 kB, when it is sent to authorize, token or register, then 413", async () => {
    const big = "x".repeat(17 * 1024);
    const { params } = await authorizeParams();
    const authorize = await call(routes.authorize, authorizePost({ ...params, state: "s" }, big));
    const token = await call(routes.token, tokenRequest({ grant_type: "authorization_code", code: big, client_id: params.client_id }));
    const register = await call(routes.register, registerRequest({ redirect_uris: [CLAUDE_REDIRECT_URI], client_name: big }));
    expect([authorize.status, token.status, register.status]).toEqual([413, 413, 413]);
    expect(countRows(databasePath, "oauth_codes")).toBe(0);
  });
});

describe("C51 — the MCP_TOKEN log", () => {
  it("C51 — given OAuth configured and no MCP_TOKEN, when a request is refused, then nothing is logged about MCP_TOKEN", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("MCP_TOKEN", "");
    expect(await bearerStatus("whatever")).toBe(401);
    expect(error.mock.calls.flat().join(" ")).not.toContain("MCP_TOKEN");
  });

  it("C51 — given neither MCP_TOKEN nor PUBLIC_URL, when a request is refused, then it is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("MCP_TOKEN", "");
    vi.stubEnv("PUBLIC_URL", "");
    expect(await bearerStatus("whatever")).toBe(401);
    expect(error.mock.calls.flat().join(" ")).toContain("MCP_TOKEN is not set");
  });
});
