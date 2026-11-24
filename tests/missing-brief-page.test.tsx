// US #27 — a visitor knows when today's brief has not arrived (CLAUDE.md §2).
//
// Contract (decisions of the lead):
// - `src/lib/briefs/missing.ts` exports `expectedBriefMissing(db, now)` -> "daily" | "weekly" | null,
//   reading the `published` briefs dated Paris today (a draft does not count).
// - The home page shows, from 08:00 Paris on Monday to Friday without a published daily brief,
//   an element `role="status"` reading « Le brief du jour n'est pas encore arrivé »; on Saturday
//   from 10:00 without a published weekly brief, « Le récap de la semaine n'est pas encore arrivé ».
//   Never on Sunday, never before those hours. The banner comes before the brief content (inside
//   <main>), also when no brief exists at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { otherValidPayload, validPayload, type JsonObject } from "./fixtures/brief-payloads";
import { renderHomePage, seedPayloads, textOf, type SeedPayload } from "./helpers/home-page";
import { makeMigratedDatabase } from "./helpers/mcp";

const DAILY_TEXT = "Le brief du jour n'est pas encore arrivé";
const WEEKLY_TEXT = "Le récap de la semaine n'est pas encore arrivé";

let databasePath: string;

beforeEach(() => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("TZ", "UTC");
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function at(iso: string) {
  vi.setSystemTime(new Date(iso));
}

function payloadNamed(tldr: string, base: JsonObject = validPayload()): JsonObject {
  return { ...base, tldr };
}

/** The `role="status"` elements of the markup, with their text. */
function statuses(html: string): string[] {
  return [...html.matchAll(/<(\w+)\b[^>]*\brole="status"[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => textOf(m[2]));
}

async function render(seeds: SeedPayload[] = []): Promise<{ html: string; banners: string[] }> {
  await seedPayloads(databasePath, seeds);
  const html = await renderHomePage();
  return { html, banners: statuses(html) };
}

describe("US #27 — banner on the home page", () => {
  it("C1 — given a winter weekday with no brief at 08:00 Paris, when I open the home page, then the daily banner is shown above the latest (yesterday's) brief", async () => {
    at("2026-11-24T07:00:00Z"); // Tuesday 08:00 CET
    const { html, banners } = await render([
      { date: "2026-11-23", payload: payloadNamed("TLDR-DE-LA-VEILLE") },
    ]);

    expect(banners).toHaveLength(1);
    expect(banners[0]).toContain(DAILY_TEXT);
    expect(html).toContain("TLDR-DE-LA-VEILLE");
    expect(html.indexOf(DAILY_TEXT)).toBeLessThan(html.indexOf("<h1"));
    expect(html.indexOf(DAILY_TEXT)).toBeLessThan(html.indexOf("TLDR-DE-LA-VEILLE"));
    expect(html.indexOf("<main")).toBeLessThan(html.indexOf(DAILY_TEXT));
  });

  it("C1 — given a winter weekday with no brief at 07:59 Paris, when I open the home page, then no banner is shown", async () => {
    at("2026-11-24T06:59:00Z");
    const { html, banners } = await render([{ date: "2026-11-23", payload: validPayload() }]);

    expect(banners).toEqual([]);
    expect(textOf(html)).not.toContain(DAILY_TEXT);
  });

  it("C1 — given a summer weekday (UTC+2) with no brief at 07:59 Paris, when I open the home page, then no banner is shown", async () => {
    at("2026-06-22T05:59:00Z");
    const { html } = await render([]);

    expect(textOf(html)).not.toContain(DAILY_TEXT);
  });

  it("C1 — given a summer weekday (UTC+2) with no brief at 08:00 Paris, when I open the home page, then the daily banner is shown", async () => {
    at("2026-06-22T06:00:00Z");
    const { banners } = await render([]);

    expect(banners.some((b) => b.includes(DAILY_TEXT))).toBe(true);
  });

  it("C1 — given no brief at all yet on a weekday after 08:00, when I open the home page, then the banner is shown above the empty-state text", async () => {
    at("2026-11-24T08:00:00Z");
    const { html, banners } = await render([]);

    expect(banners).toHaveLength(1);
    expect(banners[0]).toContain(DAILY_TEXT);
    expect(html.indexOf(DAILY_TEXT)).toBeLessThan(html.indexOf("Aucun brief publié"));
  });

  it("C1 — given a weekday after 08:00, when only a draft daily brief of today exists, then the banner is shown", async () => {
    at("2026-11-24T08:00:00Z");
    const { banners } = await render([{ date: "2026-11-24", status: "draft", payload: validPayload() }]);

    expect(banners.some((b) => b.includes(DAILY_TEXT))).toBe(true);
  });

  it("C1 — given a weekday after 08:00, when only a weekly brief of today is published, then the daily banner is still shown", async () => {
    at("2026-11-24T08:00:00Z");
    const { banners } = await render([
      { date: "2026-11-24", kind: "weekly", payload: payloadNamed("RECAP", otherValidPayload()) },
    ]);

    expect(banners.some((b) => b.includes(DAILY_TEXT))).toBe(true);
  });

  it("C2 — given a Saturday with no recap at 10:00 Paris, when I open the home page, then the recap banner is shown above the latest brief", async () => {
    at("2026-11-21T09:00:00Z"); // Saturday 10:00 CET
    const { html, banners } = await render([{ date: "2026-11-20", payload: payloadNamed("TLDR-DU-VENDREDI") }]);

    expect(banners).toHaveLength(1);
    expect(banners[0]).toContain(WEEKLY_TEXT);
    expect(html.indexOf(WEEKLY_TEXT)).toBeLessThan(html.indexOf("TLDR-DU-VENDREDI"));
  });

  it("C2 — given a Saturday with no recap at 09:59 Paris, when I open the home page, then no banner is shown", async () => {
    at("2026-11-21T08:59:00Z");
    const { html } = await render([{ date: "2026-11-20", payload: validPayload() }]);

    expect(textOf(html)).not.toContain(WEEKLY_TEXT);
    expect(textOf(html)).not.toContain(DAILY_TEXT);
  });

  it("C2 — given a summer Saturday with no recap at 10:00 Paris (UTC+2), when I open the home page, then the recap banner is shown", async () => {
    at("2026-06-20T08:00:00Z");
    const { banners } = await render([]);

    expect(banners.some((b) => b.includes(WEEKLY_TEXT))).toBe(true);
  });

  it("C2 — given a Saturday after 10:00, when only a daily brief of today is published, then the recap banner is still shown", async () => {
    at("2026-11-21T10:00:00Z");
    const { banners } = await render([{ date: "2026-11-21", kind: "daily", payload: validPayload() }]);

    expect(banners.some((b) => b.includes(WEEKLY_TEXT))).toBe(true);
  });

  it("C3 — given a weekday after 08:00, when today's daily brief is published, then the banner disappears", async () => {
    at("2026-11-24T08:00:00Z");
    const { html, banners } = await render([{ date: "2026-11-24", payload: payloadNamed("BRIEF-DU-JOUR") }]);

    expect(banners).toEqual([]);
    expect(textOf(html)).not.toContain(DAILY_TEXT);
    expect(html).toContain("BRIEF-DU-JOUR");
  });

  it("C3 — given a Saturday after 10:00, when the recap is published, then the banner disappears", async () => {
    at("2026-11-21T10:00:00Z");
    const { html, banners } = await render([
      { date: "2026-11-21", kind: "weekly", payload: payloadNamed("RECAP-DU-SAMEDI", otherValidPayload()) },
    ]);

    expect(banners).toEqual([]);
    expect(textOf(html)).not.toContain(WEEKLY_TEXT);
  });

  it("C4 — given a Sunday with no brief at any hour, when I open the home page, then no banner appears", async () => {
    for (const iso of ["2026-11-22T07:00:00Z", "2026-11-22T09:00:00Z", "2026-11-22T20:00:00Z"]) {
      vi.resetModules();
      at(iso);
      const { html } = await render([]);
      expect(textOf(html), iso).not.toContain("pas encore arrivé");
    }
  });
});

describe("US #27 — expectedBriefMissing reads the database", () => {
  async function missingWith(seeds: SeedPayload[], now: string) {
    await seedPayloads(databasePath, seeds);
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const { openDatabase } = await import("../src/lib/db/client");
    const schema = await import("../src/lib/db/schema");
    const { expectedBriefMissing } = await import("../src/lib/briefs/missing");
    const sqlite = openDatabase(databasePath);
    try {
      return expectedBriefMissing(drizzle(sqlite, { schema }), new Date(now));
    } finally {
      sqlite.close();
    }
  }

  it("C1 — given a weekday after 08:00 and an empty database, when it is computed, then it answers daily", async () => {
    expect(await missingWith([], "2026-11-24T08:00:00Z")).toBe("daily");
  });

  it("C3 — given today's published daily brief, when it is computed, then it answers null", async () => {
    expect(await missingWith([{ date: "2026-11-24", payload: validPayload() }], "2026-11-24T08:00:00Z")).toBeNull();
  });

  it("C1 — given only yesterday's brief, when it is computed, then the brief of another date does not count", async () => {
    expect(await missingWith([{ date: "2026-11-23", payload: validPayload() }], "2026-11-24T08:00:00Z")).toBe("daily");
  });

  it("C1 — given a draft of today, when it is computed, then it answers daily", async () => {
    const seeds: SeedPayload[] = [{ date: "2026-11-24", status: "draft", payload: validPayload() }];
    expect(await missingWith(seeds, "2026-11-24T08:00:00Z")).toBe("daily");
  });

  it("C2 — given a Saturday after 10:00 and a daily brief only, when it is computed, then it answers weekly", async () => {
    expect(await missingWith([{ date: "2026-11-21", payload: validPayload() }], "2026-11-21T10:00:00Z")).toBe("weekly");
  });

  it("C3 — given a Saturday after 10:00 and a published recap, when it is computed, then it answers null", async () => {
    const seeds: SeedPayload[] = [{ date: "2026-11-21", kind: "weekly", payload: otherValidPayload() }];
    expect(await missingWith(seeds, "2026-11-21T10:00:00Z")).toBeNull();
  });

  it("C4 — given a Sunday, when it is computed, then it answers null", async () => {
    expect(await missingWith([], "2026-11-22T12:00:00Z")).toBeNull();
  });
});
