// US #7 — C33: a provisional home page is displayed in French.
//
// Contract:
// - `src/app/page.tsx` default-exports the home page (a server component, sync or async)
//   that renders without the Next.js runtime.
// - `src/app/layout.tsx` declares `<html lang="fr">`.
// - `npm run dev` starts `next dev` (Next.js 15).
// - Since US #15 the page reads the briefs from the database at `DATABASE_PATH`: it is given an
//   empty migrated database, the state of a fresh clone after `npm run db:migrate`.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMigratedDatabase } from "./helpers/mcp";
import { declaredVersion, firstExisting, readPackageJson, rootPath } from "./helpers/project";

const FRENCH_WORDS =
  /\b(le|la|les|des|du|une|un|et|est|pour|sur|bientôt|bienvenue|aujourd'hui|bourse|marchés|veille|quotidienne)\b/i;

const CREATE_NEXT_APP_BOILERPLATE = /get started by editing|deploy now|read our docs|learn more about next/i;

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function renderHomePage(): Promise<string> {
  const { default: HomePage } = await import("../src/app/page");
  const { renderToStaticMarkup } = await import("react-dom/server");
  // Server components may be async: resolve the element first, then render it.
  const element = await (HomePage as (props: unknown) => unknown)({
    params: Promise.resolve({}),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
}

describe("C33 — provisional home page in French", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_PATH", makeMigratedDatabase());
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("C33 — given a clone of the repo, when the home page is rendered, then it shows French text and no create-next-app boilerplate", async () => {
    const text = textOf(await renderHomePage());

    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(FRENCH_WORDS);
    expect(text).not.toMatch(CREATE_NEXT_APP_BOILERPLATE);
  });

  it("C33 — given a clone of the repo, when the root layout is read, then the document language is French (<html lang=\"fr\">)", () => {
    const layout = firstExisting(["src/app/layout.tsx", "src/app/layout.jsx"]);
    expect(layout, "src/app/layout.tsx must exist").toBeDefined();

    const source = readFileSync(rootPath(layout!), "utf8");
    expect(source).toMatch(/<html[^>]*\blang=["']fr["']/);
  });

  it("C33 — given a clone of the repo, when I run `npm run dev`, then it starts the Next.js 15 dev server", () => {
    const pkg = readPackageJson();

    expect(pkg.scripts?.dev).toMatch(/\bnext dev\b/);
    expect(declaredVersion(pkg, "next")).toMatch(/^[\^~]?15\./);
    expect(declaredVersion(pkg, "react")).toBeDefined();
    expect(declaredVersion(pkg, "react-dom")).toBeDefined();
  });
});
