import { getLatestBrief } from "@/lib/briefs/latest";
import { expectedBriefMissing, MISSING_BRIEF_MESSAGES } from "@/lib/briefs/missing";
import { getDb } from "@/lib/db/client";
import { parisToday } from "@/lib/dates/paris";
import { MarketTiles } from "@/lib/render/market-tiles";
import { BriefContent } from "@/lib/render/brief";

// Read at each request: each morning's brief shows up without a rebuild.
export const dynamic = "force-dynamic";

/** « Aujourd'hui »: the latest published brief (CLAUDE.md §5). */
export default function HomePage() {
  const db = getDb();
  const now = new Date();
  const brief = getLatestBrief(db, parisToday(now));
  const missing = expectedBriefMissing(db, now);
  const banner = missing && (
    <p role="status" className="mb-6 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
      {MISSING_BRIEF_MESSAGES[missing]}
    </p>
  );

  if (!brief) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        {banner}
        <h1 className="text-2xl font-semibold">Veille boursière quotidienne</h1>
        <p className="mt-4 leading-relaxed">
          Aucun brief publié pour l&apos;instant. Chaque matin de semaine, le brief des marchés résumera les
          actualités qui comptent et une notion pour apprendre la bourse pas à pas.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {banner}
      <BriefContent brief={brief} afterTldr={<MarketTiles db={db} briefDate={brief.date} />} />
    </main>
  );
}
