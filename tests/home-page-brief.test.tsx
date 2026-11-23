// US #15 — a visitor reads the latest brief on the home page (C61, C62, and the empty state).
//
// Contract (CLAUDE.md §1, §5, §7; decisions of US #15):
// - `src/app/page.tsx` (« Aujourd'hui ») reads the database at `DATABASE_PATH` and shows the
//   latest brief: the `published` brief with the most recent date that is not after today in
//   Europe/Paris (whatever the server's time zone); a future-dated brief is ignored, drafts never
//   count. On the same date the weekly recap wins over the daily brief, as in
//   `get_recent_briefs` (`src/lib/briefs/recent.ts`).
// - It shows the TL;DR, the market mood as a French label next to the word « humeur »
//   (appetit_risque → « appétit pour le risque », aversion_risque → « aversion au risque »,
//   mitige → « mitigé »; never the raw enum value), and every news item in rank order with its
//   title, summary (Markdown rendered), a « Pourquoi ça compte » part, an « Impact possible » part,
//   a link to `sourceUrl` named after `sourceName`, and the illustration of its category.
// - Illustration: `<img src="/illustrations/<category>.svg" alt="">`, decorative (the news text
//   carries the meaning), one per news item; the file is a static, self-contained SVG in
//   `public/illustrations/`.
// - The brief's date is written in French (« vendredi 20 novembre 2026 ») in an `<h1>` or `<h2>`.
// - No published brief: a friendly French message (« aucun brief … »), no crash.
// - The page is rendered at request time (`dynamic = "force-dynamic"` or `revalidate = 0`), never
//   frozen at build time, so each morning's brief shows up without a rebuild.
//
// Time is frozen with fake timers (only `Date`): the page must read "now" from `Date`.
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATEGORIES } from "../src/lib/schemas/brief-enums";
import { newsItem, otherValidPayload, validPayload, type JsonObject } from "./fixtures/brief-payloads";
import { anchors, images, mainHeadings, renderHomePage, seedPayloads, textOf, type SeedPayload } from "./helpers/home-page";
import { makeMigratedDatabase } from "./helpers/mcp";
import { rootPath } from "./helpers/project";

/** 07:30 in Paris on Monday Nov 23, 2026 (CET, UTC+1). */
const MONDAY_MORNING = "2026-11-23T06:30:00Z";

let databasePath: string;

beforeEach(() => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  // The server's own time zone must not matter: pretend it runs in UTC, as in the container.
  vi.stubEnv("TZ", "UTC");
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(MONDAY_MORNING));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** Seeds the briefs, then renders the home page as a visitor gets it. */
async function homePageWith(seeds: SeedPayload[]): Promise<{ html: string; text: string }> {
  await seedPayloads(databasePath, seeds);
  const html = await renderHomePage();
  return { html, text: textOf(html) };
}

/** A valid payload whose TL;DR names it, so the test can tell which brief is shown. */
function payloadNamed(tldr: string, base: JsonObject = otherValidPayload()): JsonObject {
  return { ...base, tldr };
}

function news(payload: JsonObject): JsonObject[] {
  return payload.news as JsonObject[];
}

/** A stored text as the visitor reads it once its Markdown is rendered. */
function readable(markdown: string): string {
  return textOf(markdown.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"));
}

const MOOD_LABELS = {
  appetit_risque: /app[ée]tit (pour le|au|du) risque/i,
  aversion_risque: /aversion (pour le|au|du) risque/i,
  mitige: /mitig[ée]/i,
} as const;

describe("C61 — given a brief published today, when I open the home page, then I see the TL;DR, the market mood and every news item in full", () => {
  it("C61 — given a brief published today, when I open the home page, then I see its TL;DR and not an older brief's", async () => {
    const today = validPayload();
    const yesterday = payloadNamed("TL;DR du brief d'hier qui ne doit pas s'afficher aujourd'hui.");

    const { text } = await homePageWith([
      { date: "2026-11-23", payload: today },
      { date: "2026-11-20", payload: yesterday },
    ]);

    expect(text).toContain(today.tldr as string);
    expect(text).not.toContain(yesterday.tldr as string);
  });

  it.each(Object.entries(MOOD_LABELS))(
    "C61 — given a brief published today with the mood %s, when I open the home page, then I see the market mood as a French label",
    async (mood, label) => {
      const { text } = await homePageWith([{ date: "2026-11-23", payload: { ...validPayload(), mood } }]);

      expect(text).toMatch(/humeur/i);
      expect(text).toMatch(label);
      expect(text, "the raw enum value must not be shown").not.toMatch(new RegExp(`\\b${mood}\\b`));
    },
  );

  it("C61 — given a brief published today, when I open the home page, then each news item shows its title, summary, « pourquoi ça compte » and possible impact, in rank order", async () => {
    const payload = validPayload();

    const { html, text } = await homePageWith([{ date: "2026-11-23", payload }]);

    let previous = -1;
    for (const item of news(payload)) {
      const position = text.indexOf(item.title as string);
      expect(position, `title « ${item.title} » must be shown`).toBeGreaterThanOrEqual(0);
      expect(position, "news items must follow their rank").toBeGreaterThan(previous);
      previous = position;
      expect(text).toContain(readable(item.summary as string));
      expect(text).toContain(readable(item.whyItMatters as string));
      expect(text).toContain(readable(item.impact as string));
    }
    expect((text.match(/pourquoi [çc]a compte/gi) ?? []).length).toBeGreaterThanOrEqual(news(payload).length);
    expect((text.match(/impact possible/gi) ?? []).length).toBeGreaterThanOrEqual(news(payload).length);
    // The summary is Markdown: rendered, not shown raw.
    expect(html).toMatch(/<strong>2 %<\/strong>/);
    expect(text).not.toContain("**");
  });

  it("C61 — given a brief published today, when I open the home page, then each news item has a clickable source link to its URL, named after the source", async () => {
    const payload = validPayload();

    const { html } = await homePageWith([{ date: "2026-11-23", payload }]);

    const links = anchors(html);
    for (const item of news(payload)) {
      const link = links.find((anchor) => anchor.attributes.href === item.sourceUrl);
      expect(link, `a link to ${item.sourceUrl} must be shown`).toBeDefined();
      expect(link?.text).toContain(item.sourceName as string);
    }
  });

  it("C61 — given a brief published today, when I open the home page, then each news item shows the illustration of its category, in rank order", async () => {
    const payload = validPayload();

    const { html } = await homePageWith([{ date: "2026-11-23", payload }]);

    const illustrations = images(html).filter((image) => image.src?.startsWith("/illustrations/"));
    expect(illustrations.map((image) => image.src)).toEqual(news(payload).map((item) => `/illustrations/${item.category}.svg`));
    for (const image of illustrations) expect(image.alt, "the illustration is decorative: alt=\"\"").toBe("");
  });

  it.each(CATEGORIES.map((category) => [category, category]))(
    "C61 — given a news item of category %s, when I open the home page, then it shows the illustration /illustrations/%s.svg",
    async (category) => {
      const payload = { ...validPayload(), news: [newsItem({ category })] };

      const { html } = await homePageWith([{ date: "2026-11-23", payload }]);

      expect(images(html).map((image) => image.src)).toContain(`/illustrations/${category}.svg`);
    },
  );

  it.each(CATEGORIES.map((category) => [category, category]))(
    "C61 — given the category %s, when the repo is read, then public/illustrations/%s.svg is a self-contained SVG with no script",
    (category) => {
      const path = rootPath("public", "illustrations", `${category}.svg`);
      expect(existsSync(path), `${path} must exist`).toBe(true);

      const svg = readFileSync(path, "utf8");
      expect(svg).toMatch(/<svg\b/i);
      expect(svg).not.toMatch(/<script\b/i);
      expect(svg, "no event handler attribute").not.toMatch(/\son[a-z]+\s*=/i);
      expect(svg, "nothing is downloaded: no external or embedded reference").not.toMatch(
        /(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|javascript:|data:)/i,
      );
    },
  );

  it("C61 — given it is just after midnight in Paris but still the day before in UTC, when I open the home page, then today's brief (Paris date) is shown", async () => {
    // 23:30 UTC on Sunday Nov 22 is already 00:30 on Monday Nov 23 in Paris.
    vi.setSystemTime(new Date("2026-11-22T23:30:00Z"));
    const monday = payloadNamed("TL;DR du lundi 23 novembre, daté en heure de Paris.", validPayload());
    const saturday = payloadNamed("TL;DR du récapitulatif du samedi 21 novembre.");

    const { text } = await homePageWith([
      { date: "2026-11-23", payload: monday },
      { date: "2026-11-21", kind: "weekly", payload: saturday },
    ]);

    expect(text).toContain(monday.tldr as string);
    expect(text).not.toContain(saturday.tldr as string);
  });

  it("C61 — given the home page, when Next.js builds the app, then the page is rendered on each request and never frozen at build time", async () => {
    const page = (await import("../src/app/page")) as { dynamic?: unknown; revalidate?: unknown };

    expect(page.dynamic === "force-dynamic" || page.revalidate === 0, 'export `dynamic = "force-dynamic"` or `revalidate = 0`').toBe(true);
  });
});

describe("C62 — given no brief today, when I open the home page, then I see the latest brief with its date clearly shown", () => {
  it("C62 — given no brief today, when I open the home page, then I see the latest published brief with its French date in a heading", async () => {
    const friday = payloadNamed("TL;DR du vendredi 20 novembre, le dernier brief publié.", validPayload());
    const wednesday = payloadNamed("TL;DR du mercredi 18 novembre, plus ancien.");

    const { text, html } = await homePageWith([
      { date: "2026-11-18", payload: wednesday },
      { date: "2026-11-20", payload: friday },
    ]);

    expect(text).toContain(friday.tldr as string);
    expect(text).not.toContain(wednesday.tldr as string);
    for (const item of news(friday)) expect(text).toContain(item.title as string);
    expect(mainHeadings(html).join(" | ")).toMatch(/vendredi 20 novembre 2026/i);
  });

  it("C62 — given a draft dated today and a brief published yesterday, when I open the home page, then I see the published brief and never the draft", async () => {
    const draft = payloadNamed("TL;DR d'un brouillon jamais publié.");
    const sunday = payloadNamed("TL;DR du brief publié le dimanche 22 novembre.", validPayload());

    const { text, html } = await homePageWith([
      { date: "2026-11-22", payload: sunday },
      { date: "2026-11-23", payload: draft, status: "draft" },
    ]);

    expect(text).toContain(sunday.tldr as string);
    expect(text).not.toContain(draft.tldr as string);
    for (const item of news(draft)) expect(text).not.toContain(item.title as string);
    expect(mainHeadings(html).join(" | ")).toMatch(/dimanche 22 novembre 2026/i);
  });

  it("C62 — given a daily brief and a weekly recap on the same latest date, when I open the home page, then I see the weekly recap", async () => {
    // Saturday Nov 21, 10:30 in Paris. The daily brief is written last, so neither the row id nor
    // the publication time can pass for the tie-break.
    vi.setSystemTime(new Date("2026-11-21T09:30:00Z"));
    const weekly = payloadNamed("TL;DR du récapitulatif de la semaine.", validPayload());
    const daily = payloadNamed("TL;DR d'un brief quotidien du samedi.");

    const { text } = await homePageWith([
      { date: "2026-11-21", kind: "weekly", payload: weekly },
      { date: "2026-11-21", kind: "daily", payload: daily },
    ]);

    expect(text).toContain(weekly.tldr as string);
    expect(text).not.toContain(daily.tldr as string);
  });

  it("C62 — given a brief dated after today in Paris, when I open the home page, then it is ignored and the latest brief up to today is shown", async () => {
    const tomorrow = payloadNamed("TL;DR d'un brief daté de demain par erreur.");
    const friday = payloadNamed("TL;DR du vendredi 20 novembre.", validPayload());

    const { text, html } = await homePageWith([
      { date: "2026-11-24", payload: tomorrow },
      { date: "2026-11-20", payload: friday },
    ]);

    expect(text).toContain(friday.tldr as string);
    expect(text).not.toContain(tomorrow.tldr as string);
    expect(mainHeadings(html).join(" | ")).toMatch(/vendredi 20 novembre 2026/i);
  });
});

describe("US #15 — empty state: no published brief yet", () => {
  it("given no brief at all, when I open the home page, then a friendly French message says there is no brief yet", async () => {
    const { text } = await homePageWith([]);

    expect(text).toMatch(/aucun brief|pas encore de brief|pas de brief/i);
    expect(text).not.toMatch(/humeur|pourquoi [çc]a compte|impact possible/i);
  });

  it("given only a draft, when I open the home page, then I see the same empty state and nothing of the draft", async () => {
    const draft = payloadNamed("TL;DR d'un brouillon jamais publié.");

    const { text } = await homePageWith([{ date: "2026-11-23", payload: draft, status: "draft" }]);

    expect(text).toMatch(/aucun brief|pas encore de brief|pas de brief/i);
    expect(text).not.toContain(draft.tldr as string);
    for (const item of news(draft)) expect(text).not.toContain(item.title as string);
  });
});
