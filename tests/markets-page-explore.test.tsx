// US #23 — the /marches page lets a visitor explore the instruments outside the brief.
//
// Contract (`src/app/marches/page.tsx`, props Next 15: `searchParams` is a Promise):
// - criterion 87: one `<li>` per instrument, sorted by name, with its close (as before) and four
//   labelled variations « 1 j », « 1 sem », « 1 mois », « depuis janvier » (label then value, e.g.
//   « 1 j +1,25 % »; signed French percentages like the market tiles, U+2212 minus, « n/d » when
//   null). Computed like `get_market_snapshot` (`computeVariations`) with closes up to Paris today.
// - criterion 88: each row links to `/marches?instrument=<encodeURIComponent(symbol)>`. With a known
//   `instrument`, the page shows a section whose heading holds the instrument name, range links
//   « 1M », « 3M », « Depuis janvier », « 1 an » (`plage` = 1M | 3M | YTD | 1Y, default 1M, the
//   current one `aria-current="page"`, instrument kept in the href), and a `<figure>` with the chart
//   and a visually hidden table (rows `JJ/MM/AAAA`, one column per instrument) from `loadChartData`
//   (normalize false, end date Paris today). The selected row has `aria-current="true"`.
//   Unknown instrument: no chart. Invalid `plage`: falls back to 1M. Never a crash.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anchors, parseAttributes, textOf } from "./helpers/home-page";
import { makeMigratedDatabase } from "./helpers/mcp";
import { seedCloses } from "./helpers/market-tiles";

vi.mock("../src/app/globals.css", () => ({}));

/** 08:30 in Paris on Monday Nov 23, 2026. */
const MONDAY_MORNING = "2026-11-23T07:30:00Z";

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

const CLOSES: [string, string, number][] = [
  ["^FCHI", "2025-11-20", 6000],
  ["^FCHI", "2025-12-31", 7000],
  ["^FCHI", "2026-08-20", 7100],
  ["^FCHI", "2026-10-20", 7500],
  ["^FCHI", "2026-11-13", 7800],
  ["^FCHI", "2026-11-19", 8000],
  ["^FCHI", "2026-11-20", 8100],
  ["^FCHI", "2026-11-24", 9999], // after Paris today: ignored by the variations and the chart
  ["^GSPC", "2026-11-19", 5000],
  ["^GSPC", "2026-11-20", 4960],
];

async function renderMarkets(searchParams: Record<string, string> = {}): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: Page } = await import("../src/app/marches/page");
  const element = await (Page as (p: unknown) => unknown)({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(element as never);
}

async function seeded(searchParams: Record<string, string> = {}): Promise<string> {
  await seedCloses(databasePath, CLOSES);
  return renderMarkets(searchParams);
}

type Row = { html: string; text: string; attributes: Record<string, string> };

function rows(html: string): Row[] {
  return [...html.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)].map((m) => ({
    html: m[2],
    text: textOf(m[2]),
    attributes: parseAttributes(m[1]),
  }));
}

function rowOf(html: string, name: string): Row {
  const found = rows(html).find((r) => r.text.includes(name) && r.text.includes("1 j"));
  expect(found, `a row must show ${name} with its variations`).toBeDefined();
  return found as Row;
}

/** The value written after a variation label in a row's text. */
function valueAfter(row: Row, label: string): string {
  const match = new RegExp(`${label}\\s*:?\\s*([+−]?\\d[\\d\\s]*,\\d{2} %|n/d)`).exec(row.text);
  expect(match, `« ${label} » must be followed by a variation in «${row.text}»`).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

function hrefParams(href: string): URLSearchParams {
  return new URL(href, "http://localhost").searchParams;
}

function chartSection(html: string): string {
  const match = /<figure\b[^>]*>([\s\S]*?)<\/figure>/i.exec(html);
  expect(match, "a <figure> with the chart must be shown").not.toBeNull();
  return match?.[1] ?? "";
}

function tableDates(html: string): string[] {
  const table = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(chartSection(html))?.[1] ?? "";
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => textOf(c[1])))
    .filter((cells) => /^\d{2}\/\d{2}\/\d{4}$/.test(cells[0] ?? ""))
    .map((cells) => cells[0]);
}

describe("criterion 87 — each instrument with its close and its variations", () => {
  it("given instruments in the database, when I open /marches, then every instrument has its four labelled variations", async () => {
    const html = await seeded();
    for (const name of ["CAC 40", "Euro Stoxx 50", "S&P 500", "Nasdaq 100", "Or", "Bitcoin"]) {
      const row = rowOf(html, name);
      for (const label of ["1 j", "1 sem", "1 mois", "depuis janvier"]) expect(row.text).toContain(label);
    }
  });

  it("given a close history, when I open /marches, then the CAC 40 shows +1,25 % / +3,85 % / +8,00 % / +15,71 % like get_market_snapshot", async () => {
    const row = rowOf(await seeded(), "CAC 40");
    expect(valueAfter(row, "1 j")).toBe("+1,25 %");
    expect(valueAfter(row, "1 sem")).toBe("+3,85 %");
    expect(valueAfter(row, "1 mois")).toBe("+8,00 %");
    expect(valueAfter(row, "depuis janvier")).toBe("+15,71 %");
  });

  it("given a fall, when I open /marches, then it reads « −0,80 % » with the real minus sign, and missing references read « n/d »", async () => {
    const row = rowOf(await seeded(), "S&P 500");
    expect(valueAfter(row, "1 j")).toBe("−0,80 %");
    expect(valueAfter(row, "1 sem")).toBe("n/d");
    expect(valueAfter(row, "1 mois")).toBe("n/d");
    expect(valueAfter(row, "depuis janvier")).toBe("n/d");
  });

  it("given a close, when I open /marches, then the row still shows the close formatted as before", async () => {
    const { formatClose } = await import("../src/lib/market/format");
    const row = rowOf(await seeded(), "CAC 40");
    expect(row.text).toContain(textOf(formatClose(8100, "index", "EUR")));
    expect(row.text).not.toMatch(/9\s?999/);
  });

  it("given an instrument without any close, when I open /marches, then « Pas encore de cours » is shown for it", async () => {
    const row = rowOf(await seeded(), "Bitcoin");
    expect(row.text).toContain("Pas encore de cours");
  });

  it("given instruments, when I open /marches, then the rows are sorted by name", async () => {
    const html = await seeded();
    const names = rows(html).filter((r) => r.text.includes("1 j")).map((r) => r.text);
    expect(names.length).toBe(9);
    const first = (t: string) => t.split(/\s/)[0];
    const sorted = [...names].sort((a, b) => a.localeCompare(b, "fr"));
    expect(names.map(first)).toEqual(sorted.map(first));
  });
});

describe("criterion 88 — selecting an instrument shows its chart with the ranges", () => {
  it("given an instrument, when I look at its row, then it links to /marches?instrument=<symbol> with the symbol encoded", async () => {
    const html = await seeded();
    const link = anchors(rowOf(html, "CAC 40").html)[0];
    expect(link, "the row must hold a link").toBeDefined();
    expect(link.attributes.href.startsWith("/marches?")).toBe(true);
    expect(link.attributes.href).not.toContain("^");
    expect(hrefParams(link.attributes.href).get("instrument")).toBe("^FCHI");
    const eur = anchors(rowOf(html, "EUR/USD").html)[0];
    expect(hrefParams(eur.attributes.href).get("instrument")).toBe("EURUSD=X");
  });

  it("given no selection, when I open /marches, then there is no chart and no selected row", async () => {
    const html = await seeded();
    expect(html).not.toContain("<figure");
    expect(html).not.toContain('aria-current="true"');
  });

  it("given a selected instrument, when I open its page, then a heading names it, its row is marked selected and a chart figure shows", async () => {
    const html = await seeded({ instrument: "^FCHI" });
    expect(html).toMatch(/<h2\b[^>]*>[^<]*CAC 40[^<]*<\/h2>/);
    const selected = rows(html).filter((r) => r.attributes["aria-current"] === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].text).toContain("CAC 40");
    expect(chartSection(html)).toContain("<table");
  });

  it("given a selected instrument, when I open its page, then the range links are 1M, 3M, Depuis janvier, 1 an and keep the instrument", async () => {
    const html = await seeded({ instrument: "^FCHI" });
    const expected: [string, string][] = [["1M", "1M"], ["3M", "3M"], ["Depuis janvier", "YTD"], ["1 an", "1Y"]];
    for (const [label, plage] of expected) {
      const link = anchors(html).find((a) => a.text === label);
      expect(link, `a link « ${label} » must be shown`).toBeDefined();
      const params = hrefParams(link?.attributes.href ?? "");
      expect(params.get("instrument")).toBe("^FCHI");
      expect(params.get("plage")).toBe(plage);
    }
  });

  it("given no plage, when I open the page of an instrument, then 1M is the current range and its table starts at the 1 month base", async () => {
    const html = await seeded({ instrument: "^FCHI" });
    const current = anchors(html).filter((a) => a.attributes["aria-current"] === "page");
    expect(current.map((a) => a.text)).toEqual(["1M"]);
    expect(tableDates(html)).toEqual(["20/10/2026", "13/11/2026", "19/11/2026", "20/11/2026"]);
    expect(chartSection(html)).toMatch(/7\s500,00/);
    expect(chartSection(html)).not.toMatch(/9\s?999/);
  });

  it("given plage=3M, when I open the page, then 3M is current and the chart starts at the 3 month base", async () => {
    const html = await seeded({ instrument: "^FCHI", plage: "3M" });
    expect(anchors(html).filter((a) => a.attributes["aria-current"] === "page").map((a) => a.text)).toEqual(["3M"]);
    expect(tableDates(html)[0]).toBe("20/08/2026");
    expect(tableDates(html).at(-1)).toBe("20/11/2026");
  });

  it("given plage=YTD, when I open the page, then « Depuis janvier » is current and the chart starts on 31/12/2025", async () => {
    const html = await seeded({ instrument: "^FCHI", plage: "YTD" });
    expect(anchors(html).filter((a) => a.attributes["aria-current"] === "page").map((a) => a.text)).toEqual(["Depuis janvier"]);
    expect(tableDates(html)[0]).toBe("31/12/2025");
  });

  it("given plage=1Y, when I open the page, then « 1 an » is current and the chart starts on 20/11/2025", async () => {
    const html = await seeded({ instrument: "^FCHI", plage: "1Y" });
    expect(anchors(html).filter((a) => a.attributes["aria-current"] === "page").map((a) => a.text)).toEqual(["1 an"]);
    expect(tableDates(html)[0]).toBe("20/11/2025");
  });

  it("given an invalid plage, when I open the page, then it falls back to 1M without failing", async () => {
    const html = await seeded({ instrument: "^FCHI", plage: "5D" });
    expect(anchors(html).filter((a) => a.attributes["aria-current"] === "page").map((a) => a.text)).toEqual(["1M"]);
    expect(tableDates(html)[0]).toBe("20/10/2026");
  });

  it("given an unknown instrument, when I open the page, then the list shows and there is no chart", async () => {
    const html = await seeded({ instrument: "NOPE" });
    expect(html).not.toContain("<figure");
    expect(html).not.toContain('aria-current="true"');
    expect(textOf(html)).toContain("CAC 40");
  });
});
