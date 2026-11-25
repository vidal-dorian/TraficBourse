import type { Metadata } from "next";
import { getAdminStatus } from "@/lib/admin/status";
import { PARIS_TIME_ZONE } from "@/lib/dates/paris";
import { getDb } from "@/lib/db/client";

// Rendered per request, never prerendered: only the owner reaches it (see src/middleware.ts).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "État — Administration — Veille boursière",
  robots: { index: false, follow: false },
};

const runDate = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** « JJ/MM/AAAA HH:MM » in Paris time. */
function formatRunDate(date: Date): string {
  return runDate.format(date).replace(",", "");
}

/** Status of the MCP calls and of the prices job, for the owner. */
export default async function AdminStatusPage() {
  const { calls, lastRun } = getAdminStatus(getDb());
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">État</h1>

      <section aria-labelledby="job-title" className="mt-8">
        <h2 id="job-title" className="text-xl font-semibold">
          Tâche des cours
        </h2>
        {lastRun ? (
          <>
            <p className="mt-2">
              {formatRunDate(lastRun.at)} : {lastRun.updatedCount} mis à jour, {lastRun.failed.length} en échec
            </p>
            {lastRun.failed.length === 0 ? (
              <p className="mt-2">Aucun symbole en erreur</p>
            ) : (
              <ul className="mt-2 list-disc pl-6">
                {lastRun.failed.map((entry) => (
                  <li key={entry.symbol}>
                    <strong>{entry.symbol}</strong> : {entry.error}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="mt-2">Aucune exécution enregistrée</p>
        )}
      </section>

      <section aria-labelledby="calls-title" className="mt-8">
        <h2 id="calls-title" className="text-xl font-semibold">
          Derniers appels MCP
        </h2>
        {calls.length === 0 ? (
          <p className="mt-2">Aucun appel enregistré</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="pr-4">Outil</th>
                  <th className="pr-4">Résultat</th>
                  <th className="pr-4">Erreur</th>
                  <th>Durée</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr key={call.id}>
                    <td className="pr-4">{call.tool}</td>
                    <td className="pr-4">{call.ok ? "Succès" : "Échec"}</td>
                    <td className="pr-4">{call.error}</td>
                    <td>{call.durationMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
