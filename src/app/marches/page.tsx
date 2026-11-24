import type { Metadata } from "next";
import { getDb } from "@/lib/db/client";
import { getLatestCloses } from "@/lib/market/latest";

// Read at each request: a new close shows up without a rebuild.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Marchés — Veille boursière" };

const closeFormat = (currency: string) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 });

/** "au 18/11" for a close dated "2026-11-18". */
function sinceMention(date: string): string {
  return `au ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** Markets: the last known close of every tracked instrument, with its date when it is not the day's (US #19). */
export default function MarketsPage() {
  const closes = getLatestCloses(getDb(), new Date());

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Marchés</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Dernier cours de clôture connu ; la date est indiquée quand il n&apos;est pas celui de la dernière séance.
      </p>
      <ul className="mt-6 divide-y divide-neutral-200">
        {closes.map((entry) => (
          <li key={entry.symbol} className="flex items-baseline justify-between gap-4 py-3">
            <span className="font-medium">{entry.name}</span>
            {entry.close === null || entry.date === null ? (
              <span className="text-neutral-500">Pas encore de cours</span>
            ) : (
              <span className="text-right">
                {closeFormat(entry.currency).format(entry.close)}
                {entry.stale ? <span className="ml-2 text-sm text-neutral-500">{sinceMention(entry.date)}</span> : null}
              </span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
