// US #21 — data of the market tiles: `getMarketTiles(db, briefDate)` (src/lib/market/tiles.ts).
//
// Contract: one entry per instrument ordered by name; only closes dated STRICTLY BEFORE `briefDate`
// count (what the prices job had stored the morning the brief was written); `lastClose`,
// `lastCloseDate` and `dayVariation` come from `computeVariations`; `curve` holds the closes from
// (last close date - 1 calendar month) to the last close date, inclusive, oldest first.
import { describe, expect, it } from "vitest";
import { getMarketTiles } from "../src/lib/market/tiles";
import { openMigrated } from "./helpers/prices";

function seed(rows: [string, string, number][]) {
  const { sqlite, db } = openMigrated();
  for (const [symbol, date, close] of rows) {
    sqlite.prepare("INSERT INTO prices_daily (symbol, date, close) VALUES (?, ?, ?)").run(symbol, date, close);
  }
  return db;
}

describe("C81 — given closes in the database, when the tiles are loaded, then each instrument has its last close, day variation and 1 month curve", () => {
  it("C81 — given no close at all, when the tiles are loaded, then every instrument of the table has a tile, ordered by name, without close", () => {
    const tiles = getMarketTiles(seed([]), "2026-11-23");
    expect(tiles).toHaveLength(9);
    expect(tiles.map((t) => t.name)).toEqual([...tiles.map((t) => t.name)].sort((a, b) => a.localeCompare(b)));
    expect(tiles[0]).toMatchObject({ lastClose: null, lastCloseDate: null, dayVariation: null, curve: [] });
  });

  it("C81 — given two closes, when the tiles are loaded, then the last close and the day variation come from them", () => {
    const db = seed([["^FCHI", "2026-11-19", 8000], ["^FCHI", "2026-11-20", 8100]]);
    const cac = getMarketTiles(db, "2026-11-23").find((t) => t.symbol === "^FCHI");
    expect(cac).toMatchObject({ name: "CAC 40", type: "index", currency: "EUR", lastClose: 8100, lastCloseDate: "2026-11-20", dayVariation: 1.25 });
  });

  it("C81 — given a single close, when the tiles are loaded, then the day variation is null", () => {
    const db = seed([["^FCHI", "2026-11-20", 8100]]);
    const cac = getMarketTiles(db, "2026-11-23").find((t) => t.symbol === "^FCHI");
    expect(cac).toMatchObject({ lastClose: 8100, dayVariation: null });
  });

  it("C81 — given closes over two months, when the tiles are loaded, then the curve spans last close date minus one month to the last close date, inclusive", () => {
    const db = seed([
      ["^STOXX50E", "2026-10-19", 1],
      ["^STOXX50E", "2026-10-20", 2],
      ["^STOXX50E", "2026-11-02", 3],
      ["^STOXX50E", "2026-11-20", 4],
    ]);
    const tile = getMarketTiles(db, "2026-11-23").find((t) => t.symbol === "^STOXX50E");
    expect(tile?.curve).toEqual([
      { date: "2026-10-20", close: 2 },
      { date: "2026-11-02", close: 3 },
      { date: "2026-11-20", close: 4 },
    ]);
  });

  it("C81 — given a last close on 31 March, when the tiles are loaded, then the month start is clamped to 28 February", () => {
    const db = seed([["^GSPC", "2027-02-27", 1], ["^GSPC", "2027-02-28", 2], ["^GSPC", "2027-03-31", 3]]);
    const tile = getMarketTiles(db, "2027-04-01").find((t) => t.symbol === "^GSPC");
    expect(tile?.curve.map((p) => p.date)).toEqual(["2027-02-28", "2027-03-31"]);
  });
});

describe("C82 — given an archive date, when the tiles are loaded, then only the closes before that date count", () => {
  const rows: [string, string, number][] = [
    ["^FCHI", "2026-11-16", 90],
    ["^FCHI", "2026-11-17", 100],
    ["^FCHI", "2026-11-18", 110],
    ["^FCHI", "2026-11-20", 200],
  ];

  it("C82 — given closes up to the 20th, when the tiles of the 18th are loaded, then the last close is the one of the 17th", () => {
    const cac = getMarketTiles(seed(rows), "2026-11-18").find((t) => t.symbol === "^FCHI");
    expect(cac).toMatchObject({ lastClose: 100, lastCloseDate: "2026-11-17", dayVariation: 11.11 });
    expect(cac?.curve.map((p) => p.date)).toEqual(["2026-11-16", "2026-11-17"]);
  });

  it("C82 — given a close dated the brief date itself, when the tiles are loaded, then it is ignored", () => {
    const cac = getMarketTiles(seed(rows), "2026-11-20").find((t) => t.symbol === "^FCHI");
    expect(cac).toMatchObject({ lastClose: 110, lastCloseDate: "2026-11-18" });
  });

  it("C82 — given no close before the brief date, when the tiles are loaded, then the instrument has no close", () => {
    const cac = getMarketTiles(seed(rows), "2026-11-16").find((t) => t.symbol === "^FCHI");
    expect(cac).toMatchObject({ lastClose: null, lastCloseDate: null, dayVariation: null, curve: [] });
  });
});
