// Shared helpers of the market tiles tests (US #21): seed closes and read the tiles out of the markup.
import { expect } from "vitest";
import { textOf } from "./home-page";

/** Inserts `[symbol, date, close]` rows into the file at `path`. Call before the page opens the database. */
export async function seedCloses(path: string, rows: [string, string, number][]): Promise<void> {
  const { openDatabase } = await import("../../src/lib/db/client");
  const sqlite = openDatabase(path);
  try {
    for (const [symbol, date, close] of rows) {
      sqlite.prepare("INSERT INTO prices_daily (symbol, date, close) VALUES (?, ?, ?)").run(symbol, date, close);
    }
  } finally {
    sqlite.close();
  }
}

export type Tile = { html: string; text: string; className: string };

/** The markup of `<section aria-label="Marchés">`, or null when the page has none. */
export function tilesSection(html: string): string | null {
  const match = /<section\b[^>]*aria-label="Marchés"[^>]*>([\s\S]*?)<\/section>/i.exec(html);
  return match ? match[1] : null;
}

/** Every `<li>` of the tiles section, in order. */
export function tiles(html: string): Tile[] {
  const section = tilesSection(html);
  expect(section, 'the page must have a <section aria-label="Marchés">').not.toBeNull();
  return [...(section as string).matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)].map((m) => ({
    html: m[2],
    text: textOf(m[2]),
    className: /class="([^"]*)"/.exec(m[1])?.[1] ?? "",
  }));
}

/** The tile of the instrument called `name`. */
export function tileOf(html: string, name: string): Tile {
  const found = tiles(html).find((t) => t.text.includes(name));
  expect(found, `a tile must show ${name}`).toBeDefined();
  return found as Tile;
}

/** Number of points of the `<polyline>` of a tile's curve; null when it has no curve. */
export function curvePointCount(tile: Tile): number | null {
  const svg = /<svg\b[^>]*role="img"[^>]*>([\s\S]*?)<\/svg>/i.exec(tile.html);
  if (!svg) return null;
  const points = /<polyline\b[^>]*\spoints="([^"]*)"/i.exec(svg[1]);
  return points ? points[1].trim().split(/\s+/).length : null;
}
