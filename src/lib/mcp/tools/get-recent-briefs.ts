// `get_recent_briefs(days = 7)` (CLAUDE.md §7): read tool of the Claude scheduled task, which
// rereads the TL;DRs and news titles of the last days so as not to repeat the same news.
//
// The window is counted in calendar days back from today in Europe/Paris, today included:
// briefs dated on or after `since` = today − `days` come back. An empty window is not an error.
import { z } from "zod";
import { listRecentBriefs, type RecentBrief } from "@/lib/briefs/recent";
import { parisToday, subtractDays } from "@/lib/dates/paris";
import { getDb } from "@/lib/db/client";
import type { McpTool } from "../server";

export const DEFAULT_RECENT_DAYS = 7;
export const MAX_RECENT_DAYS = 30;

const DAYS_MESSAGE = `Nombre entier de jours attendu, de 1 à ${MAX_RECENT_DAYS}.`;

const inputSchema = {
  days: z
    .int(DAYS_MESSAGE)
    .min(1, DAYS_MESSAGE)
    .max(MAX_RECENT_DAYS, DAYS_MESSAGE)
    .default(DEFAULT_RECENT_DAYS)
    .describe(`Nombre de jours relus avant aujourd'hui (Europe/Paris), aujourd'hui inclus ; ${DEFAULT_RECENT_DAYS} par défaut.`),
};

/** "1 brief publié", "3 briefs publiés". */
function briefLabel(count: number): string {
  return count === 1 ? "1 brief publié" : `${count} briefs publiés`;
}

/** One brief: its date, kind and TL;DR, then one line per news title. */
function describeBrief({ date, kind, tldr, newsTitles }: RecentBrief): string {
  return [`- ${date} (${kind}) : ${tldr}`, ...newsTitles.map((title) => `  • ${title}`)].join("\n");
}

export const getRecentBriefsTool: McpTool<typeof inputSchema> = {
  name: "get_recent_briefs",
  description:
    "Relit les briefs publiés ces derniers jours (date, type, TL;DR et titres des actualités), du plus récent " +
    "au plus ancien, pour ne pas répéter les mêmes actualités. La fenêtre compte en jours calendaires depuis " +
    "aujourd'hui (Europe/Paris), aujourd'hui inclus.",
  inputSchema,
  handler({ days }) {
    const since = subtractDays(parisToday(new Date()), days);
    const recent = listRecentBriefs(getDb(), since);
    const window = `depuis le ${since} (${days} ${days === 1 ? "dernier jour" : "derniers jours"})`;
    const text =
      recent.length === 0
        ? `Aucun brief publié ${window}.`
        : `${briefLabel(recent.length)} ${window}, du plus récent au plus ancien :\n${recent.map(describeBrief).join("\n")}`;
    return {
      content: [{ type: "text", text }],
      structuredContent: { days, since, briefs: recent },
    };
  },
};
