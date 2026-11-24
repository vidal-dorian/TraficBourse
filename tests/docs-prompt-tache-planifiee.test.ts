// US #17 — C70: docs/prompt-tache-planifiee.md holds the prompt in force, consistent with the
// tools the app exposes.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rootPath } from "./helpers/project";

const PATH = rootPath("docs", "prompt-tache-planifiee.md");

function doc(): string {
  expect(existsSync(PATH), "docs/prompt-tache-planifiee.md must exist").toBe(true);
  return readFileSync(PATH, "utf8");
}

/** Contents of every fenced code block. */
function codeBlocks(text: string): string[] {
  return [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]);
}

const TOOL_NAME = /\b(?:get|publish|list|upsert|add)_[a-z_]+\b/g;

describe("C70 — docs/prompt-tache-planifiee.md", () => {
  it("C70 — given the repo, when I open the file, then the prompt is in a fenced code block", () => {
    const blocks = codeBlocks(doc());
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks.some((block) => /publish_brief/.test(block))).toBe(true);
  });

  it("C70 — given the prompt, when I list the tools it calls, then they are exactly the tools exposed on /api/mcp", async () => {
    const { mcpTools } = await import("../src/lib/mcp/tools/index");
    const exposed = mcpTools.map((tool) => tool.name).sort();
    const called = [...new Set(codeBlocks(doc()).join("\n").match(TOOL_NAME) ?? [])]
      .filter((name) => name !== "dry_run")
      .sort();
    expect(called).toEqual(exposed);
  });

  it("C70 — given the prompt, when I read the payload it asks for, then it does not request fields the schema rejects today", () => {
    const prompt = codeBlocks(doc()).join("\n");
    expect(prompt).not.toMatch(/concept\b|storylineUpdates/i);
    expect(prompt).toMatch(/dry_run/);
  });

  it("#97 — given the prompt, when I read the payload it asks for, then it describes the stockNotes the schema now accepts", () => {
    const prompt = codeBlocks(doc()).join("\n");
    expect(prompt).toMatch(/stockNotes/);
    expect(prompt).toMatch(/newsRefs/);
    expect(prompt).toMatch(/nextEvent/);
  });

  it("C70 — given the prompt, when I read the kinds, then the daily and the weekly (Saturday) variants are stated", () => {
    const text = doc();
    expect(text).toMatch(/daily/);
    expect(text).toMatch(/weekly/);
    expect(text).toMatch(/samedi/i);
    expect(codeBlocks(text).length).toBeGreaterThanOrEqual(2);
  });

  it("C70 — given the prompt, when I read the rules, then it forbids buy/sell/hold recommendations", () => {
    const prompt = codeBlocks(doc()).join("\n");
    expect(prompt).toMatch(/recommandation|conseil/i);
    expect(prompt).toMatch(/achat|acheter|buy/i);
  });

  it("C70 — given CLAUDE.md, when I read Appendix A, then it points to docs/prompt-tache-planifiee.md as the single source of truth", () => {
    const claude = readFileSync(rootPath("CLAUDE.md"), "utf8");
    const appendix = claude.slice(claude.indexOf("## Appendix A"), claude.indexOf("## Appendix B"));
    expect(appendix).toMatch(/docs\/prompt-tache-planifiee\.md/);
  });
});
