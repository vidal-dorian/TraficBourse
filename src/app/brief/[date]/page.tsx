import { notFound } from "next/navigation";
import { getBriefsOfDate } from "@/lib/briefs/archives";
import { getDb } from "@/lib/db/client";
import { parisToday } from "@/lib/dates/paris";
import { BriefContent } from "@/lib/render/brief";
import { BriefDate } from "@/lib/schemas/brief";

// Read at each request: a brief republished in the morning shows up without a rebuild.
export const dynamic = "force-dynamic";

/** The brief of one date, /brief/AAAA-MM-JJ, weekly recap first when both exist (US #16). */
export default async function BriefPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  // The segment comes from the URL: only a real calendar date reaches the database.
  if (!BriefDate.safeParse(date).success) notFound();

  const briefs = getBriefsOfDate(getDb(), date, parisToday(new Date()));
  if (briefs.length === 0) notFound();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="space-y-16">
        {briefs.map((brief) => (
          <section key={brief.kind}>
            <BriefContent brief={brief} />
          </section>
        ))}
      </div>
    </main>
  );
}
