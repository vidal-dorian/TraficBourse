// US #14 — Paris calendar dates and day arithmetic on "YYYY-MM-DD" strings, used by
// get_recent_briefs to compute its window whatever the server's time zone. US #16 — the French
// month headings of the archives page.
import { describe, expect, it } from "vitest";
import { formatFrenchMonth, parisToday, subtractDays } from "../../src/lib/dates/paris";

describe("parisToday", () => {
  it.each([
    ["winter, before midnight in Paris (UTC+1)", "2026-11-20T22:59:59Z", "2026-11-20"],
    ["winter, midnight in Paris while still the day before in UTC", "2026-11-20T23:00:00Z", "2026-11-21"],
    ["summer, midnight in Paris (UTC+2)", "2026-07-14T22:00:00Z", "2026-07-15"],
    ["summer, just before midnight in Paris", "2026-07-14T21:59:59Z", "2026-07-14"],
    ["the night of the switch to summer time", "2026-03-29T01:30:00Z", "2026-03-29"],
    ["the night of the switch back to winter time", "2026-10-24T22:30:00Z", "2026-10-25"],
    ["new year's eve in UTC, new year in Paris", "2026-12-31T23:30:00Z", "2027-01-01"],
  ])("%s: %s is %s in Paris", (_label, instant, expected) => {
    expect(parisToday(new Date(instant))).toBe(expected);
  });
});

describe("subtractDays", () => {
  it.each([
    ["2026-11-21", 7, "2026-11-14"],
    ["2026-11-21", 0, "2026-11-21"],
    ["2026-03-30", 1, "2026-03-29"],
    ["2026-04-01", 7, "2026-03-25"],
    ["2026-10-26", 1, "2026-10-25"],
    ["2026-11-01", 3, "2026-10-29"],
    ["2027-01-02", 7, "2026-12-26"],
    ["2028-03-01", 1, "2028-02-29"],
    ["2027-03-01", 1, "2027-02-28"],
    ["2026-11-21", 30, "2026-10-22"],
    ["2026-11-21", -10, "2026-12-01"],
  ])("%s minus %i days is %s", (date, days, expected) => {
    expect(subtractDays(date, days)).toBe(expected);
  });
});

describe("formatFrenchMonth", () => {
  it.each([
    ["2026-11-01", "novembre 2026"],
    ["2026-11-30", "novembre 2026"],
    ["2026-01-01", "janvier 2026"],
    ["2025-12-31", "décembre 2025"],
    ["2026-08-01", "août 2026"],
  ])("%s is in %s", (date, expected) => {
    expect(formatFrenchMonth(date)).toBe(expected);
  });
});
