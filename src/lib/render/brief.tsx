// One brief as the public pages show it (home page, brief of a date): its French date, the market
// mood, the TL;DR and every news item. Markdown fields go through the sanitized renderer, titles
// and source names stay plain text.
import Image from "next/image";
import type { ReactNode } from "react";
import { PriceChart } from "@/components/price-chart";
import type { BriefWithNews, StockNoteCard } from "@/lib/briefs/latest";
import { formatFrenchDate } from "@/lib/dates/paris";
import type { ChartData } from "@/lib/market/chart";
import { ExternalLink, Markdown, safeHref } from "@/lib/render/markdown";
import { variationLabel } from "@/lib/render/market-tiles";
import type { BriefKind, Mood, StockNoteReason } from "@/lib/schemas/brief";

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

const RANGE_LABELS: Record<ChartData["range"], string> = {
  "5D": "5 jours",
  "1M": "1 mois",
  "3M": "3 mois",
  YTD: "depuis le 1er janvier",
  "1Y": "1 an",
};

const frenchNumber = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-11-23" -> "23/11/2026". */
function frenchDay(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

/** « CAC 40 et S&P 500 », « CAC 40, S&P 500 et Nasdaq 100 ». */
function joinNames(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} et ${names.at(-1)}`;
}

/** The chart of a news item: the curves, a caption, and the same figures as a table for screen readers. */
export function ChartFigure({ chart }: { chart: ChartData }) {
  const names = chart.series.map((series) => series.name ?? series.symbol);
  const caption = `${joinNames(names)} — ${RANGE_LABELS[chart.range]}${chart.normalize ? ", base 100" : ""}`;
  const dates = [...new Set(chart.series.flatMap((series) => series.points.map((point) => point.date)))].sort();
  const valueAt = (series: ChartData["series"][number], date: string) => series.points.find((point) => point.date === date)?.value;

  return (
    <figure className="mt-4">
      {dates.length === 0 ? (
        <p className="text-sm text-neutral-600">Pas encore de cours pour ce graphique.</p>
      ) : (
        <>
          <PriceChart series={chart.series} />
          <table className="sr-only">
            <thead>
              <tr>
                <th scope="col">Date</th>
                {names.map((name) => (
                  <th key={name} scope="col">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => (
                <tr key={date}>
                  <th scope="row">{frenchDay(date)}</th>
                  {chart.series.map((series) => {
                    const value = valueAt(series, date);
                    return <td key={series.symbol}>{value === undefined ? "—" : frenchNumber.format(value)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <figcaption className="mt-1 text-sm text-neutral-600">{caption}</figcaption>
    </figure>
  );
}

const REASON_LABELS: Record<StockNoteReason, string> = {
  move: "Mouvement",
  earnings: "Résultats",
  news: "Actualité",
  weekly: "Point de la semaine",
};

/** One card of « Ma watchlist »: the stock, the app's day variation, then the text of Claude. */
function StockNoteItem({ note }: { note: StockNoteCard }) {
  const variation = variationLabel(note.dayVariation);
  const refs = note.newsRefs.flatMap((url) => {
    const href = safeHref(url);
    return href ? [href] : [];
  });
  return (
    <li className="rounded border border-neutral-200 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">{note.name}</h3>
        <p className={`text-sm font-semibold ${variation.className}`}>{variation.text}</p>
      </div>
      <p className="text-xs text-neutral-600">{REASON_LABELS[note.reason]}</p>
      <Markdown text={note.summary} className="mt-2 leading-relaxed" />
      {note.nextEvent ? (
        <p className="mt-2 text-sm">
          <strong>Prochain événement :</strong> {note.nextEvent}
        </p>
      ) : null}
      {refs.length > 0 ? (
        <p className="mt-2 text-sm text-neutral-600">
          À lire :{" "}
          {refs.map((href, index) => (
            <span key={href}>
              {index > 0 ? ", " : null}
              <ExternalLink href={href}>{refs.length > 1 ? `Article ${index + 1}` : "Article"}</ExternalLink>
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
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
      {brief.stockNotes.length > 0 ? (
        <section aria-label="Ma watchlist" className="mt-8">
          <h2 className="text-lg font-semibold">Ma watchlist</h2>
          <ul className="mt-3 space-y-3">
            {brief.stockNotes.map((note, index) => (
              <StockNoteItem key={`${note.symbol}-${index}`} note={note} />
            ))}
          </ul>
        </section>
      ) : null}

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
            {item.chart ? <ChartFigure chart={item.chart} /> : null}
            <p className="mt-4 text-sm text-neutral-600">
              Source : {sourceHref ? <ExternalLink href={sourceHref}>{item.sourceName}</ExternalLink> : item.sourceName}
            </p>
          </article>
        );
      })}
    </>
  );
}
