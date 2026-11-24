import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import type { InstrumentSearchResult } from "@/lib/market/search";
import { createYahooSearch } from "@/lib/market/yahoo-search";
import { ADDABLE_TYPES } from "@/lib/watchlist/owner-actions";
import { listWatchlist } from "@/lib/watchlist/watchlist";
import { addStock, removeStock } from "./actions";

// Rendered per request, never prerendered: only the owner reaches it (see src/middleware.ts).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Watchlist — Administration",
  robots: { index: false, follow: false },
};

// Feedback of the last action, passed as `?status=` by the server actions: only these codes show.
const STATUS_MESSAGES: Record<string, { text: string; error: boolean }> = {
  added: { text: "Action ajoutée à la watchlist, son historique d'un an est enregistré.", error: false },
  removed: { text: "Action retirée de la watchlist. Son historique est conservé.", error: false },
  forbidden: { text: "Action refusée : accès non autorisé.", error: true },
  invalid: { text: "Action refusée : données invalides.", error: true },
  not_found: { text: "Action introuvable.", error: true },
  search_failed: { text: "Ajout impossible : la recherche est indisponible, réessayez plus tard.", error: true },
  currency_failed: { text: "Ajout impossible : la devise de l'action n'a pas pu être vérifiée, réessayez plus tard.", error: true },
  write_failed: { text: "Ajout impossible : l'enregistrement a échoué, réessayez.", error: true },
  history_failed: {
    text: "Action suivie, mais son historique n'a pas pu être récupéré : il sera complété à la prochaine mise à jour des cours.",
    error: true,
  },
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function search(query: string): Promise<{ results: InstrumentSearchResult[] } | { failed: true }> {
  try {
    return { results: (await createYahooSearch().searchInstruments(query)).filter((result) => ADDABLE_TYPES.includes(result.type)) };
  } catch (error) {
    console.error(`Watchlist search failed: ${error instanceof Error ? error.message : String(error)}`);
    return { failed: true };
  }
}

export default async function AdminWatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; status?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = (first(params.q) ?? "").trim();
  const status = STATUS_MESSAGES[first(params.status) ?? ""];
  const followed = listWatchlist(getDb());
  const followedSymbols = new Set(followed.map((entry) => entry.symbol));
  const outcome = query ? await search(query) : undefined;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p>
        <Link href="/admin" className="underline">
          Administration
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Watchlist</h1>

      {status ? (
        <p role={status.error ? "alert" : "status"} className="mt-4 leading-relaxed">
          {status.text}
        </p>
      ) : null}

      <section className="mt-6" aria-labelledby="followed">
        <h2 id="followed" className="text-lg font-semibold">
          Actions suivies
        </h2>
        {followed.length === 0 ? (
          <p className="mt-2">Aucune action suivie.</p>
        ) : (
          <ul className="mt-2 divide-y">
            {followed.map((entry) => (
              <li key={entry.symbol} className="flex items-center justify-between gap-4 py-2">
                <span>
                  {entry.name} · {entry.symbol}
                  {entry.exchange ? ` · ${entry.exchange}` : ""}
                </span>
                <form action={removeStock}>
                  <input type="hidden" name="symbol" value={entry.symbol} />
                  <button type="submit" className="underline">
                    Retirer
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-labelledby="search">
        <h2 id="search" className="text-lg font-semibold">
          Ajouter une action
        </h2>
        <form method="get" className="mt-2 flex gap-2">
          <label className="sr-only" htmlFor="q">
            Nom ou symbole
          </label>
          <input id="q" name="q" type="search" defaultValue={query} placeholder="Air Liquide" className="flex-1 border px-2 py-1" />
          <button type="submit" className="border px-3 py-1">
            Rechercher
          </button>
        </form>

        {outcome && "failed" in outcome ? (
          <p role="alert" className="mt-4">
            La recherche est indisponible pour le moment, réessayez plus tard.
          </p>
        ) : null}
        {outcome && "results" in outcome ? (
          outcome.results.length === 0 ? (
            <p className="mt-4">Aucun résultat pour « {query} ».</p>
          ) : (
            <ul className="mt-4 divide-y">
              {outcome.results.map((result) => (
                <li key={result.providerSymbol} className="flex items-center justify-between gap-4 py-2">
                  <span>
                    {result.name} · {result.providerSymbol}
                    {result.exchange ? ` · ${result.exchange}` : ""}
                  </span>
                  {followedSymbols.has(result.providerSymbol) ? (
                    <span>Déjà suivie</span>
                  ) : (
                    <form action={addStock}>
                      <input type="hidden" name="providerSymbol" value={result.providerSymbol} />
                      <input type="hidden" name="name" value={result.name} />
                      <input type="hidden" name="exchange" value={result.exchange ?? ""} />
                      <input type="hidden" name="type" value={result.type} />
                      <button type="submit" className="underline">
                        Ajouter
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </main>
  );
}
