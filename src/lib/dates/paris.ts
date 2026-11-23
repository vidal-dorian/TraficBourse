// Calendar dates in Europe/Paris, the app's reference time zone (briefs are dated in Paris),
// whatever the server's own time zone (the containers run in UTC).
//
// Dates are "YYYY-MM-DD" strings. Day arithmetic is done on UTC midnights, where every day lasts
// 24 hours, so a switch to or from summer time can never shift a date.

export const PARIS_TIME_ZONE = "Europe/Paris";

const parisDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: PARIS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date in Paris at `now`, "YYYY-MM-DD". */
export function parisToday(now: Date = new Date()): string {
  // `now` is always passed explicitly: Intl's own default clock may not be the one tests freeze.
  const parts = Object.fromEntries(parisDateFormat.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** `date` ("YYYY-MM-DD") minus `days` calendar days (a negative `days` goes forward). */
export function subtractDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}

const frenchDateFormat = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** `date` ("YYYY-MM-DD") written out in French, e.g. "vendredi 20 novembre 2026". */
export function formatFrenchDate(date: string): string {
  // A calendar date, not an instant: read and written at UTC midnight so no time zone shifts it.
  return frenchDateFormat.format(new Date(`${date}T00:00:00Z`));
}
