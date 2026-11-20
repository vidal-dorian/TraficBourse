// US #14 — the Claude scheduled task rereads the briefs of the last days through the
// `get_recent_briefs` MCP tool (C59, C60), so that it does not repeat the same news.
//
// Integration tests with the official SDK client routed into the production route handler
// (`src/app/api/mcp/route.ts`, see tests/helpers/mcp.ts): what Claude's connector really calls.
//
// Contract (CLAUDE.md §7, decisions of US #14):
// - The production registry (`src/lib/mcp/tools/index.ts`) serves a read-only tool named
//   `get_recent_briefs` taking `{ days? }`: an optional integer from 1 to 30, 7 when absent.
//   Anything else (0, 31, 2.5, "7") is an invalid-arguments error naming `days`.
// - Window: calendar days counted back from today in Europe/Paris, whatever the server's time
//   zone: `since` = today (Paris) − `days`, and a brief is returned when its date is >= `since`
//   (today included). E.g. at 2026-11-20T23:30:00Z it is already 2026-11-21 in Paris, so
//   days = 7 gives since = 2026-11-14.
// - Only briefs with status "published"; a draft is never returned.
// - Order: date descending; for the same date, the weekly recap comes before the daily brief.
// - Result: `structuredContent` = `{ days, since, briefs }`, each entry exactly
//   `{ date, kind, tldr, newsTitles }` (titles in rank order): no summary, no source, no raw
//   payload. Plus a short French text for Claude that names each brief's date and its news
//   titles, and says explicitly ("aucun ...") when there is none. An empty window is not an error.
//
// Time is frozen with fake timers (only `Date` is faked, so the SDK's own timers keep running):
// the tool must read "now" from `Date` (e.g. `new Date()` passed to `Intl.DateTimeFormat`).
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countBriefRows, readBriefs, readNewsItems, SEEDED_NEWS_DETAILS, seedBriefs, type SeedBrief } from "./helpers/briefs";
import { connectClient, dispatch, makeMigratedDatabase, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

type RecentBrief = { date: string; kind: "daily" | "weekly"; tldr: string; newsTitles: string[] };

/** 23:30 UTC on Friday Nov 20 is already 00:30 on Saturday Nov 21 in Paris (CET, UTC+1). */
const PARIS_JUST_AFTER_MIDNIGHT = "2026-11-20T23:30:00Z";

let databasePath: string;
const clients: Client[] = [];

beforeEach(() => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
  // The server's own time zone must not matter: pretend it runs in UTC, as in the container.
  vi.stubEnv("TZ", "UTC");
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(PARIS_JUST_AFTER_MIDNIGHT));
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** An SDK client connected to the production /api/mcp route. */
async function connect(): Promise<Client> {
  const route = (await import("../src/app/api/mcp/route")) as unknown as RouteModule;
  const client = await connectClient((request) => dispatch(route, request), MCP_TEST_TOKEN);
  clients.push(client);
  return client;
}

function getRecentBriefs(client: Client, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return client.callTool({ name: "get_recent_briefs", arguments: args });
}

function resultText(result: ToolResult): string {
  const content = (result.content ?? []) as { type: string; text?: string }[];
  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

function expectSuccess(result: ToolResult): void {
  expect(result.isError, `get_recent_briefs failed:\n${resultText(result)}`).not.toBe(true);
  expect(resultText(result).trim().length).toBeGreaterThan(0);
}

function structured(result: ToolResult): { days: number; since: string; briefs: RecentBrief[] } {
  return result.structuredContent as { days: number; since: string; briefs: RecentBrief[] };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The answer as Claude reads it: what is expected of a published seed. */
function entry(seed: SeedBrief): RecentBrief {
  return { date: seed.date, kind: seed.kind, tldr: seed.tldr, newsTitles: seed.newsTitles };
}

function seed(date: string, kind: "daily" | "weekly", newsTitles: string[], status: "published" | "draft" = "published"): SeedBrief {
  return { date, kind, status, tldr: `TL;DR du brief ${kind} du ${date}.`, newsTitles };
}

// Paris today is 2026-11-21: days = 7 → since 2026-11-14, days = 1 → since 2026-11-20.
// Seeded out of date order, and the two kinds of one date in opposite orders (11-21: daily first,
// 11-14: weekly first), so neither the row id nor the seeding order can pass for the tie-break.
const TODAY_DAILY = seed("2026-11-21", "daily", ["Le CAC 40 ouvre en hausse", "Le pétrole se stabilise"]);
const WINDOW_START_WEEKLY = seed("2026-11-14", "weekly", ["La semaine en cinq points", "Les banques centrales en pause", "Le bitcoin rebondit"]);
const MIDWEEK_DAILY = seed("2026-11-18", "daily", ["Nvidia publie ses résultats"]);
const TODAY_WEEKLY = seed("2026-11-21", "weekly", ["Récapitulatif : une semaine de rebond", "Les taux longs reculent"]);
/** Inside the window only if "today" were taken in UTC (2026-11-20 → since 2026-11-13). */
const DAY_BEFORE_WINDOW_DAILY = seed("2026-11-13", "daily", ["Titre d'un brief hors de la fenêtre"]);
const WINDOW_START_DAILY = seed("2026-11-14", "daily", ["L'inflation américaine ralentit", "L'euro remonte face au dollar"]);
const OLD_WEEKLY = seed("2026-11-07", "weekly", ["Récapitulatif d'une semaine trop ancienne"]);
const DRAFT_DAILY = seed("2026-11-19", "daily", ["Titre d'un brouillon jamais publié"], "draft");
const YESTERDAY_DAILY = seed("2026-11-20", "daily", ["La BCE maintient ses taux", "Airbus relève ses objectifs", "Le Brent recule"]);

const SEEDS = [
  TODAY_DAILY,
  WINDOW_START_WEEKLY,
  MIDWEEK_DAILY,
  TODAY_WEEKLY,
  DAY_BEFORE_WINDOW_DAILY,
  WINDOW_START_DAILY,
  OLD_WEEKLY,
  DRAFT_DAILY,
  YESTERDAY_DAILY,
];

/** What days = 7 must return at PARIS_JUST_AFTER_MIDNIGHT, most recent first, weekly before daily. */
const LAST_7_DAYS = [TODAY_WEEKLY, TODAY_DAILY, YESTERDAY_DAILY, MIDWEEK_DAILY, WINDOW_START_WEEKLY, WINDOW_START_DAILY];

describe("C59 — get_recent_briefs returns the date, kind, TL;DR and news titles of each published brief, most recent first", () => {
  it("C59 — given the MCP endpoint, when Claude lists the tools, then get_recent_briefs is listed with an optional integer days argument from 1 to 30", async () => {
    const client = await connect();

    const { tools } = await client.listTools();

    const tool = tools.find((candidate) => candidate.name === "get_recent_briefs");
    expect(tool, `tools listed: ${tools.map((candidate) => candidate.name).join(", ") || "(none)"}`).toBeDefined();
    expect(tool?.description?.trim().length).toBeGreaterThan(0);
    const schema = tool?.inputSchema as {
      properties?: Record<string, { type?: string; minimum?: number; maximum?: number; default?: unknown }>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {})).toEqual(["days"]);
    expect(schema.required ?? []).not.toContain("days");
    expect(schema.properties?.days).toMatchObject({ type: "integer", minimum: 1, maximum: 30 });
    expect(tools.map((candidate) => candidate.name)).toContain("publish_brief");
  });

  it("C59 — given published briefs inside and outside the window, a draft, and it is 00:30 in Paris (23:30 UTC the day before), when I call get_recent_briefs(7), then I get the published briefs since Paris today − 7, most recent first and weekly before daily on the same date", async () => {
    await seedBriefs(databasePath, SEEDS);
    const client = await connect();

    const result = await getRecentBriefs(client, { days: 7 });

    expectSuccess(result);
    expect(structured(result)).toStrictEqual({ days: 7, since: "2026-11-14", briefs: LAST_7_DAYS.map(entry) });
  });

  it("C59 — given published briefs, when I call get_recent_briefs without days, then the window is the default 7 days", async () => {
    await seedBriefs(databasePath, SEEDS);
    const client = await connect();

    const result = await getRecentBriefs(client);

    expectSuccess(result);
    expect(structured(result)).toStrictEqual({ days: 7, since: "2026-11-14", briefs: LAST_7_DAYS.map(entry) });
  });

  it("C59 — given published briefs, when I call get_recent_briefs(1), then only the briefs of Paris today and yesterday come back", async () => {
    await seedBriefs(databasePath, SEEDS);
    const client = await connect();

    const result = await getRecentBriefs(client, { days: 1 });

    expectSuccess(result);
    expect(structured(result)).toStrictEqual({
      days: 1,
      since: "2026-11-20",
      briefs: [TODAY_WEEKLY, TODAY_DAILY, YESTERDAY_DAILY].map(entry),
    });
  });

  it("C59 — given published briefs, when I call get_recent_briefs(30), then the older published briefs come back too, still without the draft", async () => {
    await seedBriefs(databasePath, SEEDS);
    const client = await connect();

    const result = await getRecentBriefs(client, { days: 30 });

    expectSuccess(result);
    expect(structured(result)).toStrictEqual({
      days: 30,
      since: "2026-10-22",
      briefs: [...LAST_7_DAYS, DAY_BEFORE_WINDOW_DAILY, OLD_WEEKLY].map(entry),
    });
  });

  it("C59 — given a draft inside the window, when I call get_recent_briefs, then the draft is not returned", async () => {
    await seedBriefs(databasePath, [DRAFT_DAILY, MIDWEEK_DAILY]);
    const client = await connect();

    const result = await getRecentBriefs(client, { days: 7 });

    expectSuccess(result);
    expect(structured(result).briefs).toStrictEqual([entry(MIDWEEK_DAILY)]);
    expect(resultText(result)).not.toContain(DRAFT_DAILY.newsTitles[0]);
  });

  it("C59 — given published briefs, when I call get_recent_briefs, then the text for Claude names each brief's date and its news titles", async () => {
    await seedBriefs(databasePath, SEEDS);
    const client = await connect();

    const text = resultText(await getRecentBriefs(client, { days: 7 }));

    for (const brief of LAST_7_DAYS) {
      expect(text).toContain(brief.date);
      for (const title of brief.newsTitles) expect(text).toContain(title);
    }
    for (const outside of [DAY_BEFORE_WINDOW_DAILY, OLD_WEEKLY, DRAFT_DAILY]) {
      expect(text).not.toContain(outside.newsTitles[0]);
    }
  });

  it("C59 — given published briefs, when I call get_recent_briefs, then the answer holds no summary, explanation, source nor raw payload", async () => {
    await seedBriefs(databasePath, SEEDS);
    const client = await connect();

    const result = await getRecentBriefs(client, { days: 7 });

    expectSuccess(result);
    for (const brief of structured(result).briefs) expect(Object.keys(brief).sort()).toEqual(["date", "kind", "newsTitles", "tldr"]);
    const answer = JSON.stringify({ content: result.content, structuredContent: result.structuredContent });
    for (const detail of Object.values(SEEDED_NEWS_DETAILS)) expect(answer).not.toContain(detail);
    expect(answer).not.toMatch(/raw_?payload/i);
  });

  it("C59 — given published briefs, when I call get_recent_briefs, then nothing is written to the briefs", async () => {
    await seedBriefs(databasePath, SEEDS);
    const briefsBefore = readBriefs(databasePath);
    const newsBefore = readNewsItems(databasePath);
    const client = await connect();

    expectSuccess(await getRecentBriefs(client, { days: 7 }));

    expect(readBriefs(databasePath)).toEqual(briefsBefore);
    expect(readNewsItems(databasePath)).toEqual(newsBefore);
    expect(countBriefRows(databasePath).briefs).toBe(SEEDS.length);
  });

  it("C59 — given it is 23:59 in Paris (22:59 UTC), when I call get_recent_briefs(7), then today is still Paris's date and the window starts 7 days before it", async () => {
    vi.setSystemTime(new Date("2026-11-20T22:59:00Z"));
    // Nothing dated after Paris today (2026-11-20) here: future dates are not part of the contract.
    await seedBriefs(databasePath, [OLD_WEEKLY, YESTERDAY_DAILY, DAY_BEFORE_WINDOW_DAILY, WINDOW_START_DAILY, MIDWEEK_DAILY]);
    const client = await connect();

    const result = await getRecentBriefs(client, { days: 7 });

    expectSuccess(result);
    expect(structured(result)).toStrictEqual({
      days: 7,
      since: "2026-11-13",
      briefs: [YESTERDAY_DAILY, MIDWEEK_DAILY, WINDOW_START_DAILY, DAY_BEFORE_WINDOW_DAILY].map(entry),
    });
  });

  it("C59 — given it is 00:30 in Paris on the day after the switch to summer time (22:30 UTC), when I call get_recent_briefs(1), then the window starts on Paris yesterday, not the day before", async () => {
    // 2026-03-29 is the switch to CEST (UTC+2): 2026-03-29T22:30Z is 2026-03-30 00:30 in Paris.
    vi.setSystemTime(new Date("2026-03-29T22:30:00Z"));
    const beforeWindow = seed("2026-03-28", "weekly", ["Récapitulatif avant le changement d'heure"]);
    const yesterday = seed("2026-03-29", "daily", ["Brief du jour du changement d'heure"]);
    const today = seed("2026-03-30", "daily", ["Brief du lundi après le changement d'heure"]);
    await seedBriefs(databasePath, [beforeWindow, yesterday, today]);
    const client = await connect();

    const result = await getRecentBriefs(client, { days: 1 });

    expectSuccess(result);
    expect(structured(result)).toStrictEqual({ days: 1, since: "2026-03-29", briefs: [today, yesterday].map(entry) });
  });

  it("C59 — given a window across the new year, when I call get_recent_briefs(7), then since is the right date of the previous year", async () => {
    vi.setSystemTime(new Date("2027-01-02T09:00:00Z"));
    const lastYear = seed("2026-12-26", "weekly", ["Récapitulatif de Noël"]);
    const tooOld = seed("2026-12-25", "daily", ["Brief du jour de Noël"]);
    const newYear = seed("2027-01-02", "weekly", ["Récapitulatif du Nouvel An"]);
    await seedBriefs(databasePath, [tooOld, newYear, lastYear]);
    const client = await connect();

    const result = await getRecentBriefs(client, { days: 7 });

    expectSuccess(result);
    expect(structured(result)).toStrictEqual({ days: 7, since: "2026-12-26", briefs: [newYear, lastYear].map(entry) });
  });

  it.each([
    ["0", 0],
    ["31", 31],
    ["a decimal number (2.5)", 2.5],
    ["a negative number", -1],
    ['the string "7"', "7"],
  ] as const)("C59 — given days = %s, when I call get_recent_briefs, then it is an invalid-arguments error naming days", async (_label, days) => {
    const client = await connect();

    const result = await getRecentBriefs(client, { days });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(new RegExp(`(^|\\n)[\\s\\-*•]*${escapeRegExp("days")}\\s*:\\s*\\S`));
  });
});

describe("C60 — with no brief in the window, get_recent_briefs returns an empty list", () => {
  it("C60 — given no brief at all, when I call get_recent_briefs, then I receive an empty list, not an error, and the text says there is none", async () => {
    const client = await connect();

    const result = await getRecentBriefs(client);

    expectSuccess(result);
    expect(structured(result)).toStrictEqual({ days: 7, since: "2026-11-14", briefs: [] });
    expect(resultText(result)).toMatch(/aucun/i);
  });

  it("C60 — given published briefs that are all older than the window, when I call get_recent_briefs(7), then I receive an empty list", async () => {
    await seedBriefs(databasePath, [DAY_BEFORE_WINDOW_DAILY, OLD_WEEKLY]);
    const client = await connect();

    const result = await getRecentBriefs(client, { days: 7 });

    expectSuccess(result);
    expect(structured(result)).toStrictEqual({ days: 7, since: "2026-11-14", briefs: [] });
    expect(resultText(result)).toMatch(/aucun/i);
    expect(resultText(result)).not.toContain(DAY_BEFORE_WINDOW_DAILY.newsTitles[0]);
  });

  it("C60 — given only a draft in the window, when I call get_recent_briefs, then I receive an empty list", async () => {
    await seedBriefs(databasePath, [DRAFT_DAILY]);
    const client = await connect();

    const result = await getRecentBriefs(client, { days: 7 });

    expectSuccess(result);
    expect(structured(result).briefs).toStrictEqual([]);
  });
});
