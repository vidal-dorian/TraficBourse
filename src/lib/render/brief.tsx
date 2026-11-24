// One brief as the public pages show it (home page, brief of a date): its French date, the market
// mood, the TL;DR and every news item. Markdown fields go through the sanitized renderer, titles
// and source names stay plain text.
import Image from "next/image";
import type { ReactNode } from "react";
import type { BriefWithNews } from "@/lib/briefs/latest";
import { formatFrenchDate } from "@/lib/dates/paris";
import { ExternalLink, Markdown, safeHref } from "@/lib/render/markdown";
import type { BriefKind, Mood } from "@/lib/schemas/brief";

const MOOD_LABELS: Record<Mood, string> = {
  appetit_risque: "appétit pour le risque",
  aversion_risque: "aversion au risque",
  mitige: "mitigé",
};

/** The title of a brief: its French date, prefixed for a weekly recap. */
export function briefTitle(kind: BriefKind, date: string): string {
  const french = formatFrenchDate(date);
  return kind === "weekly" ? `Récap de la semaine — ${french}` : french;
}

/** `afterTldr` is shown between the TL;DR and the news (the market tiles, US #21). */
export function BriefContent({ brief, afterTldr }: { brief: BriefWithNews; afterTldr?: ReactNode }) {
  return (
    <>
      <h1 className="text-2xl font-semibold first-letter:uppercase">{briefTitle(brief.kind, brief.date)}</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Humeur du marché : <strong className="text-neutral-900">{MOOD_LABELS[brief.mood]}</strong>
      </p>
      <Markdown text={brief.tldr} className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-4 leading-relaxed" />
      {afterTldr}

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
    </>
  );
}
