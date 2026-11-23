// US #16 — a visitor rereads the brief of a given day at /brief/AAAA-MM-JJ (C67), and gets a
// French 404 page when there is none (C68).
//
// Contract (CLAUDE.md §5; decisions of US #16):
// - `src/app/brief/[date]/page.tsx` serves `/brief/AAAA-MM-JJ` (App Router, no route group): a
//   server component (sync or async) that renders without the Next.js runtime, receives `params`
//   as a Promise (`{ params: Promise<{ date: string }> }`, Next.js 15), reads the database at
//   `DATABASE_PATH` and is rendered at request time (`dynamic = "force-dynamic"` or
//   `revalidate = 0`).
// - Which briefs count, as on the home page: `published` only (drafts never), dated up to today in
//   Europe/Paris included (a future-dated brief is ignored, whatever the server's time zone).
// - It shows the brief of *that* date (not the latest one) the way the home page shows the latest
//   brief: its date in French (« mercredi 18 novembre 2026 ») in an `<h1>` or `<h2>`, the TL;DR,
//   the market mood as a French label next to the word « humeur » (never the raw enum value), and
//   every news item in rank order with its title, summary (Markdown rendered, sanitized: raw HTML
//   shows as text), a « Pourquoi ça compte » part, an « Impact possible » part and a link to
//   `sourceUrl` named after `sourceName`. When a weekly recap and a daily brief share the date,
//   both are shown, the weekly recap first.
// - 404: when the date has no published brief up to today (no brief, only a draft, only a
//   future-dated brief) and when the segment is not a valid calendar date `AAAA-MM-JJ`
//   (`2026-02-30`, `2026-13-01`, `2026-11-2`, `hier`, …), the page calls `notFound()` from
//   `next/navigation` (no database error, no crash): in Next.js 15.5 it throws an error whose
//   digest is `NEXT_HTTP_ERROR_FALLBACK;404`, recognised here with Next.js' own helpers.
// - The 404 page is `src/app/not-found.tsx` (root, so every unknown URL gets it): French text
//   (« page introuvable », « aucun brief »…) inside the root layout, and a link `<a href="/archives">`.
//
// Time is frozen with fake timers (only `Date`): the page must read "now" from `Date`.
import {
  getAccessFallbackHTTPStatus,
  isHTTPAccessFallbackError,
} from "next/dist/client/components/http-access-fallback/http-access-fallback";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { otherValidPayload, validPayload, type JsonObject } from "./fixtures/brief-payloads";
import {
  anchors,
  mainHeadings,
  renderBriefPage,
  renderNotFoundDocument,
  seedPayloads,
  textOf,
  type SeedPayload,
} from "./helpers/home-page";
import { makeMigratedDatabase } from "./helpers/mcp";

// The root layout imports its stylesheet; Vitest does not build CSS (Tailwind runs in Next.js).
vi.mock("../src/app/globals.css", () => ({}));

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

/** Seeds the briefs, then renders /brief/<date> as a visitor gets it. */
async function briefPageWith(seeds: SeedPayload[], date: string): Promise<{ html: string; text: string }> {
  await seedPayloads(databasePath, seeds);
  const html = await renderBriefPage(date);
  return { html, text: textOf(html) };
}

/** Seeds the briefs, then opens /brief/<date> and returns what the page threw (undefined if nothing). */
async function errorOfBriefPage(seeds: SeedPayload[], date: string): Promise<unknown> {
  await seedPayloads(databasePath, seeds);
  return renderBriefPage(date).then(
    () => undefined,
    (error: unknown) => error ?? new Error("the page threw a nullish value"),
  );
}

function expectNotFound(error: unknown): void {
  expect(error, "the page must call notFound() instead of rendering").toBeDefined();
  expect(isHTTPAccessFallbackError(error), `notFound() from next/navigation must be called, got: ${String(error)}`).toBe(true);
  expect(getAccessFallbackHTTPStatus(error as Parameters<typeof getAccessFallbackHTTPStatus>[0])).toBe(404);
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

describe("C67 — given a date with a brief, when I open /brief/AAAA-MM-JJ, then that day's brief is shown", () => {
  it("C67 — given briefs on several dates, when I open /brief/2026-11-18, then I see that day's brief with its French date in a heading, not the latest brief", async () => {
    const wednesday = payloadNamed("TL;DR du mercredi 18 novembre, le brief demandé.", validPayload());
    const latest = payloadNamed("TL;DR du lundi 23 novembre, le dernier brief publié.");
    const older = payloadNamed("TL;DR du lundi 16 novembre, plus ancien.");

    const { html, text } = await briefPageWith(
      [
        { date: "2026-11-23", payload: latest },
        { date: "2026-11-18", payload: wednesday },
        { date: "2026-11-16", payload: older },
      ],
      "2026-11-18",
    );

    expect(text).toContain(wednesday.tldr as string);
    expect(text).not.toContain(latest.tldr as string);
    expect(text).not.toContain(older.tldr as string);
    for (const item of news(latest)) expect(text, "news of another day must not be shown").not.toContain(item.title as string);
    expect(mainHeadings(html).join(" | ")).toMatch(/mercredi 18 novembre 2026/i);
  });

  it("C67 — given a brief from last year, when I open its URL, then it is shown (the archive is not limited to recent days)", async () => {
    const newYearsEve = payloadNamed("TL;DR du mercredi 31 décembre 2025.", validPayload());

    const { html, text } = await briefPageWith(
      [
        { date: "2025-12-31", payload: newYearsEve },
        { date: "2026-11-23", payload: payloadNamed("TL;DR du lundi 23 novembre.") },
      ],
      "2025-12-31",
    );

    expect(text).toContain(newYearsEve.tldr as string);
    expect(mainHeadings(html).join(" | ")).toMatch(/mercredi 31 décembre 2025/i);
  });

  it.each(Object.entries(MOOD_LABELS))(
    "C67 — given a brief with the mood %s, when I open its URL, then I see the market mood as a French label",
    async (mood, label) => {
      const { text } = await briefPageWith([{ date: "2026-11-18", payload: { ...validPayload(), mood } }], "2026-11-18");

      expect(text).toMatch(/humeur/i);
      expect(text).toMatch(label);
      expect(text, "the raw enum value must not be shown").not.toMatch(new RegExp(`\\b${mood}\\b`));
    },
  );

  it("C67 — given a brief, when I open its URL, then each news item shows its title, summary, « pourquoi ça compte » and possible impact, in rank order", async () => {
    const payload = validPayload();

    const { html, text } = await briefPageWith([{ date: "2026-11-18", payload }], "2026-11-18");

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

  it("C67 — given a brief, when I open its URL, then each news item has a clickable source link to its URL, named after the source", async () => {
    const payload = validPayload();

    const { html } = await briefPageWith([{ date: "2026-11-18", payload }], "2026-11-18");

    const links = anchors(html);
    for (const item of news(payload)) {
      const link = links.find((anchor) => anchor.attributes.href === item.sourceUrl);
      expect(link, `a link to ${item.sourceUrl} must be shown`).toBeDefined();
      expect(link?.text).toContain(item.sourceName as string);
    }
  });

  it("C67 — given HTML and a script in the TL;DR and a summary, when I open the brief's URL, then they show as text and nothing is interpreted", async () => {
    const injection = "<script>alert(1)</script><img src=x onerror=alert(1)>";
    const payload = validPayload();
    payload.tldr = `Résumé ${injection}`;
    news(payload)[0].summary = `Texte ${injection}`;

    const { html, text } = await briefPageWith([{ date: "2026-11-18", payload }], "2026-11-18");

    expect(text).toContain(`Résumé ${injection}`);
    expect(text).toContain(`Texte ${injection}`);
    expect(html).not.toMatch(/<script\b/i);
    expect(html, "no event handler attribute").not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
  });

  it("C67 — given a weekly recap and a daily brief on the same date, when I open its URL, then both are shown, the weekly recap first", async () => {
    // Saturday Nov 21. The daily brief is written first, so the row order cannot pass for the
    // weekly-first rule.
    const weekly = payloadNamed("TL;DR du récapitulatif de la semaine.", validPayload());
    const daily = payloadNamed("TL;DR du brief quotidien du samedi.");

    const { html, text } = await briefPageWith(
      [
        { date: "2026-11-21", kind: "daily", payload: daily },
        { date: "2026-11-21", kind: "weekly", payload: weekly },
      ],
      "2026-11-21",
    );

    const weeklyAt = text.indexOf(weekly.tldr as string);
    const dailyAt = text.indexOf(daily.tldr as string);
    expect(weeklyAt, "the weekly recap must be shown").toBeGreaterThanOrEqual(0);
    expect(dailyAt, "the daily brief must be shown").toBeGreaterThanOrEqual(0);
    expect(weeklyAt, "the weekly recap comes first").toBeLessThan(dailyAt);
    for (const item of news(weekly)) {
      const position = text.indexOf(item.title as string);
      expect(position, `the recap's news « ${item.title} » is shown with the recap`).toBeGreaterThan(weeklyAt);
      expect(position).toBeLessThan(dailyAt);
    }
    for (const item of news(daily)) {
      expect(text.indexOf(item.title as string), `the daily news « ${item.title} » is shown with the daily brief`).toBeGreaterThan(dailyAt);
    }
    expect(mainHeadings(html).join(" | ")).toMatch(/samedi 21 novembre 2026/i);
    expect(mainHeadings(html).join(" | "), "the weekly recap is titled as such").toMatch(/récap/i);
  });

  it("C67 — given a published daily brief and a draft weekly recap on the same date, when I open its URL, then I see the published brief and never the draft", async () => {
    const draft = payloadNamed("TL;DR d'un récapitulatif resté en brouillon.", validPayload());
    const daily = payloadNamed("TL;DR du brief quotidien publié le samedi.");

    const { text } = await briefPageWith(
      [
        { date: "2026-11-21", kind: "daily", payload: daily },
        { date: "2026-11-21", kind: "weekly", payload: draft, status: "draft" },
      ],
      "2026-11-21",
    );

    expect(text).toContain(daily.tldr as string);
    expect(text).not.toContain(draft.tldr as string);
    for (const item of news(draft)) expect(text).not.toContain(item.title as string);
  });

  it("C67 — given it is just after midnight in Paris but still the day before in UTC, when I open today's URL (Paris date), then today's brief is shown", async () => {
    // 23:30 UTC on Sunday Nov 22 is already 00:30 on Monday Nov 23 in Paris.
    vi.setSystemTime(new Date("2026-11-22T23:30:00Z"));
    const monday = payloadNamed("TL;DR du lundi 23 novembre, daté en heure de Paris.", validPayload());

    const { text } = await briefPageWith([{ date: "2026-11-23", payload: monday }], "2026-11-23");

    expect(text).toContain(monday.tldr as string);
  });

  it("C67 — given the brief page, when Next.js builds the app, then the page is rendered on each request and never frozen at build time", async () => {
    const page = (await import("../src/app/brief/[date]/page")) as { dynamic?: unknown; revalidate?: unknown };

    expect(page.dynamic === "force-dynamic" || page.revalidate === 0, 'export `dynamic = "force-dynamic"` or `revalidate = 0`').toBe(true);
  });
});

describe("C68 — given a date without a brief, when I open its URL, then I see a French 404 page with a link to the archives", () => {
  /** Published briefs around the dates below, plus a draft and a future-dated brief. */
  const context: SeedPayload[] = [
    { date: "2026-11-23", payload: payloadNamed("TL;DR du lundi 23 novembre.", validPayload()) },
    { date: "2026-11-20", payload: payloadNamed("TL;DR du vendredi 20 novembre.") },
    { date: "2026-11-19", payload: payloadNamed("TL;DR d'un brouillon du jeudi 19 novembre."), status: "draft" },
    { date: "2026-11-24", payload: payloadNamed("TL;DR d'un brief daté de demain par erreur.") },
  ];

  it.each([
    ["2026-11-18", "no brief at all on that date"],
    ["2026-11-19", "only a draft on that date"],
    ["2026-11-24", "only a brief dated after today in Paris"],
  ])("C68 — given %s with %s, when I open its URL, then the page answers 404 through notFound()", async (date) => {
    expectNotFound(await errorOfBriefPage(context, date));
  });

  it.each([
    ["2026-02-30", "a day that does not exist"],
    ["2025-02-29", "Feb 29 of a common year"],
    ["2026-13-01", "a month 13"],
    ["2026-00-10", "a month 0"],
    ["2026-11-00", "a day 0"],
    ["2026-11-2", "a one-digit day"],
    ["26-11-23", "a two-digit year"],
    ["20261123", "no dashes"],
    ["2026-11-23x", "trailing characters after a date that has a brief"],
    ["2026-11-23T08:00", "a time after a date that has a brief"],
    ["hier", "a word"],
  ])("C68 — given the segment %s (%s), when I open /brief/<segment>, then the page answers 404 through notFound()", async (segment) => {
    expectNotFound(await errorOfBriefPage(context, segment));
  });

  it("C68 — given an unknown URL, when the 404 page renders inside the root layout, then it reads in French and links to the archives", async () => {
    const html = await renderNotFoundDocument();
    const text = textOf(html);

    expect(text).toMatch(/introuvable|aucun brief|pas de brief|n'existe pas/i);
    expect(text, "no Next.js default English text").not.toMatch(/could not be found|not found/i);
    const archives = anchors(html).find((anchor) => anchor.attributes.href === "/archives");
    expect(archives, 'a link <a href="/archives"> must be shown').toBeDefined();
    expect(archives?.text, "the link to the archives has a visible French label").toMatch(/archives|briefs/i);
  });
});
