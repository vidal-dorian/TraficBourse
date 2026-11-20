// Shared Zod contract of a brief (CLAUDE.md §7): what the Claude scheduled task sends through
// `publish_brief`. One schema for the MCP tool, server code and (later) forms.
//
// Objects are strict: a key the app does not handle yet (stockNotes, concept, storylineUpdates,
// chart: later tickets) is an error, so Claude learns it in the dry run instead of having it
// silently dropped. Text fields are Markdown, stored as received and rendered sanitized.
import { z } from "zod";
import { BRIEF_KINDS, CATEGORIES, MOODS } from "./brief-enums";

export { BRIEF_KINDS, CATEGORIES, MOODS };

/** A required text: not blank, at most `max` characters when given. */
function requiredText(max?: number) {
  const text = z.string().regex(/\S/, "Ce champ ne doit pas être vide.");
  return max === undefined ? text : text.max(max);
}

/** Publication date, "YYYY-MM-DD", a real calendar date (Feb 30 is rejected). */
export const BriefDate = z.iso.date("Date attendue au format AAAA-MM-JJ, et qui existe au calendrier.");

export const BriefKind = z.enum(BRIEF_KINDS);
export type BriefKind = z.infer<typeof BriefKind>;

export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

export const Mood = z.enum(MOODS);
export type Mood = z.infer<typeof Mood>;

/** Absolute http(s) URL only: it is rendered as a link (no javascript:, data:, ftp:, relative). */
const SourceUrl = z.url({
  protocol: /^https?$/,
  error: "URL absolue en http ou https attendue.",
});

export const NewsItem = z.strictObject({
  title: requiredText(120),
  summary: requiredText(600),
  whyItMatters: requiredText(400),
  impact: requiredText(300),
  category: Category,
  tickers: z.array(z.string()).default([]),
  sourceName: requiredText(),
  sourceUrl: SourceUrl,
});
export type NewsItem = z.infer<typeof NewsItem>;

export const BriefPayload = z.strictObject({
  tldr: requiredText(400),
  mood: Mood,
  news: z.array(NewsItem).min(1).max(5),
});
export type BriefPayload = z.infer<typeof BriefPayload>;
