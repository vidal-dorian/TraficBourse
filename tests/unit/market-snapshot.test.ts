// US #20 — criterion 80: the variations are computed from fixed closes (unit tests).
//
// Contract of `computeVariations(closes, date)` in `src/lib/market/snapshot.ts` (pure, no database):
// - `closes`: `{ date: "YYYY-MM-DD", close: number }[]` of ONE instrument, in any order. Closes dated
//   after `date` are ignored. `lastClose` / `lastCloseDate` = the latest close on or before `date`.
// - Result: `{ lastClose, lastCloseDate, variations: { day, week, month, ytd } }`, each variation a
//   percentage `(lastClose / reference - 1) * 100` ROUNDED to 2 decimals (e.g. 1.01 means +1.01 %),
//   or null when the reference close does not exist (or is 0).
// - day: reference = the stored close just before `lastCloseDate` (previous stored close, not previous calendar day).
// - week: reference = last close on or before `lastCloseDate` minus 7 calendar days.
// - month: reference = last close on or before `lastCloseDate` minus 1 calendar month (day clamped to the
//   end of the shorter month: 31 March -> 28 February).
// - ytd: reference = last close on or before 31 December of the year before `lastCloseDate`.
// - No close at all on or before `date`: lastClose, lastCloseDate and the four variations are null.
import { describe, expect, it } from "vitest";
import { computeVariations } from "@/lib/market/snapshot";

const NONE = { day: null, week: null, month: null, ytd: null };

// Asked on Friday 2026-11-20.
const FIXTURE = [
  { date: "2025-12-30", close: 100 },
  { date: "2025-12-31", close: 200 }, // YTD reference
  { date: "2026-01-02", close: 210 },
  { date: "2026-10-19", close: 240 }, // 1M reference (target 2026-10-20 is a Tuesday with no close)
  { date: "2026-10-21", close: 280 }, // after the 1M target: must not be used
  { date: "2026-11-13", close: 270 }, // 1W reference (exactly 7 days before)
  { date: "2026-11-19", close: 297 }, // 1D reference
  { date: "2026-11-20", close: 300 },
  { date: "2026-11-23", close: 999 }, // after the asked date: ignored
];

describe("criterion 80 — computeVariations on fixed closes", () => {
  it("given fixed closes, when computing for Friday 2026-11-20, then last close and the 1D, 1W, 1M and YTD variations are the expected percentages", () => {
    expect(computeVariations(FIXTURE, "2026-11-20")).toEqual({
      lastClose: 300,
      lastCloseDate: "2026-11-20",
      variations: { day: 1.01, week: 11.11, month: 25, ytd: 50 },
    });
  });

  it("given closes in any order, when computing, then the result is the same", () => {
    const shuffled = [...FIXTURE].reverse();
    expect(computeVariations(shuffled, "2026-11-20")).toEqual(computeVariations(FIXTURE, "2026-11-20"));
  });

  it("given a date later than the last close, when computing, then the last close on or before it is used, with its own date", () => {
    const result = computeVariations(FIXTURE, "2026-11-22");
    expect(result.lastCloseDate).toBe("2026-11-20");
    expect(result.lastClose).toBe(300);
    expect(result.variations).toEqual({ day: 1.01, week: 11.11, month: 25, ytd: 50 });
  });

  it("given a fall, when computing, then the variation is negative and rounded to 2 decimals", () => {
    const result = computeVariations(
      [
        { date: "2026-11-13", close: 7 },
        { date: "2026-11-20", close: 3 },
      ],
      "2026-11-20",
    );
    expect(result.variations.week).toBe(-57.14);
    expect(result.variations.day).toBe(-57.14);
  });

  it("given the 1W target falls on a day without close, when computing, then the last close before it is the reference", () => {
    // Monday 2026-11-23 - 7 days = Monday 2026-11-16: no close, so Friday 2026-11-13 is used.
    const result = computeVariations(
      [
        { date: "2026-11-13", close: 100 },
        { date: "2026-11-23", close: 110 },
      ],
      "2026-11-23",
    );
    expect(result.variations.week).toBe(10);
    expect(result.variations.day).toBe(10);
  });

  it("given the last close is 31 March, when computing, then the 1M reference is on or before 28 February, not 3 March", () => {
    const result = computeVariations(
      [
        { date: "2026-02-27", close: 100 },
        { date: "2026-03-02", close: 105 },
        { date: "2026-03-31", close: 110 },
      ],
      "2026-03-31",
    );
    expect(result.variations.month).toBe(10);
  });

  it("given the last close is in January, when computing, then YTD is against the last close of the previous December", () => {
    const result = computeVariations(
      [
        { date: "2025-12-30", close: 90 },
        { date: "2025-12-31", close: 100 },
        { date: "2026-01-05", close: 103 },
      ],
      "2026-01-05",
    );
    expect(result.variations.ytd).toBe(3);
  });

  it("given the last close is old, when computing for a much later date, then its date is reported and variations are relative to it", () => {
    const result = computeVariations(
      [
        { date: "2026-11-09", close: 100 },
        { date: "2026-11-10", close: 102 },
      ],
      "2026-11-23",
    );
    expect(result.lastCloseDate).toBe("2026-11-10");
    expect(result.variations.day).toBe(2);
  });

  it("given the history starts after a reference, when computing, then that variation is null and the others are kept", () => {
    const result = computeVariations(
      [
        { date: "2026-11-19", close: 297 },
        { date: "2026-11-20", close: 300 },
      ],
      "2026-11-20",
    );
    expect(result).toEqual({
      lastClose: 300,
      lastCloseDate: "2026-11-20",
      variations: { day: 1.01, week: null, month: null, ytd: null },
    });
  });

  it("given a single close, when computing, then there is a last close and every variation is null", () => {
    expect(computeVariations([{ date: "2026-11-20", close: 300 }], "2026-11-20")).toEqual({
      lastClose: 300,
      lastCloseDate: "2026-11-20",
      variations: NONE,
    });
  });

  it("given no close on or before the date, when computing, then last close, its date and every variation are null", () => {
    const expected = { lastClose: null, lastCloseDate: null, variations: NONE };
    expect(computeVariations([], "2026-11-20")).toEqual(expected);
    expect(computeVariations([{ date: "2026-11-21", close: 1 }], "2026-11-20")).toEqual(expected);
  });
});
