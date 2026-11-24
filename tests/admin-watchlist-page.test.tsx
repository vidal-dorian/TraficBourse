// US #24 — C89 (page side) and the screen of C90 / C91.
//
// Contract:
// - `src/app/admin/watchlist/page.tsx` default-exports an async server component taking
//   `{ searchParams: Promise<{ q?: string | string[] }> }`, renderable without the Next.js runtime, and
//   exports `metadata` with robots noindex and `dynamic = "force-dynamic"`.
// - It reads the database with `getDb()` (`DATABASE_PATH`) and searches with `createYahooSearch()` of
//   `src/lib/market/yahoo-search.ts` (this test replaces that module with a fake: no network).
// - Without `q`: an `<h1>` « Watchlist », the followed stocks (name, symbol, listing place), each with a
//   « Retirer » submit button, a search form (`<form method="get">` with an input named `q`), and no search done.
// - With `q`: the search is called with the trimmed query; every result shows name, symbol and listing place
//   (place de cotation), with an « Ajouter » submit button, or « Déjà suivie » (no button) when the
//   symbol is already followed. No result → « Aucun résultat ». A failing search → a French error message,
//   the page still renders.
// - Add / remove are `<form action={serverAction}>` forms: the server actions call `addStockAsOwner` /
//   `removeStockAsOwner` (src/lib/watchlist/owner-actions.ts) with the request headers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMigratedDatabase } from "./helpers/mcp";
import { AIR_LIQUIDE, AIR_LIQUIDE_OTC, fakeSearch } from "./helpers/watchlist";

vi.mock("../src/app/globals.css", () => ({}));

let search = fakeSearch({});
let failing = false;

vi.mock("../src/lib/market/yahoo-search", () => ({
  createYahooSearch: () => ({
    searchInstruments: (q: string) => (failing ? Promise.reject(new Error("yahoo down")) : search.searchInstruments(q)),
  }),
}));

let databasePath: string;

beforeEach(async () => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.resetModules();
  failing = false;
  search = fakeSearch({ "Air Liquide": [AIR_LIQUIDE, AIR_LIQUIDE_OTC] });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
}

async function followStock(symbol: string, name: string, exchange: string) {
  const { openDatabase } = await import("../src/lib/db/client");
  const sqlite = openDatabase(databasePath);
  try {
    sqlite
      .prepare("INSERT INTO instruments (symbol, provider_symbol, name, type, exchange, currency, in_watchlist) VALUES (?, ?, ?, 'stock', ?, 'EUR', 1)")
      .run(symbol, symbol, name, exchange);
  } finally {
    sqlite.close();
  }
}

async function renderPage(searchParams: Record<string, string | string[]> = {}): Promise<string> {
  const { default: Page } = await import("../src/app/admin/watchlist/page");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const element = await (Page as (p: unknown) => unknown)({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
}

describe("C89 — the admin watchlist page searches and shows name, symbol and listing place", () => {
  it("C89 — given the admin watchlist page, when I search « Air Liquide », then I see each result with its name, symbol and listing place", async () => {
    const html = await renderPage({ q: "Air Liquide" });
    const text = textOf(html);

    expect(search.queries).toEqual(["Air Liquide"]);
    expect(text).toContain("Air Liquide SA");
    expect(text).toContain("AI.PA");
    expect(text).toContain("Paris");
    expect(text).toContain("Air Liquide SA ADR");
    expect(text).toContain("AIQUY");
    expect(text).toContain("OTC Markets OTCPK");
    expect(html.match(/<button[^>]*>\s*Ajouter\s*<\/button>/g) ?? []).toHaveLength(2);
  });

  it("C89 — given the page, when I open it without a search, then it offers a search form and does not search", async () => {
    const html = await renderPage();

    expect(html).toMatch(/<h1[^>]*>[^<]*Watchlist/i);
    expect(html).toMatch(/<form[^>]*method="get"/i);
    expect(html).toMatch(/<input[^>]*name="q"/);
    expect(search.queries).toEqual([]);
  });

  it("C89 — given a query with no match, when I search, then I read « Aucun résultat »", async () => {
    expect(textOf(await renderPage({ q: "zzzz" }))).toMatch(/Aucun résultat/);
  });

  it("C89 — given the search service is down, when I search, then the page tells me in French and still renders", async () => {
    failing = true;
    const html = await renderPage({ q: "Air Liquide" });

    expect(html).toMatch(/<h1[^>]*>[^<]*Watchlist/i);
    expect(textOf(html)).toMatch(/recherche.*(impossible|indisponible|échoué)|(impossible|indisponible).*recherche/i);
  });

  it("C89 — given a result already followed, when I search, then it is shown as followed without an add button", async () => {
    await followStock("AI.PA", "Air Liquide SA", "Paris");
    const html = await renderPage({ q: "Air Liquide" });

    expect(textOf(html)).toMatch(/Déjà suivie/);
    expect(html.match(/<button[^>]*>\s*Ajouter\s*<\/button>/g) ?? []).toHaveLength(1);
  });
});

describe("C90 / C91 — the page lists the followed stocks with a remove button", () => {
  it("C91 — given followed stocks, when I open the page, then each shows name, symbol, listing place and a « Retirer » button, and default instruments are not listed", async () => {
    await followStock("AI.PA", "Air Liquide SA", "Paris");
    await followStock("AIR.PA", "Airbus SE", "Paris");
    const html = await renderPage();
    const text = textOf(html);

    expect(text).toContain("Air Liquide SA");
    expect(text).toContain("AIR.PA");
    expect(text.indexOf("Air Liquide SA")).toBeLessThan(text.indexOf("Airbus SE"));
    expect(html.match(/<button[^>]*>\s*Retirer\s*<\/button>/g) ?? []).toHaveLength(2);
    expect(text).not.toContain("CAC 40");
  });

  it("C90 — given no followed stock, when I open the page, then it says so", async () => {
    expect(textOf(await renderPage())).toMatch(/Aucune action suivie/);
  });

  it("C89 — given the page, when its metadata is read, then search engines are told not to index it", async () => {
    const mod = (await import("../src/app/admin/watchlist/page")) as { metadata?: { robots?: unknown } };
    expect(mod.metadata?.robots).toMatchObject({ index: false });
  });
});
