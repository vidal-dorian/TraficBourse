// Test helpers for the OAuth flow of the MCP connector (US #12, CLAUDE.md §8 option B).
//
// No HTTP server is started: the route handlers are called directly with a `Request`.
// Contract (route files, each exporting App Router handlers):
// - src/app/.well-known/oauth-protected-resource/route.ts                  GET
// - src/app/.well-known/oauth-protected-resource/api/mcp/route.ts          GET
// - src/app/.well-known/oauth-authorization-server/route.ts                GET
// - src/app/oauth/register/route.ts                                        POST
// - src/app/oauth/authorize/route.ts                                       GET, POST
// - src/app/oauth/token/route.ts                                           POST
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import type { RouteModule } from "./mcp";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export const PUBLIC_URL = "https://bourse.example.com";
export const RESOURCE_URL = `${PUBLIC_URL}/api/mcp`;
export const RESOURCE_METADATA_URL = `${PUBLIC_URL}/.well-known/oauth-protected-resource/api/mcp`;
export const OWNER_PASSWORD = "correct horse battery staple";
export const CLAUDE_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

export type Routes = {
  protectedResource: RouteModule;
  protectedResourceMcp: RouteModule;
  authorizationServer: RouteModule;
  register: RouteModule;
  authorize: RouteModule;
  token: RouteModule;
  mcp: RouteModule;
};

/** Imports every route module (call after `vi.resetModules()` and the env stubs). */
export async function loadRoutes(): Promise<Routes> {
  return {
    protectedResource: (await import("../../src/app/.well-known/oauth-protected-resource/route")) as unknown as RouteModule,
    protectedResourceMcp: (await import("../../src/app/.well-known/oauth-protected-resource/api/mcp/route")) as unknown as RouteModule,
    authorizationServer: (await import("../../src/app/.well-known/oauth-authorization-server/route")) as unknown as RouteModule,
    register: (await import("../../src/app/oauth/register/route")) as unknown as RouteModule,
    authorize: (await import("../../src/app/oauth/authorize/route")) as unknown as RouteModule,
    token: (await import("../../src/app/oauth/token/route")) as unknown as RouteModule,
    mcp: (await import("../../src/app/api/mcp/route")) as unknown as RouteModule,
  };
}

export type Pkce = { verifier: string; challenge: string };

export function makePkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export type AuthorizeParams = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
  resource?: string;
  response_type?: string;
  code_challenge_method?: string;
};

export function authorizeQuery(params: AuthorizeParams): URLSearchParams {
  const query = new URLSearchParams({
    response_type: "code",
    code_challenge_method: "S256",
    ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)),
  } as Record<string, string>);
  return query;
}

export function registerRequest(body: unknown): Request {
  return new Request(`${PUBLIC_URL}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function authorizeGet(params: AuthorizeParams): Request {
  return new Request(`${PUBLIC_URL}/oauth/authorize?${authorizeQuery(params)}`);
}

export function authorizePost(params: AuthorizeParams, password: string): Request {
  const body = authorizeQuery(params);
  body.set("password", password);
  return new Request(`${PUBLIC_URL}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

export function tokenRequest(fields: Record<string, string>): Request {
  return new Request(`${PUBLIC_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

/** The routes' handler for the request method (405 stub when missing, so the test fails on the assertion). */
export async function call(route: RouteModule, request: Request): Promise<Response> {
  const handler = route[request.method.toUpperCase()];
  if (!handler) return new Response(null, { status: 405 });
  return handler(request);
}

/** Registers a public client and returns its `client_id`. */
export async function registerClient(routes: Routes, redirectUri = CLAUDE_REDIRECT_URI): Promise<string> {
  const response = await call(
    routes.register,
    registerRequest({
      client_name: "Claude",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  );
  if (response.status !== 201) throw new Error(`registration answered ${response.status}`);
  return ((await response.json()) as { client_id: string }).client_id;
}

/** Submits the login form with the right password and returns the authorization code. */
export async function obtainCode(routes: Routes, params: AuthorizeParams, password = OWNER_PASSWORD): Promise<string> {
  const response = await call(routes.authorize, authorizePost(params, password));
  if (response.status !== 302) throw new Error(`authorize answered ${response.status}`);
  const code = new URL(response.headers.get("location") ?? "").searchParams.get("code");
  if (!code) throw new Error("no code in the redirect");
  return code;
}

export type TokenResponse = { access_token: string; token_type: string; expires_in: number; refresh_token: string };

/** Runs register, authorize and token exchange; returns what a connector would hold. */
export async function fullFlow(routes: Routes): Promise<{ clientId: string; tokens: TokenResponse; pkce: Pkce }> {
  const clientId = await registerClient(routes);
  const pkce = makePkce();
  const code = await obtainCode(routes, {
    client_id: clientId,
    redirect_uri: CLAUDE_REDIRECT_URI,
    code_challenge: pkce.challenge,
    state: "xyz",
  });
  const response = await call(
    routes.token,
    tokenRequest({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: CLAUDE_REDIRECT_URI,
      code_verifier: pkce.verifier,
    }),
  );
  if (response.status !== 200) throw new Error(`token answered ${response.status}`);
  return { clientId, tokens: (await response.json()) as TokenResponse, pkce };
}

/** Number of rows in a table of the database file, read on its own connection. */
export function countRows(databasePath: string, table: "oauth_clients" | "oauth_codes" | "oauth_tokens"): number {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  } finally {
    db.close();
  }
}

/** Every text value stored in a table, to check that raw secrets are never persisted. */
export function dumpTable(databasePath: string, table: "oauth_codes" | "oauth_tokens"): string {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
  } finally {
    db.close();
  }
}
