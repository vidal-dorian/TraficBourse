// US #21 — « d'un coup d'œil » market tiles on both brief pages (C81, C82, C83).
//
// Contract: the home page and /brief/AAAA-MM-JJ render, above the news, a server-side
// `<section aria-label="Marchés">` with one `<li>` per instrument (name, last close via
// `formatClose`, day variation in French notation with explicit sign, green `text-green*` / red
// `text-red*` / neutral, and an inline `<svg role="img" aria-label="Évolution sur 1 mois…">` holding
// a `<polyline points="…">`). Reference date = the brief's date; only closes strictly before it count.
// Layout (375 px): the `<ul>` scrolls horizontally (`flex overflow-x-auto`), tiles are `shrink-0`
// with a fixed width class `w-N` (N <= 48, i.e. <= 12rem).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validPayload } from "./fixtures/brief-payloads";
import { renderBriefPage, renderHomePage, seedPayloads, textOf } from "./helpers/home-page";
import { curvePointCount, seedCloses, tileOf, tiles, tilesSection } from "./helpers/market-tiles";
import { makeMigratedDatabase } from "./helpers/mcp";

vi.mock("../src/app/globals.css", () => ({}));

/** 07:30 in Paris on Monday Nov 23, 2026. */
const MONDAY_MORNING = "2026-11-23T06:30:00Z";

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
  ["^FCHI", "2026-11-19", 8000],
  ["^FCHI", "2026-11-20", 8100], // +1,25 %
  ["^FCHI", "2026-11-23", 9999], // dated the brief date: ignored
  ["^GSPC", "2026-11-19", 5000],
  ["^GSPC", "2026-11-20", 4960], // -0,80 %
  ["^NDX", "2026-11-19", 100],
  ["^NDX", "2026-11-20", 100], // 0,00 %
  ["^STOXX50E", "2026-10-19", 1], // outside the 1 month window
  ["^STOXX50E", "2026-10-20", 2],
  ["^STOXX50E", "2026-11-02", 3],
  ["^STOXX50E", "2026-11-20", 4],
  ["BTC-EUR", "2026-11-20", 70000], // single close: no variation, no curve
];

async function homeWithTiles(): Promise<string> {
  await seedPayloads(databasePath, [{ date: "2026-11-23", payload: validPayload() }]);
  await seedCloses(databasePath, CLOSES);
  return renderHomePage();
}

async function briefPageWithTiles(date: string, rows = CLOSES): Promise<string> {
  await seedPayloads(databasePath, [{ date, payload: validPayload() }]);
  await seedCloses(databasePath, rows);
  return renderBriefPage(date);
}

describe("C81 — given closes in the database, when I open a brief, then one tile per instrument shows the last close, the signed day variation and a 1 month curve", () => {
  it("C81 — given a brief of today, when I open the home page, then there is one tile per instrument above the news", async () => {
    const html = await homeWithTiles();
    expect(tiles(html)).toHaveLength(9);
    expect(html.indexOf('aria-label="Marchés"')).toBeLessThan(html.indexOf("La BCE maintient"));
  });

  it("C81 — given a brief of a date, when I open it, then one tile per instrument is shown there too", async () => {
    expect(tiles(await briefPageWithTiles("2026-11-23"))).toHaveLength(9);
  });

  it("C81 — given a close, when I open a brief, then the tile shows the name and the last close formatted like the Marchés page", async () => {
    const { formatClose } = await import("../src/lib/market/format");
    const tile = tileOf(await homeWithTiles(), "CAC 40");
    expect(tile.text).toContain(textOf(formatClose(8100, "index", "EUR")));
    expect(tile.text).not.toMatch(/9\s?999/);
  });

  it("C81 — given a rise, when I open a brief, then the variation reads « +1,25 % » in green", async () => {
    const tile = tileOf(await homeWithTiles(), "CAC 40");
    expect(tile.text).toContain("+1,25 %");
    expect(tile.html).toMatch(/class="[^"]*\btext-green[^"]*"[^>]*>[^<]*\+1,25/);
    expect(tile.html).not.toMatch(/\btext-red/);
  });

  it("C81 — given a fall, when I open a brief, then the variation reads « −0,80 % » (real minus sign) in red", async () => {
    const tile = tileOf(await homeWithTiles(), "S&P 500");
    expect(tile.text).toContain("−0,80 %");
    expect(tile.html).toMatch(/class="[^"]*\btext-red[^"]*"[^>]*>[^<]*−0,80/);
    expect(tile.html).not.toMatch(/\btext-green/);
  });

  it("C81 — given an unchanged close, when I open a brief, then the variation reads « 0,00 % » without sign and neither green nor red", async () => {
    const tile = tileOf(await homeWithTiles(), "Nasdaq 100");
    expect(tile.text).toContain("0,00 %");
    expect(tile.text).not.toMatch(/[+−-]0,00/);
    expect(tile.html).not.toMatch(/\btext-(green|red)/);
  });

  it("C81 — given a single close, when I open a brief, then the variation reads « n/d » and there is no curve", async () => {
    const tile = tileOf(await homeWithTiles(), "Bitcoin");
    expect(tile.text).toContain("n/d");
    expect(tile.html).not.toMatch(/\btext-(green|red)/);
    expect(curvePointCount(tile)).toBeNull();
  });

  it("C81 — given closes over a month, when I open a brief, then the tile has a labelled inline SVG curve of the closes of the last month only", async () => {
    const tile = tileOf(await homeWithTiles(), "Euro Stoxx 50");
    expect(tile.html).toMatch(/<svg\b[^>]*role="img"[^>]*aria-label="Évolution sur 1 mois[^"]*"|<svg\b[^>]*aria-label="Évolution sur 1 mois[^"]*"[^>]*role="img"/);
    expect(curvePointCount(tile)).toBe(3);
    expect(tile.html).not.toMatch(/<script/);
  });

  it("C81 — given an instrument without any close, when I open a brief, then its tile says « Pas encore de cours » with no variation nor curve", async () => {
    const tile = tileOf(await homeWithTiles(), "Pétrole Brent");
    expect(tile.text).toContain("Pas encore de cours");
    expect(tile.text).not.toContain("n/d");
    expect(curvePointCount(tile)).toBeNull();
  });
});

describe("C82 — given an archive brief, when I open it, then the tiles show the closes of its date, not today's", () => {
  const ROWS: [string, string, number][] = [
    ["^FCHI", "2026-11-16", 90],
    ["^FCHI", "2026-11-17", 100],
    ["^FCHI", "2026-11-18", 110], // dated the brief date: ignored
    ["^FCHI", "2026-11-20", 200],
  ];

  it("C82 — given closes up to the 20th, when I open the brief of the 18th, then the CAC 40 tile shows the close of the 17th and its variation", async () => {
    const { formatClose } = await import("../src/lib/market/format");
    const tile = tileOf(await briefPageWithTiles("2026-11-18", ROWS), "CAC 40");
    expect(tile.text).toContain(textOf(formatClose(100, "index", "EUR")));
    expect(tile.text).toContain("+11,11 %");
    expect(tile.text).not.toContain(textOf(formatClose(200, "index", "EUR")));
    expect(tile.text).not.toContain(textOf(formatClose(110, "index", "EUR")));
  });

  it("C82 — given the same closes, when I open the brief of the 20th, then its tile shows another close than the 18th's", async () => {
    const tile = tileOf(await briefPageWithTiles("2026-11-20", ROWS), "CAC 40");
    const { formatClose } = await import("../src/lib/market/format");
    expect(tile.text).toContain(textOf(formatClose(110, "index", "EUR")));
  });

  it("C82 — given an archive older than every close, when I open it, then the tiles say « Pas encore de cours »", async () => {
    const tile = tileOf(await briefPageWithTiles("2026-11-10", ROWS), "CAC 40");
    expect(tile.text).toContain("Pas encore de cours");
  });

  it("C82 — given the latest brief is dated the 20th, when I open the home page, then the tiles use the 20th as reference", async () => {
    await seedPayloads(databasePath, [{ date: "2026-11-20", payload: validPayload() }]);
    await seedCloses(databasePath, ROWS);
    const { formatClose } = await import("../src/lib/market/format");
    const tile = tileOf(await renderHomePage(), "CAC 40");
    expect(tile.text).toContain(textOf(formatClose(110, "index", "EUR")));
  });
});

describe("C83 — given a 375 px screen, when I look at the tiles, then they scroll horizontally without overflowing the page", () => {
  it("C83 — given the tiles, when the page is rendered, then the list scrolls horizontally inside its own container", async () => {
    const html = await homeWithTiles();
    const section = tilesSection(html);
    expect(section, 'the page must have a <section aria-label="Marchés">').not.toBeNull();
    const list = /<ul\b[^>]*class="([^"]*)"/i.exec(section ?? "");
    expect(list?.[1], "the tiles are in a <ul class=…>").toBeDefined();
    expect(list?.[1]).toMatch(/\boverflow-x-auto\b/);
    expect(list?.[1]).toMatch(/\bflex\b/);
  });

  it("C83 — given the tiles, when the page is rendered, then every tile keeps a fixed width of at most 12rem and does not shrink", async () => {
    for (const tile of tiles(await homeWithTiles())) {
      expect(tile.className).toMatch(/\bshrink-0\b/);
      const width = /(?:^|\s)w-(\d+)(?:\s|$)/.exec(tile.className);
      expect(width, `tile « ${tile.text} » needs a w-N class`).not.toBeNull();
      expect(Number(width?.[1])).toBeLessThanOrEqual(48);
      expect(tile.className).not.toMatch(/\bw-\[|\bmin-w-/);
    }
  });

  it("C83 — given the brief of a date, when the page is rendered, then it has the same scrolling layout", async () => {
    const html = await briefPageWithTiles("2026-11-23");
    expect(/<ul\b[^>]*class="([^"]*)"/i.exec(tilesSection(html) ?? "")?.[1] ?? "").toMatch(/\boverflow-x-auto\b/);
  });
});
