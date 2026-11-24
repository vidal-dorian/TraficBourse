import type { Metadata } from "next";
import Link from "next/link";
import { parisToday } from "@/lib/dates/paris";
import { getDb } from "@/lib/db/client";
import type { StoredChartSpec } from "@/lib/db/schema";
import { loadChartData } from "@/lib/market/chart";
import { formatClose, sinceMention } from "@/lib/market/format";
import { getMarketOverview } from "@/lib/market/overview";
import { ChartFigure } from "@/lib/render/brief";
import { variationLabel } from "@/lib/render/market-tiles";

// Read at each request: a new close shows up without a rebuild.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Marchés — Veille boursière" };

type Range = StoredChartSpec["range"];

/** The ranges offered for the chart of an instrument, in display order (`plage` of the URL). */
const RANGES: { plage: Range; label: string }[] = [
  { plage: "1M", label: "1M" },
  { plage: "3M", label: "3M" },
  { plage: "YTD", label: "Depuis janvier" },
  { plage: "1Y", label: "1 an" },
];

/** The first value of a query parameter, or undefined. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function marketsHref(symbol: string, plage?: Range): string {
  return `/marches?instrument=${encodeURIComponent(symbol)}${plage ? `&plage=${plage}` : ""}`;
}

const VARIATION_LABELS = [
  ["1 j", "day"],
  ["1 sem", "week"],
  ["1 mois", "month"],
  ["depuis janvier", "ytd"],
] as const;

/**
 * Markets: every tracked instrument with its last close and its variations (US #19, #23); selecting one
 * shows its chart over 1M, 3M, since January or 1 year.
 */
export default async function MarketsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const db = getDb();
  const today = parisToday(new Date());
  const entries = getMarketOverview(db, today);

  // Only a symbol of the database and a range of the list are accepted: anything else is ignored.
  const selected = entries.find((entry) => entry.symbol === first(query.instrument));
  const plage = RANGES.find((range) => range.plage === first(query.plage))?.plage ?? "1M";
  const chart = selected ? loadChartData(db, { type: "price", symbols: [selected.symbol], range: plage, normalize: false }, today) : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Marchés</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Dernier cours de clôture connu, avec ses variations ; la date est indiquée quand il n&apos;est pas celui de la dernière séance. Choisissez un instrument pour voir son graphique.
      </p>
      <ul className="mt-6 divide-y divide-neutral-200">
        {entries.map((entry) => (
          <li key={entry.symbol} aria-current={entry.symbol === selected?.symbol ? "true" : undefined} className="py-3">
            <div className="flex items-baseline justify-between gap-4">
              <Link href={marketsHref(entry.symbol)} className="font-medium underline-offset-2 hover:underline">
                {entry.name}
              </Link>
              {entry.close === null || entry.date === null ? (
                <span className="text-neutral-500">Pas encore de cours</span>
              ) : (
                <span className="text-right">
                  {formatClose(entry.close, entry.type, entry.currency)}
                  {entry.stale ? (
                    <>
                      {" "}
                      <span className="ml-1 text-sm text-neutral-500">{sinceMention(entry.date)}</span>
                    </>
                  ) : null}
                </span>
              )}
            </div>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {VARIATION_LABELS.map(([label, key]) => {
                const variation = variationLabel(entry.variations[key]);
                return (
                  <span key={key}>
                    <span className="text-neutral-500">{label}</span> <span className={`font-semibold ${variation.className}`}>{variation.text}</span>
                  </span>
                );
              })}
            </p>
          </li>
        ))}
      </ul>
      {selected && chart ? (
        <section className="mt-8">
          <h2 className="text-xl font-semibold">{selected.name}</h2>
          <nav aria-label="Période du graphique" className="mt-2 flex flex-wrap gap-2 text-sm">
            {RANGES.map((range) => (
              <Link
                key={range.plage}
                href={marketsHref(selected.symbol, range.plage)}
                aria-current={range.plage === plage ? "page" : undefined}
                className={`rounded border px-3 py-1 ${range.plage === plage ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}
              >
                {range.label}
              </Link>
            ))}
          </nav>
          <ChartFigure chart={chart} />
        </section>
      ) : null}
    </main>
  );
}
