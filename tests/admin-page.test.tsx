// US #10 — C46: the provisional administration page, plus the configuration notes.
//
// Contract:
// - `src/app/admin/page.tsx` default-exports the admin page (a server component, sync or
//   async) that renders without the Next.js runtime, in French: an « Administration »
//   heading and a provisional notice (e.g. « bientôt : watchlist, instruments… »).
// - It exports `metadata` with `robots` set to noindex (`{ index: false, … }` or "noindex…").
// - `.env.example` documents CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, ADMIN_EMAILS and
//   ADMIN_AUTH_DISABLED, with placeholder values only (any e-mail is @example.com/.org/.net).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rootPath } from "./helpers/project";

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function renderAdminPage(): Promise<string> {
  const { default: AdminPage } = await import("../src/app/admin/page");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const element = await (AdminPage as (props: unknown) => unknown)({
    params: Promise.resolve({}),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
}

describe("C46 — provisional administration page", () => {
  it("C46 — given a valid Access token for my e-mail, when I open /admin, then I see a provisional administration page in French", async () => {
    const html = await renderAdminPage();
    const text = textOf(html);

    expect(html).toMatch(/<h1[^>]*>[^<]*Administration/i);
    expect(text).toMatch(/\b(bientôt|provisoire|en construction|à venir)\b/i);
    expect(text).toMatch(/\b(le|la|les|des|du|et|pour|sur|bientôt)\b/i);
    expect(text).not.toMatch(/accès refusé/i);
  });

  it("C46 — given the administration page, when its metadata is read, then search engines are told not to index it", async () => {
    const mod = (await import("../src/app/admin/page")) as { metadata?: { robots?: unknown } };

    const robots = mod.metadata?.robots;
    expect(robots, "metadata.robots must be set").toBeDefined();
    if (typeof robots === "string") expect(robots).toMatch(/noindex/i);
    else expect(robots).toMatchObject({ index: false });
  });
});

describe("US #10 notes — Access configuration is documented without personal data", () => {
  it("given the repo, when .env.example is read, then it documents the Access variables with placeholder values only", () => {
    const envExample = readFileSync(rootPath(".env.example"), "utf8");

    for (const name of ["CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "ADMIN_EMAILS", "ADMIN_AUTH_DISABLED"]) {
      expect(envExample, `${name} must be documented`).toMatch(new RegExp(`^\\s*#?\\s*${name}=`, "m"));
    }
    const emails = envExample.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    for (const email of emails) expect(email).toMatch(/@example\.(com|org|net)$/i);
    // The dev flag must not be enabled by default in the example.
    expect(envExample).not.toMatch(/^\s*ADMIN_AUTH_DISABLED=\s*true\b/m);
  });
});
