// `get_market_snapshot(date?)` (CLAUDE.md §7, US #20): read tool of the Claude scheduled task. The
// variations are computed by the app from its own closes, so Claude quotes the same figures as the
// charts and never states a market number of its own.
import { lte } from "drizzle-orm";
import { z } from "zod";
import { parisToday } from "@/lib/dates/paris";
import { getDb } from "@/lib/db/client";
import { instruments, pricesDaily } from "@/lib/db/schema";
import { isStale } from "@/lib/market/latest";
import { computeVariations, type DatedClose, type Variations } from "@/lib/market/snapshot";
import type { McpTool } from "../server";

const DATE_MESSAGE = "Date attendue au format AAAA-MM-JJ, un jour réel du calendrier.";

/** "YYYY-MM-DD" naming a real calendar day (2026-02-30 is refused). */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const inputSchema = {
  date: z
    .string(DATE_MESSAGE)
    .refine(isRealDate, DATE_MESSAGE)
    .optional()
    .describe("Jour de l'instantané (AAAA-MM-JJ) ; aujourd'hui (Europe/Paris) par défaut. Les cours postérieurs sont ignorés."),
};

type SnapshotEntry = {
  symbol: string;
  name: string;
  type: string;
  currency: string;
  lastClose: number | null;
  lastCloseDate: string | null;
  stale: boolean;
  variations: Variations;
};

/** « +1,01 % », « -2,5 % » or « n/d » when the reference close is missing. */
function percent(value: number | null): string {
  if (value === null) return "n/d";
  const sign = value > 0 ? "+" : "";
  return `${sign}${String(value).replace(".", ",")} %`;
}

function describeEntry(entry: SnapshotEntry): string {
  if (entry.lastClose === null) return `- ${entry.name} (${entry.symbol}) : Pas encore de cours.`;
  const { day, week, month, ytd } = entry.variations;
  const old = entry.stale ? " (cours ancien)" : "";
  return (
    `- ${entry.name} (${entry.symbol}) : clôture ${entry.lastClose} ${entry.currency} au ${entry.lastCloseDate}${old} ; ` +
    `1 jour ${percent(day)}, 1 semaine ${percent(week)}, 1 mois ${percent(month)}, depuis janvier ${percent(ytd)}.`
  );
}

export const getMarketSnapshotTool: McpTool<typeof inputSchema> = {
  name: "get_market_snapshot",
  description:
    "Instantané des marchés calculé par l'app : pour chaque instrument, la dernière clôture au plus tard à la date " +
    "demandée (avec sa date) et les variations en % sur 1 jour, 1 semaine, 1 mois et depuis janvier. Ces chiffres " +
    "sont les seuls chiffres de marché à citer. `stale` signale un dernier cours plus ancien que la dernière " +
    "séance terminée.",
  inputSchema,
  annotations: { readOnlyHint: true },
  handler({ date: asked }) {
    const date = asked ?? parisToday(new Date());
    const db = getDb();
    // Two queries whatever the number of instruments: the instruments, then every close up to `date`.
    const closesBySymbol = new Map<string, DatedClose[]>();
    for (const row of db
      .select({ symbol: pricesDaily.symbol, date: pricesDaily.date, close: pricesDaily.close })
      .from(pricesDaily)
      .where(lte(pricesDaily.date, date))
      .all()) {
      const closes = closesBySymbol.get(row.symbol) ?? [];
      closes.push({ date: row.date, close: row.close });
      closesBySymbol.set(row.symbol, closes);
    }
    const entries: SnapshotEntry[] = db
      .select()
      .from(instruments)
      .all()
      // Ordered in code, not by SQL: the database sorts capitals before lowercase letters.
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ symbol, name, type, currency }) => {
        const { lastClose, lastCloseDate, variations } = computeVariations(closesBySymbol.get(symbol) ?? [], date);
        return { symbol, name, type, currency, lastClose, lastCloseDate, stale: isStale(type, lastCloseDate, date), variations };
      });
    const text = [`Instantané des marchés au ${date} : ${entries.length} instruments.`, ...entries.map(describeEntry)].join("\n");
    return {
      content: [{ type: "text", text }],
      structuredContent: { date, instruments: entries },
    };
  },
};
