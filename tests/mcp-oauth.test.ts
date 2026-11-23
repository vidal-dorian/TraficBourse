// US #12 — OAuth for the Claude connector (CLAUDE.md §8, option B). Criteria:
// - C51: given the connector added in Claude without a header, when Claude connects, then it is
//   redirected to a login page of the app.
// - C52: given the login page, when I type my password, then Claude gets a token and can call the tools.
// - C53: given a wrong password, when I type it, then no token is issued.
//
// Contract (route handlers called directly with a Request, see tests/helpers/oauth.ts for the files):
// - Env: PUBLIC_URL (origin used in metadata), MCP_OAUTH_PASSWORD (owner password, blank = login always
//   refused), MCP_OAUTH_REDIRECT_URIS (optional allowlist, default the two Claude callback URLs).
// - GET /.well-known/oauth-protected-resource[/api/mcp]: { resource: `${PUBLIC_URL}/api/mcp`, authorization_servers: [PUBLIC_URL] }.
// - GET /.well-known/oauth-authorization-server: RFC 8414 metadata, S256 only, public clients.
// - POST /oauth/register (RFC 7591): 201 + client_id; other redirect URI -> 400 invalid_redirect_uri.
// - GET /oauth/authorize: 200 HTML login page (French, password field), 400 HTML page (never a redirect) on a
//   bad client or redirect URI. POST: right password -> 302 redirect_uri?code&state; wrong -> 401 login page.
// - POST /oauth/token: PKCE S256, single-use codes expiring after 10 min, access token 1 h, refresh rotation.
// - /api/mcp: accepts MCP_TOKEN or a live OAuth access token; every 401 carries WWW-Authenticate with resource_metadata.
// - Only SHA-256 hashes of codes and tokens are stored (tables oauth_clients, oauth_codes, oauth_tokens).
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validPayload } from "./fixtures/brief-payloads";
import { connectClient, initializeRequest, makeMigratedDatabase, MCP_TEST_TOKEN } from "./helpers/mcp";
import {
  authorizeGet,
  authorizePost,
  call,
  CLAUDE_REDIRECT_URI,
  countRows,
  dumpTable,
  fullFlow,
  loadRoutes,
  makePkce,
  obtainCode,
  OWNER_PASSWORD,
  PUBLIC_URL,
  registerClient,
  registerRequest,
  RESOURCE_METADATA_URL,
  RESOURCE_URL,
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
  const response = await call(routes.mcp, initializeRequest({ Authorization: `Bearer ${token}` }));
  return response.status;
}

describe("C51 — a connector without a header is sent to the login page of the app", () => {
  it("C51 — given no Authorization header, when Claude calls /api/mcp, then 401 with WWW-Authenticate pointing at the resource metadata", async () => {
    const response = await call(routes.mcp, initializeRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${RESOURCE_METADATA_URL}"`);
    expect(await response.text()).toBe("Non autorisé.");
  });

  it("C51 — given a wrong bearer token, when Claude calls /api/mcp, then the 401 also carries the resource metadata hint", async () => {
    const response = await call(routes.mcp, initializeRequest({ Authorization: "Bearer nope" }));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(`resource_metadata="${RESOURCE_METADATA_URL}"`);
  });

  it.each([
    ["protectedResource", "/.well-known/oauth-protected-resource"],
    ["protectedResourceMcp", "/.well-known/oauth-protected-resource/api/mcp"],
  ] as const)("C51 — given PUBLIC_URL, when Claude reads %s, then it names the MCP resource and this app as authorization server", async (key, path) => {
    const response = await call(routes[key], new Request(`${PUBLIC_URL}${path}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resource: RESOURCE_URL, authorization_servers: [PUBLIC_URL] });
  });

  it("C51 — given PUBLIC_URL, when Claude reads the authorization server metadata, then it lists the endpoints, S256 and public clients", async () => {
    const response = await call(routes.authorizationServer, new Request(`${PUBLIC_URL}/.well-known/oauth-authorization-server`));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: PUBLIC_URL,
      authorization_endpoint: `${PUBLIC_URL}/oauth/authorize`,
      token_endpoint: `${PUBLIC_URL}/oauth/token`,
      registration_endpoint: `${PUBLIC_URL}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("C51 — given a Claude redirect URI, when the client registers, then 201 with a client_id and its metadata", async () => {
    const response = await call(
      routes.register,
      registerRequest({ client_name: "Claude", redirect_uris: [CLAUDE_REDIRECT_URI], token_endpoint_auth_method: "none" }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { client_id: string; redirect_uris: string[]; client_name: string };
    expect(body.client_id.length).toBeGreaterThanOrEqual(16);
    expect(body.redirect_uris).toEqual([CLAUDE_REDIRECT_URI]);
    expect(body.client_name).toBe("Claude");
    expect(countRows(databasePath, "oauth_clients")).toBe(1);
  });

  it("C51 — given two registrations, when they complete, then the client_ids differ", async () => {
    const first = await registerClient(routes);
    const second = await registerClient(routes);

    expect(first).not.toBe(second);
  });

  it("C51 — given a redirect URI outside the allowlist, when the client registers, then 400 invalid_redirect_uri and nothing is stored", async () => {
    const response = await call(
      routes.register,
      registerRequest({ redirect_uris: ["https://evil.example.com/callback"], token_endpoint_auth_method: "none" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_redirect_uri" });
    expect(countRows(databasePath, "oauth_clients")).toBe(0);
  });

  it("C51 — given MCP_OAUTH_REDIRECT_URIS, when a client registers an URI of the list, then it is accepted, and the default Claude URI is refused", async () => {
    vi.stubEnv("MCP_OAUTH_REDIRECT_URIS", "https://inspector.example.com/cb, https://other.example.com/cb");
    vi.resetModules();
    routes = await loadRoutes();

    const ok = await call(routes.register, registerRequest({ redirect_uris: ["https://inspector.example.com/cb"], token_endpoint_auth_method: "none" }));
    const refused = await call(routes.register, registerRequest({ redirect_uris: [CLAUDE_REDIRECT_URI], token_endpoint_auth_method: "none" }));

    expect(ok.status).toBe(201);
    expect(refused.status).toBe(400);
  });

  it("C51 — given an invalid registration body, when the client registers, then 400 invalid_client_metadata", async () => {
    for (const body of ["not json", {}, { redirect_uris: [] }, { redirect_uris: "https://claude.ai/x" }]) {
      const response = await call(routes.register, registerRequest(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_client_metadata" });
    }
  });

  it("C51 — given a registered client, when Claude opens /oauth/authorize, then it gets a French login page with a password field", async () => {
    const clientId = await registerClient(routes);
    const pkce = makePkce();

    const response = await call(
      routes.authorize,
      authorizeGet({ client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: pkce.challenge, state: "abc", resource: RESOURCE_URL }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    const framing = `${response.headers.get("x-frame-options") ?? ""} ${response.headers.get("content-security-policy") ?? ""}`;
    expect(framing).toMatch(/DENY|frame-ancestors 'none'/);
    const html = await response.text();
    expect(html).toContain("Connexion");
    expect(html).toMatch(/<input[^>]*type="password"/i);
    expect(html).toMatch(/<button[^>]*type="submit"|<input[^>]*type="submit"/i);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="client_id"/i);
    expect(html).toContain(clientId);
    expect(countRows(databasePath, "oauth_codes")).toBe(0);
  });

  it.each([
    ["an unknown client_id", (p: { challenge: string }) => ({ client_id: "unknown-client", redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: p.challenge })],
    ["a redirect_uri the client did not register", (p: { challenge: string }, id: string) => ({ client_id: id, redirect_uri: "https://claude.com/api/mcp/auth_callback", code_challenge: p.challenge })],
  ])("C51 — given %s, when Claude opens /oauth/authorize, then a 400 page is shown and it never redirects", async (_label, build) => {
    const clientId = await registerClient(routes);
    const params = build(makePkce(), clientId);

    const response = await call(routes.authorize, authorizeGet(params));

    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("C51 — given a request without PKCE S256 or with a foreign resource, when Claude opens /oauth/authorize, then no login page is shown", async () => {
    const clientId = await registerClient(routes);
    const pkce = makePkce();
    const base = { client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: pkce.challenge };

    for (const params of [
      { ...base, code_challenge_method: "plain" },
      { ...base, response_type: "token" },
      { ...base, resource: "https://other.example.com/api/mcp" },
    ]) {
      const response = await call(routes.authorize, authorizeGet(params));
      expect(response.status).toBeGreaterThanOrEqual(300);
      expect(await response.clone().text()).not.toMatch(/type="password"/i);
    }
    const missingChallenge = await call(
      routes.authorize,
      new Request(`${PUBLIC_URL}/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(CLAUDE_REDIRECT_URI)}&code_challenge_method=S256`),
    );
    expect(await missingChallenge.text()).not.toMatch(/type="password"/i);
  });

  it("C51 — given PUBLIC_URL unset, when the OAuth endpoints and metadata are called, then 503 (or no metadata) and /api/mcp still answers 401 without the hint", async () => {
    vi.stubEnv("PUBLIC_URL", undefined);
    vi.resetModules();
    routes = await loadRoutes();

    const metadata = await call(routes.authorizationServer, new Request(`${PUBLIC_URL}/.well-known/oauth-authorization-server`));
    const register = await call(routes.register, registerRequest({ redirect_uris: [CLAUDE_REDIRECT_URI], token_endpoint_auth_method: "none" }));
    const mcp = await call(routes.mcp, initializeRequest());

    expect([404, 503]).toContain(metadata.status);
    expect(register.status).toBe(503);
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("www-authenticate") ?? "").not.toContain("resource_metadata");
  });
});

describe("C52 — typing the right password gives Claude a token that calls the tools", () => {
  it("C52 — given the login page, when I type the right password, then it redirects to the redirect_uri with a code and the state", async () => {
    const clientId = await registerClient(routes);
    const pkce = makePkce();

    const response = await call(
      routes.authorize,
      authorizePost({ client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: pkce.challenge, state: "state-123" }, OWNER_PASSWORD),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(CLAUDE_REDIRECT_URI);
    expect(location.searchParams.get("code")?.length).toBeGreaterThanOrEqual(32);
    expect(location.searchParams.get("state")).toBe("state-123");
    expect(countRows(databasePath, "oauth_codes")).toBe(1);
  });

  it("C52 — given a valid code and PKCE verifier, when Claude exchanges it, then it gets a bearer access token and a refresh token", async () => {
    const { tokens } = await fullFlow(routes);

    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.access_token.length).toBeGreaterThanOrEqual(32);
    expect(tokens.refresh_token.length).toBeGreaterThanOrEqual(32);
    expect(tokens.refresh_token).not.toBe(tokens.access_token);
  });

  it("C52 — given a token response, when Claude reads it, then it is JSON with Cache-Control no-store", async () => {
    const clientId = await registerClient(routes);
    const pkce = makePkce();
    const code = await obtainCode(routes, { client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: pkce.challenge });

    const response = await call(
      routes.token,
      tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_verifier: pkce.verifier }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("C52 — given an OAuth access token, when Claude lists the tools through the MCP client, then the tools are listed", async () => {
    const { tokens } = await fullFlow(routes);
    const client = await connectClient((request) => call(routes.mcp, request), tokens.access_token);

    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("publish_brief");
    } finally {
      await client.close();
    }
  });

  it("C52 — given an OAuth access token, when Claude calls publish_brief with dry_run, then the tool runs and answers OK", async () => {
    const { tokens } = await fullFlow(routes);
    const client = await connectClient((request) => call(routes.mcp, request), tokens.access_token);

    try {
      const result = await client.callTool({
        name: "publish_brief",
        arguments: { date: "2026-11-20", kind: "daily", payload: validPayload(), dry_run: true },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ dryRun: true, kind: "daily" });
    } finally {
      await client.close();
    }
  });

  it("C52 — given a refresh token, when Claude refreshes, then it gets a new working access token and the old refresh token is revoked", async () => {
    const { clientId, tokens } = await fullFlow(routes);

    const refreshed = await call(routes.token, tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }));

    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string; refresh_token: string; token_type: string };
    expect(next.token_type).toBe("Bearer");
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(await bearerStatus(next.access_token)).toBe(200);

    const replay = await call(routes.token, tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }));
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    // The rotated refresh token still works.
    const again = await call(routes.token, tokenRequest({ grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: clientId }));
    expect(again.status).toBe(200);
  });

  it("C52 — given a refresh token of another client, when it is used, then invalid_grant", async () => {
    const { tokens } = await fullFlow(routes);
    const otherClient = await registerClient(routes);

    const response = await call(routes.token, tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: otherClient }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("C52 — given the static MCP_TOKEN (option A), when Claude calls /api/mcp, then it still works next to OAuth", async () => {
    expect(await bearerStatus(MCP_TEST_TOKEN)).toBe(200);
  });

  it("C52 — given an access token issued by the flow, when I look in the database, then only SHA-256 hashes of codes and tokens are stored", async () => {
    const { tokens } = await fullFlow(routes);
    const clientId = await registerClient(routes);
    const pkce = makePkce();
    const pendingCode = await obtainCode(routes, { client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: pkce.challenge });

    const tokenRows = dumpTable(databasePath, "oauth_tokens");
    expect(tokenRows).not.toContain(tokens.access_token);
    expect(tokenRows).not.toContain(tokens.refresh_token);
    expect(dumpTable(databasePath, "oauth_codes")).not.toContain(pendingCode);
    expect(countRows(databasePath, "oauth_tokens")).toBe(2);
  });

  it("C52 — given an access token older than one hour, when Claude calls /api/mcp, then 401 with the resource metadata hint", async () => {
    const { tokens } = await fullFlow(routes);
    expect(await bearerStatus(tokens.access_token)).toBe(200);

    advance(3600 * 1000 + 1000);

    const response = await call(routes.mcp, initializeRequest({ Authorization: `Bearer ${tokens.access_token}` }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("C52 — given a refresh token used as an access token, when Claude calls /api/mcp, then 401", async () => {
    const { tokens } = await fullFlow(routes);

    expect(await bearerStatus(tokens.refresh_token)).toBe(401);
  });
});

describe("C53 — a wrong password issues no token", () => {
  const wrongPasswords = ["", "wrong password", `${OWNER_PASSWORD} `, OWNER_PASSWORD.toUpperCase()];

  it.each(wrongPasswords)("C53 — given the password %j, when I submit the login form, then 401 login page, no redirect, no code stored", async (password) => {
    const clientId = await registerClient(routes);
    const pkce = makePkce();

    const response = await call(
      routes.authorize,
      authorizePost({ client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: pkce.challenge, state: "s" }, password),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    const html = await response.text();
    expect(html).toContain("Mot de passe incorrect.");
    expect(html).toMatch(/<input[^>]*type="password"/i);
    expect(html).not.toContain(OWNER_PASSWORD);
    expect(countRows(databasePath, "oauth_codes")).toBe(0);
    expect(countRows(databasePath, "oauth_tokens")).toBe(0);
  });

  it.each([
    ["unset", undefined],
    ["blank", "   "],
    ["empty", ""],
  ])("C53 — given MCP_OAUTH_PASSWORD %s, when I submit any password, then the login is refused and no code is issued", async (_label, configured) => {
    const clientId = await registerClient(routes);
    vi.stubEnv("MCP_OAUTH_PASSWORD", configured);
    vi.resetModules();
    routes = await loadRoutes();
    const pkce = makePkce();

    for (const password of ["", " ", "undefined", "wrong"]) {
      const response = await call(
        routes.authorize,
        authorizePost({ client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: pkce.challenge }, password),
      );
      expect(response.status).toBeGreaterThanOrEqual(401);
      expect(response.headers.get("location")).toBeNull();
    }
    expect(countRows(databasePath, "oauth_codes")).toBe(0);
  });

  it("C53 — given a POST with an unknown client or a foreign redirect_uri, when the right password is typed, then 400 and no code, no redirect", async () => {
    const clientId = await registerClient(routes);
    const pkce = makePkce();

    for (const params of [
      { client_id: "unknown", redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: pkce.challenge },
      { client_id: clientId, redirect_uri: "https://evil.example.com/cb", code_challenge: pkce.challenge },
    ]) {
      const response = await call(routes.authorize, authorizePost(params, OWNER_PASSWORD));
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }
    expect(countRows(databasePath, "oauth_codes")).toBe(0);
  });

  describe("token endpoint refuses what is not a fresh, matching code", () => {
    async function issue() {
      const clientId = await registerClient(routes);
      const pkce = makePkce();
      const code = await obtainCode(routes, { client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_challenge: pkce.challenge });
      return { clientId, pkce, code };
    }

    async function expectNoToken(response: Response, error = "invalid_grant", status = 400): Promise<void> {
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toMatch(/no-store/);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe(error);
      expect(body).not.toHaveProperty("access_token");
      expect(countRows(databasePath, "oauth_tokens")).toBe(0);
    }

    it("C53 — given a wrong PKCE verifier, when the code is exchanged, then invalid_grant and no token", async () => {
      const { clientId, code } = await issue();

      const response = await call(
        routes.token,
        tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_verifier: makePkce().verifier }),
      );

      await expectNoToken(response);
    });

    it("C53 — given a missing code_verifier, when the code is exchanged, then no token", async () => {
      const { clientId, code } = await issue();

      const response = await call(
        routes.token,
        tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).not.toHaveProperty("access_token");
      expect(countRows(databasePath, "oauth_tokens")).toBe(0);
    });

    it("C53 — given a code already exchanged, when it is exchanged again, then invalid_grant and no second token", async () => {
      const { clientId, pkce, code } = await issue();
      const fields = { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_verifier: pkce.verifier };
      expect((await call(routes.token, tokenRequest(fields))).status).toBe(200);

      const replay = await call(routes.token, tokenRequest(fields));

      expect(replay.status).toBe(400);
      expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
      expect(countRows(databasePath, "oauth_tokens")).toBe(2);
    });

    it("C53 — given a code older than 10 minutes, when it is exchanged, then invalid_grant and no token", async () => {
      const { clientId, pkce, code } = await issue();
      advance(10 * 60 * 1000 + 1000);

      const response = await call(
        routes.token,
        tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_verifier: pkce.verifier }),
      );

      await expectNoToken(response);
    });

    it("C53 — given a code exchanged by another client, when it is exchanged, then invalid_grant and no token", async () => {
      const { pkce, code } = await issue();
      const otherClient = await registerClient(routes);

      const response = await call(
        routes.token,
        tokenRequest({ grant_type: "authorization_code", code, client_id: otherClient, redirect_uri: CLAUDE_REDIRECT_URI, code_verifier: pkce.verifier }),
      );

      await expectNoToken(response);
    });

    it("C53 — given another redirect_uri than the one of the authorization, when the code is exchanged, then invalid_grant and no token", async () => {
      const { clientId, pkce, code } = await issue();

      const response = await call(
        routes.token,
        tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: "https://claude.com/api/mcp/auth_callback", code_verifier: pkce.verifier }),
      );

      await expectNoToken(response);
    });

    it("C53 — given an invented code, when it is exchanged, then invalid_grant and no token", async () => {
      const { clientId, pkce } = await issue();

      const response = await call(
        routes.token,
        tokenRequest({ grant_type: "authorization_code", code: "invented-code", client_id: clientId, redirect_uri: CLAUDE_REDIRECT_URI, code_verifier: pkce.verifier }),
      );

      await expectNoToken(response);
    });

    it("C53 — given an unknown grant_type, a missing grant_type or an unknown client, when the token endpoint is called, then the RFC 6749 error and no token", async () => {
      const { clientId, pkce, code } = await issue();

      await expectNoToken(await call(routes.token, tokenRequest({ grant_type: "password", client_id: clientId })), "unsupported_grant_type");
      await expectNoToken(await call(routes.token, tokenRequest({ client_id: clientId })), "invalid_request");
      await expectNoToken(
        await call(
          routes.token,
          tokenRequest({ grant_type: "authorization_code", code, client_id: "unknown", redirect_uri: CLAUDE_REDIRECT_URI, code_verifier: pkce.verifier }),
        ),
        "invalid_client",
        401,
      );
    });
  });

  it.each([
    ["a random token", () => "A".repeat(43)],
    ["a made-up token with a valid look", () => makePkce().verifier],
  ])("C53 — given %s, when Claude calls /api/mcp, then 401", async (_label, make) => {
    expect(await bearerStatus(make())).toBe(401);
  });

  it("C53 — given a revoked access token, when Claude calls /api/mcp, then 401", async () => {
    const { tokens } = await fullFlow(routes);
    expect(await bearerStatus(tokens.access_token)).toBe(200);
    const db = new DatabaseSync(databasePath);
    try {
      db.exec("UPDATE oauth_tokens SET revoked = 1");
    } finally {
      db.close();
    }

    expect(await bearerStatus(tokens.access_token)).toBe(401);
  });
});
