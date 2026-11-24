// US #26 — the « Ma watchlist » section of the brief (#99, #100).
//
// Contract (`src/lib/render/brief.tsx`, used by the home page and /brief/[date]; data from
// `src/lib/briefs/latest.ts`):
// - a brief with stock notes has a `<section>` named « Ma watchlist » (`aria-label="Ma watchlist"`
//   or labelled by its heading) with one `<li>` card per note, in the notes' order. A card shows
//   the instrument's name, its day variation (the app's number: same as the market tiles, closes
//   strictly before the brief date, `variationLabel`, « n/d » when unknown, green / red classes),
//   the summary of Claude through the sanitized Markdown renderer, the news refs as safe links
//   (new tab, rel noopener noreferrer) and the next event when present.
// - a brief without notes has no such section and no « Ma watchlist » text at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validPayload, type JsonObject } from "./fixtures/brief-payloads";
import { seedStocks } from "./helpers/briefs";
import { anchors, renderBriefPage, renderHomePage, seedPayloads, textOf } from "./helpers/home-page";
import { seedCloses } from "./helpers/market-tiles";
import { makeMigratedDatabase } from "./helpers/mcp";

vi.mock("../src/app/globals.css", () => ({}));

/** 07:30 in Paris on Monday Nov 23, 2026. */
const MONDAY_MORNING = "2026-11-23T06:30:00Z";
const DATE = "2026-11-23";

let databasePath: string;

beforeEach(async () => {
  databasePath = makeMigratedDatabase();
  await seedStocks(databasePath, [
    { symbol: "AI.PA", name: "Air Liquide" },
    { symbol: "MC.PA", name: "LVMH" },
    { symbol: "SAN.PA", name: "Sanofi" },
  ]);
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

const NOTES: JsonObject[] = [
  {
    symbol: "AI.PA",
    reason: "earnings",
    summary: "Air Liquide publie des **résultats solides**.",
    newsRefs: ["https://example.com/air-liquide"],
    nextEvent: "Assemblée générale le 6 mai",
  },
  { symbol: "MC.PA", reason: "move", summary: "LVMH recule avec tout le luxe." },
  { symbol: "SAN.PA", reason: "news", summary: "Sanofi annonce un essai clinique." },
];

const CLOSES: [string, string, number][] = [
  ["AI.PA", "2026-11-19", 150],
  ["AI.PA", "2026-11-20", 153], // +2,00 %
  ["AI.PA", "2026-11-23", 999], // dated the brief date: ignored
  ["MC.PA", "2026-11-19", 500],
  ["MC.PA", "2026-11-20", 490], // −2,00 %
  // SAN.PA: no close -> n/d
];

function payloadWithNotes(notes: JsonObject[]): JsonObject {
  return { ...validPayload(), stockNotes: notes };
}

/** The markup inside the section named « Ma watchlist », or null. */
function watchlistSection(html: string): string | null {
  for (const match of html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi)) {
    if (/aria-label="Ma watchlist"/.test(match[1])) return match[2];
    if (/<h[1-6]\b[^>]*>\s*Ma watchlist\s*<\/h[1-6]>/.test(match[2])) return match[2];
  }
  return null;
}

type Card = { html: string; text: string };

function cards(html: string): Card[] {
  const section = watchlistSection(html);
  expect(section, "the page must have a « Ma watchlist » section").not.toBeNull();
  return [...(section as string).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => ({ html: m[1], text: textOf(m[1]) }));
}

function cardOf(html: string, name: string): Card {
  const found = cards(html).find((c) => c.text.includes(name));
  expect(found, `a card must show ${name}`).toBeDefined();
  return found as Card;
}

async function homeWithNotes(notes = NOTES): Promise<string> {
  await seedPayloads(databasePath, [{ date: DATE, payload: payloadWithNotes(notes) }]);
  await seedCloses(databasePath, CLOSES);
  return renderHomePage();
}

describe("#99 — given a daily brief with notes, when I open it, then the section shows one card per stock with its variation and Claude's text", () => {
  it("#99 — given three notes, when I open the home page, then « Ma watchlist » has one card per note, in order", async () => {
    const html = await homeWithNotes();
    expect(cards(html).map((c) => c.text.match(/Air Liquide|LVMH|Sanofi/)?.[0])).toEqual(["Air Liquide", "LVMH", "Sanofi"]);
  });

  it("#99 — given notes, when I open the home page, then the section has a heading « Ma watchlist » and an accessible name", async () => {
    const html = await homeWithNotes();
    expect(html).toMatch(/<section\b[^>]*(aria-label="Ma watchlist"|aria-labelledby=)[^>]*>/);
    expect(html).toMatch(/<h2\b[^>]*>\s*Ma watchlist\s*<\/h2>/);
  });

  it("#99 — given notes, when I open the brief of a date, then the section is there too", async () => {
    await seedPayloads(databasePath, [{ date: DATE, payload: payloadWithNotes(NOTES) }]);
    await seedCloses(databasePath, CLOSES);
    const html = await renderBriefPage(DATE);
    expect(cards(html)).toHaveLength(3);
  });

  it("#99 — given a rise, when I open the brief, then the card shows the day variation « +2,00 % » in green, from closes before the brief date", async () => {
    const card = cardOf(await homeWithNotes(), "Air Liquide");
    expect(card.text).toContain("+2,00 %");
    expect(card.html).toMatch(/class="[^"]*\btext-green[^"]*"[^>]*>[^<]*\+2,00/);
    expect(card.text).not.toMatch(/999/);
  });

  it("#99 — given a fall, when I open the brief, then the card shows « −2,00 % » (real minus sign) in red", async () => {
    const card = cardOf(await homeWithNotes(), "LVMH");
    expect(card.text).toContain("−2,00 %");
    expect(card.html).toMatch(/class="[^"]*\btext-red[^"]*"[^>]*>[^<]*−2,00/);
  });

  it("#99 — given a stock without any close, when I open the brief, then its variation reads « n/d »", async () => {
    const card = cardOf(await homeWithNotes(), "Sanofi");
    expect(card.text).toContain("n/d");
    expect(card.html).not.toMatch(/\btext-(green|red)/);
  });

  it("#99 — given an archive brief, when I open it, then the variation uses the closes before its own date", async () => {
    await seedPayloads(databasePath, [{ date: "2026-11-20", payload: payloadWithNotes([NOTES[0]]) }]);
    await seedCloses(databasePath, [
      ["AI.PA", "2026-11-18", 100],
      ["AI.PA", "2026-11-19", 110], // +10,00 %
      ["AI.PA", "2026-11-20", 500],
    ]);
    const card = cardOf(await renderBriefPage("2026-11-20"), "Air Liquide");
    expect(card.text).toContain("+10,00 %");
  });

  it("#99 — given a note summary in Markdown, when I open the brief, then the text of Claude is shown through the sanitized renderer", async () => {
    const card = cardOf(await homeWithNotes(), "Air Liquide");
    expect(card.html).toMatch(/<strong>résultats solides<\/strong>/);
    expect(card.text).toContain("Air Liquide publie des résultats solides.");
    expect(card.text).not.toContain("**");
  });

  it("#99 — given raw HTML in a summary, when I open the brief, then it is shown as text, never as markup", async () => {
    const html = await homeWithNotes([{ ...NOTES[1], summary: "Attention <script>alert(1)</script> <img src=x onerror=alert(1)>" }]);
    const section = watchlistSection(html) as string;
    expect(section).not.toMatch(/<script/i);
    expect(section).not.toMatch(/<img/i);
    expect(textOf(section)).toContain("<script>alert(1)</script>");
  });

  it("#99 — given news refs, when I open the brief, then they are links opening in a new tab with rel noopener noreferrer", async () => {
    const section = watchlistSection(await homeWithNotes()) as string;
    const link = anchors(section).find((a) => a.attributes.href === "https://example.com/air-liquide");
    expect(link, "a link to the news ref").toBeDefined();
    expect(link?.attributes.target).toBe("_blank");
    expect(link?.attributes.rel).toMatch(/noopener/);
    expect(link?.attributes.rel).toMatch(/noreferrer/);
  });

  it("#99 — given a next event, when I open the brief, then the card shows it, and a card without one shows no empty label", async () => {
    const html = await homeWithNotes();
    expect(cardOf(html, "Air Liquide").text).toContain("Assemblée générale le 6 mai");
    expect(cardOf(html, "LVMH").text).not.toMatch(/prochain/i);
  });

  it("#99 — given a note whose symbol has no instrument any more, when I open the brief, then the page still renders and the card falls back to the symbol", async () => {
    await seedPayloads(databasePath, [{ date: DATE, payload: payloadWithNotes([NOTES[1]]), validate: true }]);
    const { openDatabase } = await import("../src/lib/db/client");
    const sqlite = openDatabase(databasePath);
    sqlite.prepare("DELETE FROM instruments WHERE symbol = 'MC.PA'").run();
    sqlite.close();
    const html = await renderHomePage();
    expect(cards(html)[0].text).toContain("MC.PA");
  });

  it("#99 — given notes, when I open the brief, then the market tiles section still comes before the watchlist and the news follow", async () => {
    const html = await homeWithNotes();
    expect(html.indexOf('aria-label="Marchés"')).toBeLessThan(html.indexOf("Ma watchlist"));
    expect(html.indexOf("Ma watchlist")).toBeLessThan(html.indexOf("La BCE maintient"));
  });
});

describe("#100 — given a brief without notes, when I open it, then the section does not appear", () => {
  it("#100 — given a payload without stockNotes, when I open the home page, then there is no « Ma watchlist » section", async () => {
    await seedPayloads(databasePath, [{ date: DATE, payload: validPayload() }]);
    const html = await renderHomePage();
    expect(watchlistSection(html)).toBeNull();
    expect(html).not.toContain("Ma watchlist");
  });

  it("#100 — given an empty stockNotes, when I open the brief of a date, then there is no section either", async () => {
    await seedPayloads(databasePath, [{ date: DATE, payload: payloadWithNotes([]) }]);
    const html = await renderBriefPage(DATE);
    expect(watchlistSection(html)).toBeNull();
    expect(html).not.toContain("Ma watchlist");
  });

  it("#100 — given a brief without notes next to one with notes, when I open the first, then it has no section", async () => {
    await seedPayloads(databasePath, [
      { date: "2026-11-20", payload: payloadWithNotes(NOTES) },
      { date: DATE, payload: validPayload() },
    ]);
    expect(await renderBriefPage(DATE)).not.toContain("Ma watchlist");
    expect(watchlistSection(await renderBriefPage("2026-11-20"))).not.toBeNull();
  });
});
