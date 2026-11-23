// Test helpers for the public pages: the home page (US #15), the archives and the brief of a date
// (US #16). Render them the way Next.js would, without the Next.js runtime, read what a visitor
// sees in the markup, and seed the briefs they read.
//
// The pages are server components (sync or async) reading the database at `DATABASE_PATH`:
// stub that variable and call `vi.resetModules()` before rendering, so the app opens the test file.
import type { ReactNode } from "react";
import type { BriefPayload as BriefPayloadData } from "../../src/lib/schemas/brief";
import type { JsonObject } from "../fixtures/brief-payloads";

type Component = (props: unknown) => unknown;

async function renderToHtml(element: unknown): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
}

/** The props Next.js 15 passes to a page: `params` and `searchParams` are Promises. */
function pageProps(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params), searchParams: Promise.resolve({}) };
}

async function homePageElement(): Promise<unknown> {
  const { default: HomePage } = await import("../../src/app/page");
  // Server components may be async: resolve the element first, then render it.
  return (HomePage as Component)(pageProps());
}

/** The markup of the home page alone (`src/app/page.tsx`). */
export async function renderHomePage(): Promise<string> {
  return renderToHtml(await homePageElement());
}

/** The markup of the archives page alone (`src/app/archives/page.tsx`, `/archives`). */
export async function renderArchivesPage(): Promise<string> {
  const { default: ArchivesPage } = await import("../../src/app/archives/page");
  return renderToHtml(await (ArchivesPage as Component)(pageProps()));
}

/**
 * The markup of the brief page alone (`src/app/brief/[date]/page.tsx`) for the URL segment `date`,
 * as in `/brief/<date>`. Rejects with the error the page throws, e.g. the one of `notFound()`.
 */
export async function renderBriefPage(date: string): Promise<string> {
  const { default: BriefPage } = await import("../../src/app/brief/[date]/page");
  return renderToHtml(await (BriefPage as Component)(pageProps({ date })));
}

/** The 404 page (`src/app/not-found.tsx`) as a visitor gets it: inside the root layout. */
export async function renderNotFoundDocument(): Promise<string> {
  const { default: NotFound } = await import("../../src/app/not-found");
  return renderDocument((await (NotFound as Component)({})) as ReactNode);
}

/**
 * The whole document a visitor gets: the root layout (`src/app/layout.tsx`) wrapping `children`,
 * the home page by default.
 */
export async function renderDocument(children?: ReactNode): Promise<string> {
  const { default: RootLayout } = await import("../../src/app/layout");
  const content = children ?? (await homePageElement());
  return renderToHtml(await (RootLayout as Component)({ children: content }));
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes the HTML character references React (or a Markdown renderer) may emit. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1].toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

const BLOCK_TAGS =
  /<\/?(?:p|div|h[1-6]|li|ul|ol|dl|dt|dd|section|article|header|footer|main|nav|aside|figure|figcaption|blockquote|br|hr|table|tr|td|th|body|html)\b[^>]*>/gi;

/**
 * The text a visitor reads: tags removed (block boundaries become spaces, inline tags vanish),
 * character references decoded, typographic apostrophes and spaces normalised.
 */
export function textOf(html: string): string {
  return decodeEntities(html.replace(BLOCK_TAGS, " ").replace(/<[^>]*>/g, ""))
    .replace(/[’ʼ]/g, "'")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Attributes of an opening tag, values decoded; a bare attribute maps to "". */
export function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

export type Anchor = { attributes: Record<string, string>; text: string };

/** Every `<a>` of the markup, in document order. */
export function anchors(html: string): Anchor[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
    attributes: parseAttributes(match[1]),
    text: textOf(match[2]),
  }));
}

/** Attributes of every `<img>` of the markup, in document order. */
export function images(html: string): Record<string, string>[] {
  return [...html.matchAll(/<img\b([^>]*?)\/?>/gi)].map((match) => parseAttributes(match[1]));
}

/** Text of every `<h1>` and `<h2>`, in document order. */
export function mainHeadings(html: string): string[] {
  return [...html.matchAll(/<(h[12])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => textOf(match[2]));
}

/** Every value of a `class` attribute in the markup. */
export function classAttributes(html: string): string[] {
  return [...html.matchAll(/<[a-z][^>]*?\sclass="([^"]*)"/gi)].map((match) => match[1]);
}

export type SeedPayload = {
  date: string;
  kind?: "daily" | "weekly";
  /** Defaults to "published". */
  status?: "published" | "draft";
  payload: JsonObject;
  /**
   * Defaults to true: the payload goes through `BriefPayload`, as `publish_brief` does. False
   * stores it as is, standing for a row written before a rule existed or by another path.
   */
  validate?: boolean;
};

/**
 * Writes `seeds` into the database file in the given order, through the app's own `publishBrief`
 * (US #13); a draft is published, then set back to "draft", as no tool writes drafts yet.
 *
 * Call it before the page opens the database: this connection is closed once the seeds are written.
 */
export async function seedPayloads(path: string, seeds: SeedPayload[]): Promise<void> {
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { eq } = await import("drizzle-orm");
  const { openDatabase } = await import("../../src/lib/db/client");
  const schema = await import("../../src/lib/db/schema");
  const { publishBrief } = await import("../../src/lib/briefs/publish");
  const { BriefPayload } = await import("../../src/lib/schemas/brief");

  const sqlite = openDatabase(path);
  try {
    const db = drizzle(sqlite, { schema });
    for (const seed of seeds) {
      const payload = (seed.validate ?? true) ? BriefPayload.parse(seed.payload) : (seed.payload as unknown as BriefPayloadData);
      const { briefId } = publishBrief(db, {
        date: seed.date,
        kind: seed.kind ?? "daily",
        payload,
        rawPayload: JSON.stringify(seed.payload),
      });
      if (seed.status === "draft") db.update(schema.briefs).set({ status: "draft" }).where(eq(schema.briefs.id, briefId)).run();
    }
  } finally {
    sqlite.close();
  }
}
