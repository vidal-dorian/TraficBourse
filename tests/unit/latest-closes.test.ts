// US #19 — the last known close of every instrument and whether it is stale (criterion 77).
import { describe, expect, it } from "vitest";
import { getLatestCloses } from "@/lib/market/latest";
import { openMigrated } from "../helpers/prices";

type Db = ReturnType<typeof openMigrated>["db"];

function put(sqlite: ReturnType<typeof openMigrated>["sqlite"], symbol: string, date: string, close: number) {
  sqlite.prepare("INSERT INTO prices_daily (symbol, date, close) VALUES (?, ?, ?)").run(symbol, date, close);
}

function entry(db: Db, now: string, symbol: string) {
  const found = getLatestCloses(db, new Date(now)).find((e) => e.symbol === symbol);
  expect(found, `${symbol} must be listed`).toBeDefined();
  return found!;
}

describe("criterion 77 — getLatestCloses", () => {
  it("given a database without prices, then every instrument is listed with null close and date and not stale", () => {
    const { db } = openMigrated();
    const all = getLatestCloses(db, new Date("2026-11-23T07:00:00Z"));
    expect(all).toHaveLength(9);
    expect(all.find((e) => e.symbol === "^FCHI")).toEqual({
      symbol: "^FCHI",
      name: "CAC 40",
      type: "index",
      currency: "EUR",
      close: null,
      date: null,
      stale: false,
    });
  });

  it("given several stored days, then the latest row is returned", () => {
    const { sqlite, db } = openMigrated();
    put(sqlite, "^FCHI", "2026-11-18", 7000);
    put(sqlite, "^FCHI", "2026-11-20", 7100.5);
    expect(entry(db, "2026-11-23T07:00:00Z", "^FCHI")).toMatchObject({ close: 7100.5, date: "2026-11-20", stale: false });
  });

  it("given a Monday, when the latest close is Friday, then a non-crypto is fresh; when it is Thursday, then stale", () => {
    const { sqlite, db } = openMigrated();
    put(sqlite, "^FCHI", "2026-11-20", 1);
    put(sqlite, "^GSPC", "2026-11-19", 1);
    expect(entry(db, "2026-11-23T07:00:00Z", "^FCHI").stale).toBe(false);
    expect(entry(db, "2026-11-23T07:00:00Z", "^GSPC")).toMatchObject({ stale: true, date: "2026-11-19" });
  });

  it("given a Saturday or a Sunday, when the latest close is Friday, then a non-crypto is fresh", () => {
    const { sqlite, db } = openMigrated();
    put(sqlite, "^FCHI", "2026-11-20", 1);
    expect(entry(db, "2026-11-21T10:00:00Z", "^FCHI").stale).toBe(false);
    expect(entry(db, "2026-11-22T10:00:00Z", "^FCHI").stale).toBe(false);
  });

  it("given a Tuesday, when the latest close is Friday, then it is stale; Monday's is fresh", () => {
    const { sqlite, db } = openMigrated();
    put(sqlite, "^FCHI", "2026-11-20", 1);
    put(sqlite, "^GSPC", "2026-11-23", 1);
    expect(entry(db, "2026-11-24T07:00:00Z", "^FCHI").stale).toBe(true);
    expect(entry(db, "2026-11-24T07:00:00Z", "^GSPC").stale).toBe(false);
  });

  it("given crypto, then the expected close is the day before Paris today, weekends included", () => {
    const { sqlite, db } = openMigrated();
    put(sqlite, "BTC-EUR", "2026-11-22", 1);
    expect(entry(db, "2026-11-23T07:00:00Z", "BTC-EUR").stale).toBe(false);
    expect(entry(db, "2026-11-24T07:00:00Z", "BTC-EUR").stale).toBe(true);
    // Friday's close on a Monday is stale for crypto, fresh for an index.
    const other = openMigrated();
    put(other.sqlite, "BTC-EUR", "2026-11-20", 1);
    expect(entry(other.db, "2026-11-23T07:00:00Z", "BTC-EUR").stale).toBe(true);
  });

  it("given the Paris day differs from the UTC day, then Paris today is used", () => {
    const { sqlite, db } = openMigrated();
    // 23:30Z on Sunday is already Monday 00:30 in Paris: Friday is the expected close.
    put(sqlite, "^FCHI", "2026-11-20", 1);
    expect(entry(db, "2026-11-22T23:30:00Z", "^FCHI").stale).toBe(false);
  });
});
