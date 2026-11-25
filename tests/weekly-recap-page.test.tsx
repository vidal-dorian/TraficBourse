// US #29 — criteria 3 and 4: reading the Saturday recap.
//
// Contract:
// - a published weekly recap shows its TL;DR, its news (the « semaine en 5 points », at most 5, in
//   rank order) and its « Ma watchlist » section, one card per followed stock.
// - on a weekly brief the cards show the WEEK variation (app figure: `computeVariations` `week`,
//   closes strictly before the brief date, label mentioning « semaine »), green / red as the
//   tiles; « n/d » when unknown. A daily brief keeps showing the day variation and never the word
//   « semaine » in its cards.
// - home page on a Saturday: the weekly recap is the one shown, over a daily brief of that date.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newsItem, validPayload, type JsonObject } from "./fixtures/brief-payloads";
import { seedStocks } from "./helpers/briefs";
import { anchors, renderBriefPage, renderHomePage, seedPayloads, textOf } from "./helpers/home-page";
import { seedCloses } from "./helpers/market-tiles";
import { makeMigratedDatabase } from "./helpers/mcp";

vi.mock("../src/app/globals.css", () => ({}));

/** 10:30 in Paris on Saturday Nov 21, 2026. */
const SATURDAY = "2026-11-21T09:30:00Z";
const DATE = "2026-11-21";

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
  vi.setSystemTime(new Date(SATURDAY));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const NOTES: JsonObject[] = [
  { symbol: "AI.PA", reason: "weekly", summary: "Air Liquide a publié des résultats.", newsRefs: ["https://example.com/air-liquide"], nextEvent: "Assemblée générale le 6 mai" },
  { symbol: "MC.PA", reason: "weekly", summary: "LVMH a reculé avec tout le luxe." },
  { symbol: "SAN.PA", reason: "weekly", summary: "Sanofi est resté discret." },
];

// Brief date 2026-11-21: only closes before it count. Week reference = last close on or before
// (last close date 2026-11-20) − 7 days = 2026-11-13.
const CLOSES: [string, string, number][] = [
  ["AI.PA", "2026-11-13", 100],
  ["AI.PA", "2026-11-19", 104],
  ["AI.PA", "2026-11-20", 105], // week +5,00 %, day +0,96 %
  ["AI.PA", "2026-11-21", 999], // dated the brief date: ignored
  ["MC.PA", "2026-11-13", 500],
  ["MC.PA", "2026-11-19", 480],
  ["MC.PA", "2026-11-20", 470], // week −6,00 %, day −2,08 %
  // SAN.PA: no close -> n/d
];

function weeklyPayload(): JsonObject {
  const news = ["Taux", "Pétrole", "Tech", "Luxe", "Crypto"].map((t) => newsItem({ title: `Point de la semaine : ${t}` }));
  return { ...validPayload(), news, stockNotes: NOTES };
}

function section(html: string): string {
  for (const match of html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi)) {
    if (/aria-label="Ma watchlist"/.test(match[1])) return match[2];
  }
  throw new Error("the page must have a « Ma watchlist » section");
}

function card(html: string, name: string): { html: string; text: string } {
  const found = [...section(html).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => ({ html: m[1], text: textOf(m[1]) }))
    .find((c) => c.text.includes(name));
  expect(found, `a card must show ${name}`).toBeDefined();
  return found as { html: string; text: string };
}

async function weeklyHome(): Promise<string> {
  await seedPayloads(databasePath, [{ date: DATE, kind: "weekly", payload: weeklyPayload() }]);
  await seedCloses(databasePath, CLOSES);
  return renderHomePage();
}

describe("US #29 criterion 3 — given a published recap, when I open it, then I see the week in 5 points, the week variations and one note per followed stock", () => {
  it("given a recap with five news, when I open the brief of its date, then the five points are shown in rank order", async () => {
    await seedPayloads(databasePath, [{ date: DATE, kind: "weekly", payload: weeklyPayload() }]);
    const text = textOf(await renderBriefPage(DATE));
    const positions = ["Taux", "Pétrole", "Tech", "Luxe", "Crypto"].map((t) => text.indexOf(`Point de la semaine : ${t}`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("given a recap, when I open it, then « Ma watchlist » has one card per followed stock, in order", async () => {
    const html = await weeklyHome();
    const names = [...section(html).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => textOf(m[1]).match(/Air Liquide|LVMH|Sanofi/)?.[0]);
    expect(names).toEqual(["Air Liquide", "LVMH", "Sanofi"]);
  });

  it("given a rise over the week, when I open the recap, then the card shows the week variation « +5,00 % » in green, labelled as the week's", async () => {
    const c = card(await weeklyHome(), "Air Liquide");
    expect(c.text).toContain("+5,00 %");
    expect(c.text).toMatch(/semaine/i);
    expect(c.html).toMatch(/class="[^"]*\btext-green[^"]*"[^>]*>[^<]*\+5,00/);
    expect(c.text, "closes dated the brief date are ignored").not.toContain("999");
    expect(c.text, "the day variation is not what a recap card leads with").not.toContain("+0,96 %");
  });

  it("given a fall over the week, when I open the recap, then the card shows « −6,00 % » in red", async () => {
    const c = card(await weeklyHome(), "LVMH");
    expect(c.text).toContain("−6,00 %");
    expect(c.html).toMatch(/class="[^"]*\btext-red[^"]*"[^>]*>[^<]*−6,00/);
  });

  it("given a stock without close, when I open the recap, then its week variation reads « n/d »", async () => {
    const c = card(await weeklyHome(), "Sanofi");
    expect(c.text).toContain("n/d");
    expect(c.html).not.toMatch(/\btext-(green|red)/);
  });

  it("given a history shorter than a week, when I open the recap, then the variation is « n/d », as computeVariations says", async () => {
    await seedPayloads(databasePath, [{ date: DATE, kind: "weekly", payload: weeklyPayload() }]);
    await seedCloses(databasePath, [
      ["AI.PA", "2026-11-19", 104],
      ["AI.PA", "2026-11-20", 105],
    ]);
    const c = card(await renderHomePage(), "Air Liquide");
    expect(c.text).toContain("n/d");
    expect(c.text).not.toContain("+0,96 %");
  });

  it("given the notes, when I open the recap, then summary, next event and news refs are shown as for a daily brief", async () => {
    const html = await weeklyHome();
    const c = card(html, "Air Liquide");
    expect(c.text).toContain("Air Liquide a publié des résultats.");
    expect(c.text).toContain("Assemblée générale le 6 mai");
    const link = anchors(c.html).find((a) => a.attributes.href === "https://example.com/air-liquide");
    expect(link?.attributes.target).toBe("_blank");
    expect(link?.attributes.rel).toMatch(/noopener/);
  });

  it("given a daily brief with notes, when I open it, then its cards keep the day variation and never mention the week", async () => {
    await seedPayloads(databasePath, [
      { date: DATE, kind: "daily", payload: { ...validPayload(), stockNotes: [{ symbol: "AI.PA", reason: "move", summary: "Air Liquide bouge." }] } },
    ]);
    await seedCloses(databasePath, CLOSES);
    const c = card(await renderBriefPage(DATE), "Air Liquide");
    expect(c.text).toContain("+0,96 %");
    expect(c.text).not.toContain("+5,00 %");
    expect(c.text).not.toMatch(/semaine/i);
  });

  it("given a daily and a weekly of the same date, when I open the brief of that date, then each brief shows its own variation", async () => {
    await seedPayloads(databasePath, [
      { date: DATE, kind: "weekly", payload: weeklyPayload() },
      { date: DATE, kind: "daily", payload: { ...validPayload(), tldr: "TL;DR du quotidien.", stockNotes: [{ symbol: "AI.PA", reason: "move", summary: "Air Liquide bouge." }] } },
    ]);
    await seedCloses(databasePath, CLOSES);
    const html = await renderBriefPage(DATE);
    expect(html).toContain("+5,00 %");
    expect(html).toContain("+0,96 %");
  });
});

describe("US #29 criterion 4 — given the home page on a Saturday, when the recap is published, then it is the one displayed", () => {
  it("given a weekly and a daily brief of Saturday, when I open the home page, then I see the recap with its notes and not the daily", async () => {
    await seedPayloads(databasePath, [
      { date: DATE, kind: "weekly", payload: { ...weeklyPayload(), tldr: "TL;DR du récapitulatif de la semaine." } },
      { date: DATE, kind: "daily", payload: { ...validPayload(), tldr: "TL;DR du quotidien du samedi." } },
    ]);
    await seedCloses(databasePath, CLOSES);
    const text = textOf(await renderHomePage());
    expect(text).toContain("TL;DR du récapitulatif de la semaine.");
    expect(text).not.toContain("TL;DR du quotidien du samedi.");
    expect(text).toContain("Ma watchlist");
    expect(text).toContain("+5,00 %");
  });

  it("given the recap published after the daily, when I open the home page, then the recap still wins", async () => {
    await seedPayloads(databasePath, [
      { date: DATE, kind: "daily", payload: { ...validPayload(), tldr: "TL;DR du quotidien du samedi." } },
      { date: DATE, kind: "weekly", payload: { ...weeklyPayload(), tldr: "TL;DR du récapitulatif de la semaine." } },
    ]);
    const text = textOf(await renderHomePage());
    expect(text).toContain("TL;DR du récapitulatif de la semaine.");
    expect(text).not.toContain("TL;DR du quotidien du samedi.");
  });

  it("given the recap, when I open the home page on Saturday, then the missing-recap banner is not shown", async () => {
    const text = textOf(await weeklyHome());
    expect(text).not.toContain("pas encore arrivé");
  });

  it("given only a daily brief of Saturday and the recap of last week, when I open the home page, then the daily brief of today is shown", async () => {
    await seedPayloads(databasePath, [
      { date: "2026-11-14", kind: "weekly", payload: { ...weeklyPayload(), tldr: "TL;DR du récapitulatif précédent." } },
      { date: DATE, kind: "daily", payload: { ...validPayload(), tldr: "TL;DR du quotidien du samedi." } },
    ]);
    const text = textOf(await renderHomePage());
    expect(text).toContain("TL;DR du quotidien du samedi.");
    expect(text).not.toContain("TL;DR du récapitulatif précédent.");
  });
});
