// US #22 — a visitor sees a chart under the news items that have one (C84), drawn from
// `prices_daily` only (C86).
//
// Contract (`src/lib/render/brief.tsx`, used by the home page and /brief/[date]):
// - under a news item with a `chart` (after « Impact possible », before the source line): a
//   `<figure>` whose `<figcaption>` names the instruments by name, says the range in French
//   (« 5 jours », « 1 mois », « 3 mois », « depuis le 1er janvier », « 1 an ») and « base 100 »
//   when normalized. The curve is a client component (nothing testable on the server); the figure
//   also holds a visually hidden (`sr-only`) `<table>`: one row per date, one column per
//   instrument in spec order, values formatted French-style (« 100,00 »). Tests read that table.
// - an item without chart has no figure. When no series has points: « Pas encore de cours pour ce
//   graphique. » and no table.
// - values come from `prices_daily` only. Window as `get_market_snapshot` computes its variations:
//   the base is the last close on or before the reference date (brief date - 1 month for 1M), then
//   the closes up to the brief date; the last normalized value - 100 is the snapshot's variation.
// - the first cell of a data row is the date as « JJ/MM/AAAA ».
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newsItem, validPayload, type JsonObject } from "./fixtures/brief-payloads";
import { renderBriefPage, renderHomePage, seedPayloads, textOf } from "./helpers/home-page";
import { makeMigratedDatabase } from "./helpers/mcp";

vi.mock("../src/app/globals.css", () => ({}));

/** 07:30 in Paris on Monday Nov 23, 2026. */
const MONDAY_MORNING = "2026-11-23T06:30:00Z";
const DATE = "2026-11-23";

let databasePath: string;

beforeEach(() => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("TZ", "UTC");
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(MONDAY_MORNING));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function seedCloses(symbol: string, closes: [string, number][]): Promise<void> {
  const { openDatabase } = await import("../src/lib/db/client");
  const sqlite = openDatabase(databasePath);
  try {
    const insert = sqlite.prepare("INSERT INTO prices_daily (symbol, date, close) VALUES (?, ?, ?)");
    for (const [date, close] of closes) insert.run(symbol, date, close);
  } finally {
    sqlite.close();
  }
}

const C84_SPEC = { type: "price", symbols: ["^FCHI", "^GSPC"], range: "1M", normalize: true };

/** A payload whose first news item has `chart`, the others none. */
function payloadWithChart(chart: JsonObject | undefined): JsonObject {
  const payload = validPayload();
  (payload.news as JsonObject[])[0] = newsItem(chart ? { chart } : {});
  return payload;
}

async function briefHtml(chart: JsonObject | undefined): Promise<string> {
  await seedPayloads(databasePath, [{ date: DATE, payload: payloadWithChart(chart) }]);
  return renderBriefPage(DATE);
}

function figures(html: string): string[] {
  return [...html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)].map((m) => m[1]);
}

function captionOf(figure: string): string {
  const match = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i.exec(figure);
  expect(match, "the figure must have a figcaption").not.toBeNull();
  return textOf(match?.[1] ?? "");
}

/** Rows of the data table: the formatted values of each row (the date cell is left out). */
function tableRows(figure: string): string[][] {
  const table = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(figure);
  expect(table, "the figure must hold a data table").not.toBeNull();
  const rows = [...(table?.[1] ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => textOf(cell[1])),
  );
  return rows.filter((cells) => cells.length >= 2 && /^[\d\s,]+$/.test(cells[cells.length - 1])).map((cells) => cells.slice(1));
}

/** The first cell (the date) of each data row. */
function rowDates(figure: string): string[] {
  const table = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(figure)?.[1] ?? "";
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => textOf(cell[1])))
    .filter((cells) => cells.length >= 2 && /^[\d\s,]+$/.test(cells[cells.length - 1]))
    .map((cells) => cells[0]);
}

function headerCells(figure: string): string[] {
  const head = /<tr\b[^>]*>([\s\S]*?)<\/tr>/i.exec(/<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(figure)?.[1] ?? "");
  return [...(head?.[1] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((cell) => textOf(cell[1]));
}

describe("C84 — the brief shows a chart under a news item that has a spec", () => {
  it("given the spec {price, [^FCHI, ^GSPC], 1M, normalize}, when I open the brief, then I see a figure captioned with both instruments, 1 mois and base 100", async () => {
    await seedCloses("^FCHI", [["2026-10-23", 8000], ["2026-11-10", 8100], ["2026-11-23", 8240]]);
    await seedCloses("^GSPC", [["2026-10-23", 5000], ["2026-11-10", 4950], ["2026-11-23", 5150]]);

    const html = await briefHtml(C84_SPEC);

    expect(figures(html)).toHaveLength(1);
    const caption = captionOf(figures(html)[0]);
    expect(caption).toContain("CAC 40");
    expect(caption).toContain("S&P 500");
    expect(caption.indexOf("CAC 40")).toBeLessThan(caption.indexOf("S&P 500"));
    expect(caption).toContain("1 mois");
    expect(caption).toContain("base 100");
  });

  it("given the same spec, when I open the brief, then both curves are in base 100: two columns starting at 100,00, in date order", async () => {
    await seedCloses("^FCHI", [["2026-10-23", 8000], ["2026-11-10", 8100], ["2026-11-23", 8240]]);
    await seedCloses("^GSPC", [["2026-10-23", 5000], ["2026-11-10", 4950], ["2026-11-23", 5150]]);

    const figure = figures(await briefHtml(C84_SPEC))[0];

    expect(headerCells(figure).join(" | ")).toMatch(/CAC 40.*S&P 500/);
    expect(tableRows(figure)).toEqual([
      ["100,00", "100,00"],
      ["101,25", "99,00"],
      ["103,00", "103,00"],
    ]);
  });

  it("given the same spec, when I open the brief, then the rows are dated JJ/MM/AAAA starting at the reference day", async () => {
    await seedCloses("^FCHI", [["2026-10-23", 8000], ["2026-11-10", 8100], ["2026-11-23", 8240]]);
    await seedCloses("^GSPC", [["2026-10-23", 5000], ["2026-11-10", 4950], ["2026-11-23", 5150]]);

    const figure = figures(await briefHtml(C84_SPEC))[0];

    expect(rowDates(figure)).toEqual(["23/10/2026", "10/11/2026", "23/11/2026"]);
  });

  it("given the same spec, when I open the home page, then the chart is there too", async () => {
    await seedCloses("^FCHI", [["2026-10-23", 8000], ["2026-11-23", 8240]]);
    await seedCloses("^GSPC", [["2026-10-23", 5000], ["2026-11-23", 5150]]);
    await seedPayloads(databasePath, [{ date: DATE, payload: payloadWithChart(C84_SPEC) }]);

    const figure = figures(await renderHomePage())[0];

    expect(tableRows(figure)).toEqual([
      ["100,00", "100,00"],
      ["103,00", "103,00"],
    ]);
  });

  it("given the figure, when I read the item, then it sits after « Impact possible » and before the source link", async () => {
    await seedCloses("^FCHI", [["2026-11-02", 8000]]);
    await seedCloses("^GSPC", [["2026-11-02", 5000]]);

    const html = await briefHtml(C84_SPEC);

    const impact = html.indexOf("Impact possible");
    const figure = html.indexOf("<figure");
    const source = html.indexOf("https://www.ecb.europa.eu/press/pr/date");
    expect(impact).toBeGreaterThan(-1);
    expect(figure).toBeGreaterThan(impact);
    expect(source).toBeGreaterThan(figure);
  });

  it("given a news item without chart, when I open the brief, then there is no figure", async () => {
    const html = await briefHtml(undefined);
    expect(figures(html)).toHaveLength(0);
  });

  it.each([
    ["5D", "5 jours"],
    ["1M", "1 mois"],
    ["3M", "3 mois"],
    ["YTD", "depuis le 1er janvier"],
    ["1Y", "1 an"],
  ])("given the range %s, when I open the brief, then the caption says « %s »", async (range, label) => {
    await seedCloses("^FCHI", [["2026-11-20", 8000]]);

    const figure = figures(await briefHtml({ type: "price", symbols: ["^FCHI"], range }))[0];

    expect(captionOf(figure)).toContain(label);
  });

  it("given a spec not normalized, when I open the brief, then the caption does not say base 100 and the table holds the raw closes", async () => {
    await seedCloses("^FCHI", [["2026-11-19", 101.5], ["2026-11-20", 102.25]]);

    const figure = figures(await briefHtml({ type: "price", symbols: ["^FCHI"], range: "5D" }))[0];

    expect(captionOf(figure)).not.toContain("base 100");
    expect(tableRows(figure)).toEqual([["101,50"], ["102,25"]]);
  });

  it("given a spec with no close in prices_daily, when I open the brief, then the figure says there is no price yet and has no table", async () => {
    const figure = figures(await briefHtml(C84_SPEC))[0];

    expect(textOf(figure)).toContain("Pas encore de cours pour ce graphique.");
    expect(figure).not.toMatch(/<table/i);
  });
});

describe("C86 — the chart uses only the data of prices_daily", () => {
  it("given a close before the base, the base on the reference date, and one after the brief date, when I open the brief, then only the base and the closes up to the brief date are shown", async () => {
    await seedCloses("^FCHI", [
      ["2026-10-22", 1],
      ["2026-10-23", 200],
      ["2026-11-23", 250],
      ["2026-11-24", 9999],
    ]);

    const figure = figures(await briefHtml({ type: "price", symbols: ["^FCHI"], range: "1M", normalize: true }))[0];

    expect(tableRows(figure)).toEqual([["100,00"], ["125,00"]]);
    expect(textOf(figure)).not.toContain("9999");
  });

  it("given values placed in the stored raw payload, when I open the brief, then they never feed the table", async () => {
    await seedCloses("^FCHI", [["2026-11-02", 200], ["2026-11-03", 210]]);
    const payload = payloadWithChart({ type: "price", symbols: ["^FCHI"], range: "1M" });
    // A row written by another path: raw payload carrying values the schema has no field for.
    (payload.news as JsonObject[])[0].chart = { type: "price", symbols: ["^FCHI"], range: "1M", values: [[777, 888]] };
    await seedPayloads(databasePath, [
      { date: DATE, payload: payloadWithChart({ type: "price", symbols: ["^FCHI"], range: "1M" }) },
    ]);
    const { openDatabase } = await import("../src/lib/db/client");
    const sqlite = openDatabase(databasePath);
    sqlite.prepare("UPDATE briefs SET raw_payload = ?").run(JSON.stringify(payload));
    sqlite.close();

    const html = await renderBriefPage(DATE);

    expect(tableRows(figures(html)[0])).toEqual([["200,00"], ["210,00"]]);
    expect(html).not.toContain("777");
    expect(html).not.toContain("888");
  });

  it("given closes of a symbol not in the spec, when I open the brief, then they are not shown", async () => {
    await seedCloses("^FCHI", [["2026-11-02", 200]]);
    await seedCloses("^NDX", [["2026-11-02", 555]]);

    const figure = figures(await briefHtml({ type: "price", symbols: ["^FCHI"], range: "1M" }))[0];

    expect(tableRows(figure)).toEqual([["200,00"]]);
  });
});
