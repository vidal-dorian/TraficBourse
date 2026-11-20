// US #13 — `publishBrief` called directly (the MCP tool is covered by tests/mcp-publish-brief.test.ts):
// replacement in place and rollback on a failing write.
import type Database from "better-sqlite3";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishBrief } from "../../src/lib/briefs/publish";
import { openDatabase, type Db } from "../../src/lib/db/client";
import * as schema from "../../src/lib/db/schema";
import { BriefDate, BriefPayload } from "../../src/lib/schemas/brief";
import { otherValidPayload, validPayload, type JsonObject } from "../fixtures/brief-payloads";
import { makeMigratedDatabase } from "../helpers/mcp";

let sqlite: Database.Database;
let db: Db;

beforeEach(() => {
  sqlite = openDatabase(makeMigratedDatabase());
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
});

function input(raw: JsonObject, publishedAt: Date) {
  return { date: "2026-11-20", kind: "daily" as const, payload: BriefPayload.parse(raw), rawPayload: JSON.stringify(raw), publishedAt };
}

function readAll() {
  return {
    briefs: db.select().from(schema.briefs).all(),
    news: db.select().from(schema.newsItems).orderBy(asc(schema.newsItems.rank)).all(),
  };
}

describe("publishBrief", () => {
  it("stores the brief as published with ranked news items and the given publication time", () => {
    const publishedAt = new Date("2026-11-20T06:05:00Z");

    const result = publishBrief(db, input(validPayload(), publishedAt));

    const { briefs, news } = readAll();
    expect(briefs).toEqual([
      expect.objectContaining({ id: result.briefId, status: "published", publishedAt, kind: "daily", mood: "mitige" }),
    ]);
    expect(result.newsCount).toBe(3);
    expect(news.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(news[2].tickers).toEqual([]);
  });

  it("updates the same row and replaces the news items on republication", () => {
    const first = publishBrief(db, input(validPayload(), new Date("2026-11-20T06:05:00Z")));
    const later = new Date("2026-11-20T06:40:00Z");

    const second = publishBrief(db, input(otherValidPayload(), later));

    const { briefs, news } = readAll();
    expect(second.briefId).toBe(first.briefId);
    expect(briefs).toHaveLength(1);
    expect(briefs[0]).toMatchObject({ mood: "aversion_risque", publishedAt: later });
    expect(news.map((item) => [item.briefId, item.rank])).toEqual([
      [first.briefId, 1],
      [first.briefId, 2],
    ]);
  });

  it("rolls everything back when a news item insert fails", () => {
    publishBrief(db, input(validPayload(), new Date("2026-11-20T06:05:00Z")));
    const before = readAll();
    sqlite.exec(`
      CREATE TRIGGER fail_insert BEFORE INSERT ON news_items WHEN NEW.title = 'boom'
      BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `);
    const failing = otherValidPayload();
    (failing.news as JsonObject[])[1].title = "boom";

    expect(() => publishBrief(db, input(failing, new Date("2026-11-20T06:40:00Z")))).toThrow("boom");

    expect(readAll()).toEqual(before);
  });
});

describe("BriefDate", () => {
  it.each(["2026-11-20", "2028-02-29", "2026-12-31"])("accepts %s", (date) => {
    expect(BriefDate.safeParse(date).success).toBe(true);
  });

  it.each(["2026-02-29", "2026-04-31", "2026-00-10", "2026-1-5", " 2026-11-20"])("rejects %s", (date) => {
    expect(BriefDate.safeParse(date).success).toBe(false);
  });
});
