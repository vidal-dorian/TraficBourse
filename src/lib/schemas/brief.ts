// Shared Zod contract of a brief (CLAUDE.md §7): what the Claude scheduled task sends through
// `publish_brief`. One schema for the MCP tool, server code and (later) forms.
//
// Objects are strict: a key the app does not handle yet (concept, storylineUpdates: later
// tickets) is an error, so Claude learns it in the dry run instead of having it
// silently dropped. Text fields are Markdown, stored as received and rendered sanitized.
//
// Every leaf is bounded (length, number of items), so one call cannot store megabytes of text in
// `raw_payload` and `news_items`: the transport's 4 MiB body cap is not a content limit.
import { z } from "zod";
import { BRIEF_KINDS, CATEGORIES, CHART_RANGES, MOODS, STOCK_NOTE_REASONS } from "./brief-enums";

export { BRIEF_KINDS, CATEGORIES, CHART_RANGES, MOODS, STOCK_NOTE_REASONS };

/** A required text: not blank, at most `max` characters. */
function requiredText(max: number) {
  return z.string().regex(/\S/, "Ce champ ne doit pas être vide.").max(max);
}

/** Publication date, "YYYY-MM-DD", a real calendar date (Feb 30 is rejected). */
export const BriefDate = z.iso.date("Date attendue au format AAAA-MM-JJ, et qui existe au calendrier.");

export const BriefKind = z.enum(BRIEF_KINDS);
export type BriefKind = z.infer<typeof BriefKind>;

export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

export const Mood = z.enum(MOODS);
export type Mood = z.infer<typeof Mood>;

/**
 * Absolute http(s) URL only: it is rendered as a link (no javascript:, data:, ftp:, relative).
 * No user info either: `https://reuters.com@evil.example` reads like Reuters but opens another host.
 */
const SourceUrl = z
  .url({ protocol: /^https?$/, error: "URL absolue en http ou https attendue." })
  .max(2048, "URL trop longue : 2048 caractères au plus.")
  .refine((value) => {
    // Zod runs this check even when the URL check above failed: leave that case to its message.
    if (!URL.canParse(value)) return true;
    const url = new URL(value);
    return url.username === "" && url.password === "";
  },"URL sans identifiant attendue (rien avant « @ » dans l'adresse).");

/** A ticker as the market-data provider spells it: "^FCHI", "EURUSD=X", "BTC-EUR", "MC.PA". */
const Ticker = z
  .string()
  .regex(/^[A-Za-z0-9.^=-]{1,20}$/, "Symbole attendu : 1 à 20 caractères parmi lettres, chiffres et . ^ = -");

/**
 * A chart under a news item: which instruments, over which range. Claude never sends values, the
 * app draws the closes of `prices_daily`. Symbols are checked against `instruments` by `publish_brief`.
 */
export const ChartSpec = z.strictObject({
  type: z.literal("price"),
  symbols: z
    .array(Ticker)
    .min(1)
    .max(3)
    .refine((symbols) => new Set(symbols).size === symbols.length, "Chaque symbole ne doit apparaître qu'une fois."),
  range: z.enum(CHART_RANGES),
  normalize: z.boolean().default(false),
});
export type ChartSpec = z.infer<typeof ChartSpec>;

export const NewsItem = z.strictObject({
  title: requiredText(120),
  summary: requiredText(600),
  whyItMatters: requiredText(400),
  impact: requiredText(300),
  category: Category,
  tickers: z.array(Ticker).max(10).default([]),
  sourceName: requiredText(120),
  sourceUrl: SourceUrl,
  chart: ChartSpec.optional(),
});
export type NewsItem = z.infer<typeof NewsItem>;

export const StockNoteReason = z.enum(STOCK_NOTE_REASONS);
export type StockNoteReason = z.infer<typeof StockNoteReason>;

/**
 * A note on a watchlist stock (« Ma watchlist »). The symbol is checked against the watchlist
 * (`instruments.in_watchlist`) by `publish_brief`; the numbers shown with the note are the app's.
 */
export const StockNote = z.strictObject({
  symbol: Ticker,
  reason: StockNoteReason,
  summary: requiredText(600),
  newsRefs: z.array(SourceUrl).max(5).default([]),
  nextEvent: requiredText(200).optional(),
});
export type StockNote = z.infer<typeof StockNote>;

export const BriefPayload = z.strictObject({
  tldr: requiredText(400),
  mood: Mood,
  news: z.array(NewsItem).min(1).max(5),
  stockNotes: z.array(StockNote).max(50).default([]),
});
export type BriefPayload = z.infer<typeof BriefPayload>;
