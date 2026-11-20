// US #11 — the MCP endpoint only answers a caller holding the token (C47, C48).
//
// Contract:
// - `src/app/api/mcp/route.ts` exports the App Router handlers `GET`, `POST` and `DELETE`
//   (the three methods of the Streamable HTTP transport), each `(request: Request) => Promise<Response>`.
// - Every request must carry `Authorization: Bearer <token>`, compared in constant time with
//   `process.env.MCP_TOKEN` (CLAUDE.md §8, option A). The check runs before any MCP handling.
// - Refused request: HTTP 401, `Cache-Control: no-store`, a short body that never echoes the
//   token sent nor the configured one. No tool runs.
// - Fail closed: `MCP_TOKEN` unset or empty → every request gets 401 and the problem is logged
//   server side (`console.warn` or `console.error`).
// - Accepted request: handled by the MCP transport (an `initialize` request answers 200).
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch, initializeRequest, MCP_TEST_TOKEN, MCP_URL, toolCallRequest, type RouteModule } from "./helpers/mcp";
import { makeTempDir } from "./helpers/sqlite";

async function loadRoute(): Promise<RouteModule> {
  return (await import("../src/app/api/mcp/route")) as unknown as RouteModule;
}

type CreateMcpHandler = (options: { tools: unknown[] }) => (request: Request) => Promise<Response>;

async function loadCreateMcpHandler(): Promise<CreateMcpHandler> {
  const mod = (await import("../src/lib/mcp/server")) as unknown as { createMcpHandler: CreateMcpHandler };
  return mod.createMcpHandler;
}

function bareRequest(method: string, headers: Record<string, string> = {}): Request {
  if (method === "POST") return initializeRequest(headers);
  return new Request(MCP_URL, { method, headers: { Accept: "application/json, text/event-stream", ...headers } });
}

async function expectRefused(response: Response, ...secrets: string[]): Promise<void> {
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toMatch(/no-store/);
  const body = await response.text();
  expect(body.length).toBeLessThan(200);
  for (const secret of secrets) expect(body).not.toContain(secret);
}

beforeEach(() => {
  vi.stubEnv("DATABASE_PATH", join(makeTempDir(), "bourse.db"));
  vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("C47 — /api/mcp without an Authorization header answers 401", () => {
  it.each(["POST", "GET", "DELETE"])(
    "C47 — given a %s request on /api/mcp without an Authorization header, when it arrives, then the app answers 401",
    async (method) => {
      const route = await loadRoute();

      const response = await dispatch(route, bareRequest(method));

      await expectRefused(response, MCP_TEST_TOKEN);
    },
  );

  it("C47 — given a request whose Authorization header is not a Bearer token, when it arrives, then the app answers 401", async () => {
    const route = await loadRoute();

    for (const authorization of [MCP_TEST_TOKEN, `Basic ${MCP_TEST_TOKEN}`, "Bearer", "Bearer "]) {
      const response = await dispatch(route, initializeRequest({ Authorization: authorization }));
      await expectRefused(response, MCP_TEST_TOKEN);
    }
  });

  it("C47 — given a tools/call request without an Authorization header, when it arrives, then the app answers 401 and no tool runs", async () => {
    const createMcpHandler = await loadCreateMcpHandler();
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] }));
    const handle = createMcpHandler({
      tools: [{ name: "auth_probe", description: "Test-only tool.", inputSchema: {}, handler }],
    });

    const response = await handle(toolCallRequest("auth_probe", {}));

    await expectRefused(response, MCP_TEST_TOKEN);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("C48 — /api/mcp with a wrong token answers 401", () => {
  // One character changed: same length as MCP_TOKEN.
  const sameLengthWrongToken = `${MCP_TEST_TOKEN.slice(0, -1)}${MCP_TEST_TOKEN.endsWith("0") ? "1" : "0"}`;

  it("C48 — given a wrong token of the same length as MCP_TOKEN, when the request arrives, then the app answers 401", async () => {
    expect(sameLengthWrongToken).toHaveLength(MCP_TEST_TOKEN.length);
    expect(sameLengthWrongToken).not.toBe(MCP_TEST_TOKEN);
    const route = await loadRoute();

    const response = await dispatch(route, initializeRequest({ Authorization: `Bearer ${sameLengthWrongToken}` }));

    await expectRefused(response, MCP_TEST_TOKEN, sameLengthWrongToken);
  });

  it.each([
    ["longer (MCP_TOKEN plus one character)", `${MCP_TEST_TOKEN}0`],
    ["shorter (a prefix of MCP_TOKEN)", MCP_TEST_TOKEN.slice(0, 16)],
    ["unrelated", "not-the-token"],
  ])(
    "C48 — given a wrong token of a different length, %s, when the request arrives, then the app answers 401",
    async (_label, wrongToken) => {
      const route = await loadRoute();

      const response = await dispatch(route, initializeRequest({ Authorization: `Bearer ${wrongToken}` }));

      await expectRefused(response, MCP_TEST_TOKEN, wrongToken);
    },
  );

  it("C48 — given a wrong token on a tools/call request, when it arrives, then the app answers 401 and no tool runs", async () => {
    const createMcpHandler = await loadCreateMcpHandler();
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] }));
    const handle = createMcpHandler({
      tools: [{ name: "auth_probe", description: "Test-only tool.", inputSchema: {}, handler }],
    });

    const response = await handle(toolCallRequest("auth_probe", {}, { Authorization: `Bearer ${sameLengthWrongToken}` }));

    await expectRefused(response, MCP_TEST_TOKEN, sameLengthWrongToken);
    expect(handler).not.toHaveBeenCalled();
  });

  it("C48 — given the right token, when an initialize request arrives, then it is not refused (control)", async () => {
    const route = await loadRoute();

    const response = await dispatch(route, initializeRequest({ Authorization: `Bearer ${MCP_TEST_TOKEN}` }));

    expect(response.status).toBe(200);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["blank", "   "],
  ])(
    "C48 — given MCP_TOKEN %s, when any request arrives, then the app answers 401 (fail closed) and logs the problem",
    async (_label, configured) => {
      vi.stubEnv("MCP_TOKEN", configured);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const route = await loadRoute();

      for (const authorization of ["Bearer ", `Bearer ${configured ?? ""}`, "Bearer undefined", `Bearer ${MCP_TEST_TOKEN}`]) {
        const response = await dispatch(route, initializeRequest({ Authorization: authorization }));
        await expectRefused(response);
      }
      expect(warn.mock.calls.length + error.mock.calls.length).toBeGreaterThan(0);
    },
  );
});
