// `get_watchlist(date?)` (CLAUDE.md §7, US #25): read tool of the Claude scheduled task. It says which
// watchlist stocks moved (day variation at or above the threshold, or results published the day before),
// so Claude writes a stock note only for those. The figures come from the app's own closes.
import { and, eq, inArray, lte } from "drizzle-orm";
import { parisToday, previousWeekday } from "@/lib/dates/paris";
import { getDb } from "@/lib/db/client";
import { instruments, pricesDaily } from "@/lib/db/schema";
import { formatClose } from "@/lib/market/format";
import { isStale } from "@/lib/market/latest";
import { computeVariations, type DatedClose } from "@/lib/market/snapshot";
import type { McpTool } from "../server";
import { optionalDate } from "./date-argument";

const DEFAULT_THRESHOLD = 2;

const inputSchema = {
  date: optionalDate(
    "Jour concerné (AAAA-MM-JJ) ; aujourd'hui (Europe/Paris) par défaut. Les cours postérieurs sont ignorés.",
  ),
};

type Reason = "move" | "earnings";

type WatchlistEntry = {
  symbol: string;
  name: string;
  type: string;
  currency: string;
  lastClose: number | null;
  lastCloseDate: string | null;
  stale: boolean;
  variations: { day: number | null; week: number | null };
  lastEarningsDate: string | null;
  moved: boolean;
  reasons: Reason[];
};

/** WATCHLIST_MOVE_THRESHOLD in percent: a positive finite number (decimal comma accepted), else the default 2. */
function moveThreshold(): number {
  const raw = process.env.WATCHLIST_MOVE_THRESHOLD?.trim();
  if (!raw) return DEFAULT_THRESHOLD;
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_THRESHOLD;
}

/** « +1,01 % », « -2,5 % » or « n/d » when the reference close is missing. */
function percent(value: number | null): string {
  if (value === null) return "n/d";
  const sign = value > 0 ? "+" : "";
  return `${sign}${String(value).replace(".", ",")} %`;
}

/** « 2026-11-19 » as « 19/11 ». */
function dayMonth(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

function describeEntry(entry: WatchlistEntry): string {
  const why: string[] = [];
  if (entry.reasons.includes("move")) why.push("variation du jour au-dessus du seuil");
  if (entry.reasons.includes("earnings") && entry.lastEarningsDate) why.push(`résultats publiés le ${dayMonth(entry.lastEarningsDate)}`);
  const verdict = entry.moved ? `a bougé (${why.join(", ")}).` : "n'a pas bougé.";
  const head = `- ${entry.name} (${entry.symbol}) : `;
  if (entry.lastClose === null) return `${head}Pas encore de cours ; ${verdict}`;
  const old = entry.stale ? " (cours ancien)" : "";
  const close = `clôture ${formatClose(entry.lastClose, entry.type, entry.currency)} au ${entry.lastCloseDate}${old} ; `;
  const { day, week } = entry.variations;
  return `${head}${close}1 jour ${percent(day)}, 1 semaine ${percent(week)} ; ${verdict}`;
}

export const getWatchlistTool: McpTool<typeof inputSchema> = {
  name: "get_watchlist",
  description:
    "Actions et ETF suivis dans la watchlist : pour chacun, la dernière clôture au plus tard à la date demandée " +
    "et les variations en % sur 1 jour et 1 semaine, calculées par l'app. `moved` vaut true quand la variation du " +
    "jour atteint le seuil `threshold` (en %, valeur absolue) ou que des résultats ont été publiés depuis la " +
    "séance précédente ; `reasons` donne `move` et/ou `earnings`. Si `lastEarningsDate` est vide, l'app ne connaît " +
    "pas la date des résultats : la vérifier par recherche web.",
  inputSchema,
  annotations: { readOnlyHint: true },
  handler({ date: asked }) {
    const date = asked ?? parisToday(new Date());
    const threshold = moveThreshold();
    const db = getDb();
    const watched = db
      .select()
      .from(instruments)
      .where(and(inArray(instruments.type, ["stock", "etf"]), eq(instruments.inWatchlist, true)))
      .all();
    // One query for every close of the watchlist symbols up to `date`, whatever their number.
    const closesBySymbol = new Map<string, DatedClose[]>();
    if (watched.length > 0) {
      for (const row of db
        .select({ symbol: pricesDaily.symbol, date: pricesDaily.date, close: pricesDaily.close })
        .from(pricesDaily)
        .where(
          and(
            inArray(
              pricesDaily.symbol,
              watched.map((instrument) => instrument.symbol),
            ),
            lte(pricesDaily.date, date),
          ),
        )
        .all()) {
        const closes = closesBySymbol.get(row.symbol) ?? [];
        closes.push({ date: row.date, close: row.close });
        closesBySymbol.set(row.symbol, closes);
      }
    }
    const earningsSince = previousWeekday(date);
    const stocks: WatchlistEntry[] = watched
      // Ordered in code, not by SQL: the database sorts capitals before lowercase letters.
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ symbol, name, type, currency, lastEarningsDate }) => {
        const { lastClose, lastCloseDate, variations } = computeVariations(closesBySymbol.get(symbol) ?? [], date);
        const reasons: Reason[] = [];
        if (variations.day !== null && Math.abs(variations.day) >= threshold) reasons.push("move");
        if (lastEarningsDate !== null && lastEarningsDate >= earningsSince && lastEarningsDate < date) reasons.push("earnings");
        return {
          symbol,
          name,
          type,
          currency,
          lastClose,
          lastCloseDate,
          stale: isStale(type, lastCloseDate, date),
          variations: { day: variations.day, week: variations.week },
          lastEarningsDate,
          moved: reasons.length > 0,
          reasons,
        };
      });
    const header =
      stocks.length === 0
        ? `Watchlist vide au ${date} : aucune valeur suivie.`
        : `Watchlist au ${date} : ${stocks.length} valeur(s), seuil de mouvement ${String(threshold).replace(".", ",")} %.`;
    return {
      content: [{ type: "text", text: [header, ...stocks.map(describeEntry)].join("\n") }],
      structuredContent: { date, threshold, stocks },
    };
  },
};
