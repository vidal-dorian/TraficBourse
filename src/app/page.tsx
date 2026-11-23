import Image from "next/image";
import { getLatestBrief } from "@/lib/briefs/latest";
import { getDb } from "@/lib/db/client";
import { formatFrenchDate, parisToday } from "@/lib/dates/paris";
import { ExternalLink, Markdown, safeHref } from "@/lib/render/markdown";
import type { Mood } from "@/lib/schemas/brief";

// Read at each request: each morning's brief shows up without a rebuild.
export const dynamic = "force-dynamic";

const MOOD_LABELS: Record<Mood, string> = {
  appetit_risque: "appétit pour le risque",
  aversion_risque: "aversion au risque",
  mitige: "mitigé",
};

/** « Aujourd'hui »: the latest published brief (CLAUDE.md §5). */
export default function HomePage() {
  const brief = getLatestBrief(getDb(), parisToday(new Date()));

  if (!brief) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Veille boursière quotidienne</h1>
        <p className="mt-4 leading-relaxed">
          Aucun brief publié pour l&apos;instant. Chaque matin de semaine, le brief des marchés résumera les
          actualités qui comptent et une notion pour apprendre la bourse pas à pas.
        </p>
      </main>
    );
  }

  const date = formatFrenchDate(brief.date);
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold first-letter:uppercase">
        {brief.kind === "weekly" ? `Récap de la semaine — ${date}` : date}
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        Humeur du marché : <strong className="text-neutral-900">{MOOD_LABELS[brief.mood]}</strong>
      </p>
      <Markdown text={brief.tldr} className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-4 leading-relaxed" />

      {brief.news.map((item) => {
        const sourceHref = safeHref(item.sourceUrl);
        return (
          <article key={item.rank} className="mt-8 border-t border-neutral-200 pt-6">
            <div className="flex items-start gap-3">
              <Image src={`/illustrations/${item.category}.svg`} alt="" width={48} height={48} className="shrink-0" />
              <h2 className="text-lg font-semibold leading-snug">{item.title}</h2>
            </div>
            <Markdown text={item.summary} className="mt-3 leading-relaxed" />
            <h3 className="mt-4 font-semibold">Pourquoi ça compte</h3>
            <Markdown text={item.whyItMatters} className="mt-1 leading-relaxed" />
            <h3 className="mt-4 font-semibold">Impact possible</h3>
            <Markdown text={item.impact} className="mt-1 leading-relaxed" />
            <p className="mt-4 text-sm text-neutral-600">
              Source : {sourceHref ? <ExternalLink href={sourceHref}>{item.sourceName}</ExternalLink> : item.sourceName}
            </p>
          </article>
        );
      })}
    </main>
  );
}
