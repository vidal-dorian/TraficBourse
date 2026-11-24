import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBriefsOfDate } from "@/lib/briefs/archives";
import { getDb } from "@/lib/db/client";
import { formatFrenchDate, parisToday } from "@/lib/dates/paris";
import { MarketTiles } from "@/lib/render/market-tiles";
import { BriefContent } from "@/lib/render/brief";
import { BriefDate } from "@/lib/schemas/brief";

// Read at each request: a brief republished in the morning shows up without a rebuild.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ date: string }> };

/**
 * « Brief du <French date> — Veille boursière » for a real date, without reading the database;
 * the default title (root layout) otherwise.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  return BriefDate.safeParse(date).success ? { title: `Brief du ${formatFrenchDate(date)} — Veille boursière` } : {};
}

/** The brief of one date, /brief/AAAA-MM-JJ, weekly recap first when both exist (US #16). */
export default async function BriefPage({ params }: Props) {
  const { date } = await params;
  // The segment comes from the URL: only a real calendar date reaches the database.
  if (!BriefDate.safeParse(date).success) notFound();

  const db = getDb();
  const briefs = getBriefsOfDate(db, date, parisToday(new Date()));
  if (briefs.length === 0) notFound();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="space-y-16">
        {briefs.map((brief, index) => (
          <section key={brief.kind}>
            <BriefContent brief={brief} afterTldr={index === 0 ? <MarketTiles db={db} briefDate={date} /> : undefined} />
          </section>
        ))}
      </div>
    </main>
  );
}
