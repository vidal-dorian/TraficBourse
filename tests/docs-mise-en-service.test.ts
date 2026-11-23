// US #17 — C69: docs/mise-en-service.md walks the owner through plugging Claude into the app.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rootPath } from "./helpers/project";

const PATH = rootPath("docs", "mise-en-service.md");

function doc(): string {
  expect(existsSync(PATH), "docs/mise-en-service.md must exist").toBe(true);
  return readFileSync(PATH, "utf8");
}

describe("C69 — docs/mise-en-service.md", () => {
  it("C69 — given the repo, when I open the guide, then it exists and is written in French", () => {
    expect(doc()).toMatch(/connecteur|tâche|jeton/i);
  });

  it("C69 — given the guide, when I look for the connector, then it gives the /api/mcp URL built on PUBLIC_URL", () => {
    const text = doc();
    expect(text).toMatch(/connecteur/i);
    expect(text).toMatch(/\/api\/mcp/);
    expect(text).toMatch(/PUBLIC_URL|domaine public/i);
  });

  it("C69 — given the guide, when I look for the token, then option A (Authorization: Bearer, MCP_TOKEN) and option B (OAuth, MCP_OAUTH_PASSWORD) are described", () => {
    const text = doc();
    expect(text).toMatch(/Authorization\s*:\s*Bearer/i);
    expect(text).toMatch(/MCP_TOKEN/);
    expect(text).toMatch(/jeton/i);
    expect(text).toMatch(/OAuth/);
    expect(text).toMatch(/MCP_OAUTH_PASSWORD/);
  });

  it("C69 — given the guide, when I look for the weekday task, then it runs Monday to Friday around 07:00 Europe/Paris with kind daily", () => {
    const text = doc();
    expect(text).toMatch(/lundi (au|à) vendredi/i);
    expect(text).toMatch(/07\s*[:h]\s*(00)?/i);
    expect(text).toMatch(/Europe\/Paris/);
    expect(text).toMatch(/daily/);
  });

  it("C69 — given the guide, when I look for the Saturday task, then it runs on Saturday around 09:00 with kind weekly", () => {
    const text = doc();
    expect(text).toMatch(/samedi/i);
    expect(text).toMatch(/09\s*[:h]\s*(00)?/i);
    expect(text).toMatch(/weekly/);
  });

  it("C69 — given the guide, when I look for Cloudflare Access, then the rule bypasses /api/mcp and the OAuth paths while /admin stays protected", () => {
    const text = doc();
    expect(text).toMatch(/Cloudflare Access/i);
    expect(text).toMatch(/bypass|exclu|contourn/i);
    expect(text).toMatch(/\/api\/mcp/);
    expect(text).toMatch(/\/oauth\//);
    expect(text).toMatch(/\/\.well-known\/oauth-/);
    expect(text).toMatch(/\/admin/);
    expect(text).toMatch(/prot[ée]g/i);
  });

  it("C69 — given the guide, when I look for a check, then a manual run is verified against mcp_audit", () => {
    const text = doc();
    expect(text).toMatch(/manuel/i);
    expect(text).toMatch(/mcp_audit/);
  });

  it("C69 — given the guide, when I scan it, then no real secret is committed (no 64-hex string)", () => {
    expect(doc()).not.toMatch(/\b[0-9a-f]{64}\b/i);
  });
});
