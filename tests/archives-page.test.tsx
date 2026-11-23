// US #16 — a visitor finds past briefs on the archives page (C66).
//
// Contract (CLAUDE.md §5; decisions of US #16):
// - `src/app/archives/page.tsx` serves `/archives` (App Router, no route group): a server
//   component (sync or async) that renders without the Next.js runtime, reads the database at
//   `DATABASE_PATH` and is rendered at request time (`dynamic = "force-dynamic"` or
//   `revalidate = 0`).
// - Which briefs count, as on the home page: `published` only (drafts never), dated up to today in
//   Europe/Paris included (a future-dated brief is ignored, whatever the server's time zone).
// - One group per month, from the most recent month to the oldest, each under a heading
//   (`<h1>`…`<h6>`) naming the month in French (« novembre 2026 », case-insensitive). Inside a
//   month, briefs go from the most recent date to the oldest; on the same date the weekly recap
//   comes before the daily brief.
// - Each brief is one entry: a link (`<a href="/brief/AAAA-MM-JJ">`) whose text holds its date in
//   French (« vendredi 20 novembre 2026 »). The link text of a weekly recap also carries a label
//   matching /récap/i (« Récap de la semaine », as the home page titles it), which daily entries do
//   not: the two links of a date then read differently, link text alone.
// - No published brief: a friendly French message (« aucun brief … »), no crash.
//
// Time is frozen with fake timers (only `Date`): the page must read "now" from `Date`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { otherValidPayload, validPayload, type JsonObject } from "./fixtures/brief-payloads";
import { parseAttributes, renderArchivesPage, seedPayloads, textOf, type SeedPayload } from "./helpers/home-page";
import { makeMigratedDatabase } from "./helpers/mcp";

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

/** Seeds the briefs, then renders /archives as a visitor gets it. */
async function archivesWith(seeds: SeedPayload[]): Promise<{ html: string; text: string }> {
  await seedPayloads(databasePath, seeds);
  const html = await renderArchivesPage();
  return { html, text: textOf(html) };
}

/** A published brief of `date`, its TL;DR naming it (no « récap » in a daily TL;DR). */
function brief(date: string, kind: "daily" | "weekly" = "daily", status: "published" | "draft" = "published"): SeedPayload {
  const base: JsonObject = kind === "weekly" ? validPayload() : otherValidPayload();
  return { date, kind, status, payload: { ...base, tldr: `TL;DR (${kind}, ${status}) du ${date}.` } };
}

const FRENCH_MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** A month and its year, not preceded by a day number (« 20 novembre 2026 » is a date, not a month). */
const MONTH_HEADING = new RegExp(`(?<!\\d\\s*)\\b(${FRENCH_MONTHS.join("|")})\\s+(\\d{4})\\b`, "iu");

type Entry = { href: string; text: string };
type MonthGroup = { month: string; entries: Entry[] };

/**
 * The archive as a visitor reads it: each heading naming a month opens a group, holding the links
 * to `/brief/…` that follow it up to the next month heading (links before the first one are left
 * out). Month names are lowercased.
 */
function monthGroups(html: string): MonthGroup[] {
  const headings = [...html.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)].flatMap((match) => {
    const month = textOf(match[2]).match(MONTH_HEADING);
    return month ? [{ index: match.index, month: `${month[1].toLowerCase()} ${month[2]}` }] : [];
  });
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ index: match.index, href: parseAttributes(match[1]).href ?? "", text: textOf(match[2]) }))
    .filter((link) => link.href.startsWith("/brief/"));

  return headings.map((heading, position) => {
    const end = headings[position + 1]?.index ?? Infinity;
    return {
      month: heading.month,
      entries: links.filter((link) => link.index > heading.index && link.index < end).map(({ href, text }) => ({ href, text })),
    };
  });
}

/** Groups reduced to their month and the URLs of their entries, in document order. */
function outline(html: string): { month: string; hrefs: string[] }[] {
  return monthGroups(html).map((group) => ({ month: group.month, hrefs: group.entries.map((entry) => entry.href) }));
}

describe("C66 — given published briefs, when I open /archives, then I see them grouped by month, from the most recent to the oldest, weekly recaps told apart", () => {
  it("C66 — given briefs over four months across a year boundary, when I open /archives, then I see one group per month, from the most recent month to the oldest, and inside each the most recent date first", async () => {
    // Seeded out of order: neither the row id nor the publication time gives the expected order.
    const { html } = await archivesWith([
      brief("2026-10-30"),
      brief("2026-11-20"),
      brief("2025-12-31"),
      brief("2026-11-23"),
      brief("2026-01-02"),
      brief("2026-11-03"),
      brief("2025-12-15"),
    ]);

    expect(outline(html)).toEqual([
      { month: "novembre 2026", hrefs: ["/brief/2026-11-23", "/brief/2026-11-20", "/brief/2026-11-03"] },
      { month: "octobre 2026", hrefs: ["/brief/2026-10-30"] },
      { month: "janvier 2026", hrefs: ["/brief/2026-01-02"] },
      { month: "décembre 2025", hrefs: ["/brief/2025-12-31", "/brief/2025-12-15"] },
    ]);
  });

  it("C66 — given published briefs, when I open /archives, then each entry links to its brief and shows its date in French", async () => {
    const frenchDates: Record<string, string> = {
      "2026-11-23": "lundi 23 novembre 2026",
      "2026-11-03": "mardi 3 novembre 2026",
      "2026-10-30": "vendredi 30 octobre 2026",
      "2025-12-31": "mercredi 31 décembre 2025",
    };

    const { html } = await archivesWith(Object.keys(frenchDates).map((date) => brief(date)));

    const entries = monthGroups(html).flatMap((group) => group.entries);
    expect(entries.map((entry) => entry.href).sort()).toEqual(Object.keys(frenchDates).map((date) => `/brief/${date}`).sort());
    for (const entry of entries) {
      const date = entry.href.slice("/brief/".length);
      expect(entry.text.toLowerCase(), `the link to ${entry.href} must show its date in French`).toContain(frenchDates[date]);
    }
  });

  it("C66 — given a weekly recap and a daily brief on the same dates, when I open /archives, then the weekly recap comes first and only its entry carries a « récap » label", async () => {
    // On Nov 21 the daily brief is written first, on Nov 14 the weekly recap: no row order can pass
    // for the tie-break on both dates.
    const { html } = await archivesWith([
      brief("2026-11-21", "daily"),
      brief("2026-11-21", "weekly"),
      brief("2026-11-20", "daily"),
      brief("2026-11-14", "weekly"),
      brief("2026-11-14", "daily"),
    ]);

    const groups = monthGroups(html);
    expect(groups.map((group) => group.month)).toEqual(["novembre 2026"]);
    expect(groups[0].entries.map((entry) => [entry.href, /récap/i.test(entry.text)])).toEqual([
      ["/brief/2026-11-21", true],
      ["/brief/2026-11-21", false],
      ["/brief/2026-11-20", false],
      ["/brief/2026-11-14", true],
      ["/brief/2026-11-14", false],
    ]);
    for (const entry of groups[0].entries) {
      expect(entry.text.toLowerCase(), "a weekly recap shows its date too").toMatch(/samedi (21|14) novembre 2026|vendredi 20 novembre 2026/);
    }
  });

  it("C66 — given drafts and briefs dated after today in Paris, when I open /archives, then only the published briefs up to today are listed and no month is opened for the others", async () => {
    const { html, text } = await archivesWith([
      brief("2026-11-20"),
      brief("2026-11-21", "daily"),
      brief("2026-11-21", "weekly", "draft"),
      brief("2026-11-19", "daily", "draft"),
      brief("2026-09-10", "daily", "draft"),
      brief("2026-11-24"),
      brief("2026-12-01"),
    ]);

    expect(outline(html)).toEqual([{ month: "novembre 2026", hrefs: ["/brief/2026-11-21", "/brief/2026-11-20"] }]);
    expect(monthGroups(html)[0].entries.some((entry) => /récap/i.test(entry.text)), "the draft weekly recap is not listed").toBe(false);
    for (const date of ["2026-11-19", "2026-09-10", "2026-11-24", "2026-12-01"]) {
      expect(html).not.toContain(`/brief/${date}`);
      expect(text).not.toContain(`du ${date}.`);
    }
  });

  it("C66 — given it is just after midnight in Paris but still the day before in UTC, when I open /archives, then today's brief (Paris date) is listed", async () => {
    // 23:30 UTC on Sunday Nov 22 is already 00:30 on Monday Nov 23 in Paris.
    vi.setSystemTime(new Date("2026-11-22T23:30:00Z"));

    const { html } = await archivesWith([brief("2026-11-20"), brief("2026-11-23")]);

    expect(outline(html)).toEqual([{ month: "novembre 2026", hrefs: ["/brief/2026-11-23", "/brief/2026-11-20"] }]);
  });

  it("C66 — given no brief at all, when I open /archives, then a friendly French message says there is no brief yet", async () => {
    const { html, text } = await archivesWith([]);

    expect(text).toMatch(/aucun brief|pas encore de brief|pas de brief/i);
    expect(monthGroups(html)).toEqual([]);
    expect(html).not.toContain('href="/brief/');
  });

  it("C66 — given only drafts, when I open /archives, then I see the same empty state and nothing of the drafts", async () => {
    const { html, text } = await archivesWith([brief("2026-11-23", "daily", "draft"), brief("2026-11-21", "weekly", "draft")]);

    expect(text).toMatch(/aucun brief|pas encore de brief|pas de brief/i);
    expect(monthGroups(html)).toEqual([]);
    expect(html).not.toContain('href="/brief/');
  });

  it("C66 — given the archives page, when Next.js builds the app, then the page is rendered on each request and never frozen at build time", async () => {
    const page = (await import("../src/app/archives/page")) as { dynamic?: unknown; revalidate?: unknown };

    expect(page.dynamic === "force-dynamic" || page.revalidate === 0, 'export `dynamic = "force-dynamic"` or `revalidate = 0`').toBe(true);
  });
});
