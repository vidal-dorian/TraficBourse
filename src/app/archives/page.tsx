import Link from "next/link";
import { listArchivedBriefs } from "@/lib/briefs/archives";
import { getDb } from "@/lib/db/client";
import { formatFrenchMonth, parisToday } from "@/lib/dates/paris";
import { briefTitle } from "@/lib/render/brief";

// Read at each request: each new brief is listed without a rebuild.
export const dynamic = "force-dynamic";

/** Archives: every published brief up to today, grouped by month, most recent first (US #16). */
export default function ArchivesPage() {
  // Rows come newest first, so the groups (insertion order) and their entries do too.
  const months = Map.groupBy(listArchivedBriefs(getDb(), parisToday(new Date())), (brief) => brief.date.slice(0, 7));

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Archives</h1>
      {months.size === 0 ? (
        <p className="mt-4 leading-relaxed">Aucun brief publié pour l&apos;instant.</p>
      ) : (
        [...months].map(([month, briefs]) => (
          <section key={month} className="mt-8">
            <h2 className="text-lg font-semibold first-letter:uppercase">{formatFrenchMonth(briefs[0].date)}</h2>
            <ul className="mt-2 space-y-2">
              {briefs.map((brief) => (
                <li key={`${brief.date}-${brief.kind}`} className="first-letter:uppercase">
                  <Link href={`/brief/${brief.date}`} className="underline underline-offset-2">
                    {briefTitle(brief.kind, brief.date)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
