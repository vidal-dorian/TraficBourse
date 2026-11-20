// US #14 — `listRecentBriefs` called directly (the MCP tool is covered by
// tests/mcp-get-recent-briefs.test.ts): window bounds, ordering tie-break and query count.
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishBrief } from "../../src/lib/briefs/publish";
import { listRecentBriefs } from "../../src/lib/briefs/recent";
import { openDatabase, type Db } from "../../src/lib/db/client";
import * as schema from "../../src/lib/db/schema";
import { BriefPayload } from "../../src/lib/schemas/brief";
import { makeMigratedDatabase } from "../helpers/mcp";

let sqlite: Database.Database;
let db: Db;
let queries: string[];

beforeEach(() => {
  sqlite = openDatabase(makeMigratedDatabase());
  queries = [];
  db = drizzle(sqlite, { schema, logger: { logQuery: (query) => queries.push(query) } });
});

afterEach(() => {
  sqlite.close();
});

function publish(date: string, kind: "daily" | "weekly", titles: string[]): void {
  const raw = {
    tldr: `TL;DR ${kind} ${date}`,
    mood: "mitige",
    news: titles.map((title) => ({
      title,
      summary: "Résumé.",
      whyItMatters: "Pourquoi c'est important.",
      impact: "Impact.",
      category: "macro",
      sourceName: "Source",
      sourceUrl: "https://example.com/article",
    })),
  };
  publishBrief(db, { date, kind, payload: BriefPayload.parse(raw), rawPayload: JSON.stringify(raw) });
}

describe("listRecentBriefs", () => {
  it("returns nothing, with a single query, when no brief is published", () => {
    expect(listRecentBriefs(db, { since: "2026-11-14", until: "2026-11-21" })).toEqual([]);
    expect(queries).toHaveLength(1);
  });

  it("includes the brief dated exactly `since` and excludes the day before", () => {
    publish("2026-11-13", "daily", ["Trop ancien"]);
    publish("2026-11-14", "daily", ["En bord de fenêtre"]);

    expect(listRecentBriefs(db, { since: "2026-11-14", until: "2026-11-21" }).map((brief) => brief.date)).toEqual(["2026-11-14"]);
  });

  it("includes the brief dated exactly `until` and excludes the day after and far-future dates", () => {
    publish("2026-11-20", "daily", ["Aujourd'hui"]);
    publish("2026-11-21", "daily", ["Demain"]);
    publish("2099-05-05", "weekly", ["Futur lointain"]);
    publish("9999-12-31", "daily", ["Dernière date possible"]);

    expect(listRecentBriefs(db, { since: "2026-11-14", until: "2026-11-20" }).map((brief) => brief.date)).toEqual([
      "2026-11-20",
    ]);
  });

  it("orders by date descending, weekly before daily on the same date, whatever the insertion order", () => {
    publish("2026-11-20", "weekly", ["W20"]);
    publish("2026-11-20", "daily", ["D20"]);
    publish("2026-11-21", "daily", ["D21"]);
    publish("2026-11-21", "weekly", ["W21"]);

    expect(listRecentBriefs(db, { since: "2026-11-01", until: "2026-11-21" }).map(({ date, kind }) => `${date} ${kind}`)).toEqual([
      "2026-11-21 weekly",
      "2026-11-21 daily",
      "2026-11-20 weekly",
      "2026-11-20 daily",
    ]);
  });

  it("reads the news titles of every brief in rank order with two queries in total", () => {
    publish("2026-11-18", "daily", ["A1", "A2", "A3"]);
    publish("2026-11-19", "daily", ["B1"]);
    publish("2026-11-20", "daily", ["C1", "C2"]);
    queries = [];

    const recent = listRecentBriefs(db, { since: "2026-11-14", until: "2026-11-21" });

    expect(recent.map((brief) => brief.newsTitles)).toEqual([["C1", "C2"], ["B1"], ["A1", "A2", "A3"]]);
    expect(queries).toHaveLength(2);
  });

  it("reflects a republication: the replaced news titles only", () => {
    publish("2026-11-20", "daily", ["Ancien titre"]);
    publish("2026-11-20", "daily", ["Nouveau titre"]);

    expect(listRecentBriefs(db, { since: "2026-11-14", until: "2026-11-21" })).toEqual([
      { date: "2026-11-20", kind: "daily", tldr: "TL;DR daily 2026-11-20", newsTitles: ["Nouveau titre"] },
    ]);
  });
});
