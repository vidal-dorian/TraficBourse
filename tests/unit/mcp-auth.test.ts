// US #11 — bearer token helpers of /api/mcp (header parsing, constant-time comparison, config).
import { describe, expect, it } from "vitest";
import { checkMcpAuth, parseBearerToken, tokensMatch } from "../../src/lib/mcp/auth";

const TOKEN = "3f9a1c7e5b2d8f40a6c1e9b7d3f5a2c8";

function withAuthorization(value?: string): Request {
  return new Request("http://localhost/api/mcp", { headers: value === undefined ? {} : { Authorization: value } });
}

describe("parseBearerToken", () => {
  it("returns the token of a Bearer header, whatever the scheme case", () => {
    expect(parseBearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(parseBearerToken(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(parseBearerToken(`Bearer   ${TOKEN} `)).toBe(TOKEN);
  });

  it("returns undefined for a missing header, another scheme, an empty token or extra parts", () => {
    for (const header of [null, undefined, "", TOKEN, `Basic ${TOKEN}`, "Bearer", "Bearer ", `Bearer ${TOKEN} extra`, `Bearer${TOKEN}`]) {
      expect(parseBearerToken(header)).toBeUndefined();
    }
  });
});

describe("tokensMatch", () => {
  it("accepts the same token and refuses any other one, whatever its length", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch(`${TOKEN.slice(0, -1)}0`, TOKEN)).toBe(false);
    expect(tokensMatch(`${TOKEN}0`, TOKEN)).toBe(false);
    expect(tokensMatch(TOKEN.slice(0, 8), TOKEN)).toBe(false);
    expect(tokensMatch("", TOKEN)).toBe(false);
  });
});

describe("checkMcpAuth", () => {
  it("accepts the configured token, trimming the configured value", () => {
    expect(checkMcpAuth(withAuthorization(`Bearer ${TOKEN}`), { MCP_TOKEN: ` ${TOKEN}\n` })).toEqual({ ok: true });
  });

  it("reports a missing or malformed header", () => {
    expect(checkMcpAuth(withAuthorization(), { MCP_TOKEN: TOKEN })).toEqual({ ok: false, reason: "missing_token" });
    expect(checkMcpAuth(withAuthorization(`Basic ${TOKEN}`), { MCP_TOKEN: TOKEN })).toEqual({ ok: false, reason: "missing_token" });
  });

  it("reports a wrong token", () => {
    expect(checkMcpAuth(withAuthorization("Bearer wrong"), { MCP_TOKEN: TOKEN })).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("refuses everything when MCP_TOKEN is unset or blank (fail closed)", () => {
    for (const env of [{}, { MCP_TOKEN: "" }, { MCP_TOKEN: "  " }]) {
      expect(checkMcpAuth(withAuthorization(`Bearer ${TOKEN}`), env)).toEqual({ ok: false, reason: "not_configured" });
    }
  });
});
