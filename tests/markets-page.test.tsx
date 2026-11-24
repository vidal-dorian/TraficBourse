// US #19 — the /marches page shows the last known close, with « au JJ/MM » when it is not the
// day's (criterion 77), and the root layout links to it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anchors, renderDocument, textOf } from "./helpers/home-page";
import { makeMigratedDatabase } from "./helpers/mcp";

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

async function seed(rows: [string, string, number][]) {
  const { openDatabase } = await import("../src/lib/db/client");
  const sqlite = openDatabase(databasePath);
  try {
    for (const [symbol, date, close] of rows) {
      sqlite.prepare("INSERT INTO prices_daily (symbol, date, close) VALUES (?, ?, ?)").run(symbol, date, close);
    }
  } finally {
    sqlite.close();
  }
}

async function renderMarkets(): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: Page } = await import("../src/app/marches/page");
  const element = await (Page as (p: unknown) => unknown)({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });
  return textOf(renderToStaticMarkup(element as never));
}

const NAMES = ["CAC 40", "Euro Stoxx 50", "S&P 500", "Nasdaq 100", "iShares Core MSCI World", "EUR/USD", "Or", "Pétrole Brent", "Bitcoin"];

/** The text between an instrument's name and the next instrument name. */
function lineOf(text: string, name: string): string {
  const start = text.indexOf(name);
  expect(start, `${name} must be shown`).toBeGreaterThanOrEqual(0);
  const ends = NAMES.map((n) => text.indexOf(n, start + name.length)).filter((i) => i > start);
  return text.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe("criterion 77 — last known close with « au JJ/MM »", () => {
  it("given a stale close (Wednesday 18/11 on Monday 23/11), when the page is shown, then the close appears with « au 18/11 »", async () => {
    await seed([["GC=F", "2026-11-18", 4012.5]]);
    const line = lineOf(await renderMarkets(), "Or");
    expect(line).toMatch(/4\s012,5/);
    expect(line).toContain("au 18/11");
  });

  it("given a fresh close (Friday 20/11 on Monday 23/11), when the page is shown, then the close appears without any « au » mention", async () => {
    await seed([["^FCHI", "2026-11-20", 7123.45]]);
    const line = lineOf(await renderMarkets(), "CAC 40");
    expect(line).toMatch(/7\s123,45/);
    expect(line).not.toMatch(/\bau \d{2}\/\d{2}/);
  });

  it("given crypto with Friday's close on a Monday, then it is stale and shows « au 20/11 », while Sunday's would not", async () => {
    await seed([["BTC-EUR", "2026-11-20", 90000], ["EURUSD=X", "2026-11-20", 1.06]]);
    const text = await renderMarkets();
    expect(lineOf(text, "Bitcoin")).toContain("au 20/11");
    expect(lineOf(text, "EUR/USD")).not.toMatch(/\bau \d{2}\/\d{2}/);
  });

  it("given an instrument with no price at all, then « Pas encore de cours » is shown for it, and not for the others", async () => {
    await seed([["^FCHI", "2026-11-20", 7000]]);
    const text = await renderMarkets();
    expect(lineOf(text, "Bitcoin")).toContain("Pas encore de cours");
    expect(lineOf(text, "CAC 40")).not.toContain("Pas encore de cours");
  });

  it("given the root layout, then it links to « Marchés » at /marches in the same tab", async () => {
    const link = anchors(await renderDocument(<p>Une page</p>)).find((a) => a.attributes.href === "/marches");
    expect(link, 'a link <a href="/marches"> must be shown').toBeDefined();
    expect(link?.text).toBe("Marchés");
    expect(link?.attributes.target).toBeUndefined();
  });
});
