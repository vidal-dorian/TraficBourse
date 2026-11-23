// US #15 — the home page renders what Claude wrote from the web safely, and reads well on a phone
// (C63, C64, C65).
//
// Contract (CLAUDE.md principle 2, principle 4, principle 5, §8; decisions of US #15):
// - Text fields are rendered from Markdown, sanitized: `tldr`, `summary`, `whyItMatters` and
//   `impact` as Markdown, `title` and `sourceName` as plain text. Raw HTML is never interpreted:
//   it is escaped and shows as text, so no script, element or event handler from a brief reaches
//   the markup.
// - Only http(s) URLs become links: a Markdown link or autolink to `javascript:`, `data:`,
//   `vbscript:` (or anything else) never yields such an `href`, character references included, and
//   a stored `sourceUrl` that is not http(s) is not linked either (defence in depth: the schema
//   already refuses it). Markdown images are not rendered: the only images are the category
//   illustrations under `/illustrations/`.
// - Every external (http/https) link opens in a new tab: `target="_blank"` and a `rel` holding
//   `noopener` and `noreferrer`.
// - On a 375 px screen (not testable in Vitest without a browser; checked statically): the root
//   layout sets the viewport to the device width and shows « Contenu éducatif, pas un conseil en
//   investissement » on every page, not hidden; long words and URLs wrap (`break-words`,
//   `wrap-break-word`, `wrap-anywhere` or `break-all` on the page's outer element or on `<body>`,
//   or an `overflow-wrap` rule on html/body/main in `globals.css`); nothing has a fixed width wider
//   than 375 px.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newsItem, validPayload, type JsonObject } from "./fixtures/brief-payloads";
import {
  anchors,
  classAttributes,
  images,
  parseAttributes,
  renderDocument,
  renderHomePage,
  seedPayloads,
  textOf,
  type SeedPayload,
} from "./helpers/home-page";
import { makeMigratedDatabase } from "./helpers/mcp";
import { rootPath } from "./helpers/project";

// The root layout imports its stylesheet; Vitest does not build CSS (Tailwind runs in Next.js).
vi.mock("../src/app/globals.css", () => ({}));

/** 07:30 in Paris on Monday Nov 23, 2026: every brief below is published "today". */
const MONDAY_MORNING = "2026-11-23T06:30:00Z";
const TODAY = "2026-11-23";

let databasePath: string;

beforeEach(() => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("TZ", "UTC");
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(MONDAY_MORNING));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function homePageWith(seeds: SeedPayload[]): Promise<{ html: string; text: string }> {
  await seedPayloads(databasePath, seeds);
  const html = await renderHomePage();
  return { html, text: textOf(html) };
}

/** Today's brief: the fixture payload with `news[0]` (and the TL;DR) overridden. */
function todayWith(overrides: { tldr?: string; firstNews?: JsonObject }, validate = true): SeedPayload {
  const payload = validPayload();
  if (overrides.tldr !== undefined) payload.tldr = overrides.tldr;
  // Without the schema, `tickers` gets no default: give every item one, as the database requires.
  const news = (payload.news as JsonObject[]).map((item) => ({ tickers: [], ...item }));
  news[0] = { ...news[0], ...overrides.firstNews };
  payload.news = news;
  return { date: TODAY, payload, validate };
}

/** Every URL-carrying attribute value of the markup, decoded. */
function urlAttributes(html: string): string[] {
  const values: string[] = [];
  for (const match of html.matchAll(/<[a-z][a-z0-9]*\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1]);
    for (const name of ["href", "src", "srcset", "action", "formaction", "xlink:href", "poster"]) {
      if (name in attributes) values.push(attributes[name]);
    }
  }
  return values;
}

/** An http(s) URL, a site path or a fragment: what a link or image may point to. */
const ALLOWED_URL = /^(?:https?:\/\/|\/(?!\/)|#)/i;

function expectOnlySafeUrls(html: string): void {
  for (const value of urlAttributes(html)) {
    // Browsers ignore whitespace and control characters inside a scheme: strip them too.
    const url = value.replace(/[\u0000- ]/g, "");
    expect(url, `unsafe URL in the markup: ${JSON.stringify(value)}`).toMatch(ALLOWED_URL);
  }
}

// Raw HTML a web page could slip into a brief: a script, an element with an event handler, a
// link and a frame. ≤ 120 characters with the prefix, so it fits even in a title or source name.
const INJECTION = "<script>alert(1)</script><img src=x onerror=alert(1)><a href=x>piège</a><iframe src=x></iframe>";

const TEXT_FIELDS = ["tldr", "title", "summary", "whyItMatters", "impact", "sourceName"] as const;

describe("C63 — given HTML or a script in a text field, when the page renders, then it shows as text and does not run", () => {
  it.each(TEXT_FIELDS)(
    "C63 — given HTML and a script in the %s field, when the page renders, then they show as text and nothing is interpreted",
    async (field) => {
      const value = `Texte ${INJECTION}`;
      const seed = field === "tldr" ? todayWith({ tldr: value }) : todayWith({ firstNews: { [field]: value } });

      const { html, text } = await homePageWith([seed]);

      expect(text, "the HTML must show as text").toContain(value);
      expect(html).not.toMatch(/<script\b/i);
      expect(html).not.toMatch(/<iframe\b/i);
      expect(html, "no event handler attribute").not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
      for (const image of images(html)) expect(image.src).toMatch(/^\/illustrations\//);
      expect(anchors(html).map((anchor) => anchor.attributes.href)).not.toContain("x");
    },
  );

  it("C63 — given Markdown links to javascript:, data: or vbscript: URLs in a text field, when the page renders, then no such link is produced", async () => {
    const summary = [
      "Liens piégés :",
      "[un](javascript:alert(1))",
      "[deux](JaVaScRiPt:alert(2))",
      "[trois](data:text/html;base64,PHNjcmlwdD5hbGVydCgzKTwvc2NyaXB0Pg==)",
      "[quatre](vbscript:msgbox(4))",
      "[cinq](&#106;avascript:alert(5))",
      "[six](  javascript:alert(6))",
      "<javascript:alert(7)>",
      "[sept][ref]\n\n[ref]: javascript:alert(8)",
    ].join(" ");

    const { html, text } = await homePageWith([todayWith({ firstNews: { summary } })]);

    expect(text).toContain("Liens piégés");
    expectOnlySafeUrls(html);
    expect(html).not.toMatch(/(?:href|src)\s*=\s*["']?\s*(?:javascript|vbscript|data):/i);
  });

  it("C63 — given a stored source URL that is not http(s), when the page renders, then it is not turned into a link", async () => {
    // Written without the schema, as by a row older than a rule: the page must not trust the database.
    const seed = todayWith({ firstNews: { sourceUrl: "javascript:alert(document.cookie)" } }, false);

    const { html, text } = await homePageWith([seed]);

    expect(text).toContain((validPayload().news as JsonObject[])[0].title as string);
    expectOnlySafeUrls(html);
  });

  it("C63 — given a Markdown image in a text field, when the page renders, then no image from the web is loaded", async () => {
    const summary = "Une image glissée dans le résumé : ![pixel](https://tracker.example/pixel.png) fin du résumé.";

    const { html, text } = await homePageWith([todayWith({ firstNews: { summary } })]);

    expect(text).toContain("fin du résumé");
    for (const image of images(html)) expect(image.src).toMatch(/^\/illustrations\//);
    // React may hoist an image preload: it must not point to the web either.
    for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
      const link = parseAttributes(match[1]);
      if (link.as === "image") expect(link.href).toMatch(/^\/illustrations\//);
    }
  });
});

describe("C64 — given an external link, when I click it, then it opens in a new tab with rel=\"noopener noreferrer\"", () => {
  function expectNewTab(href: string, html: string): void {
    const link = anchors(html).find((anchor) => anchor.attributes.href === href);
    expect(link, `a link to ${href} must be shown`).toBeDefined();
    expect(link?.attributes.target, `${href} must open in a new tab`).toBe("_blank");
    const rel = (link?.attributes.rel ?? "").toLowerCase().split(/\s+/);
    expect(rel, `rel of ${href}`).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
  }

  it("C64 — given the source link of each news item, when I click it, then it opens in a new tab with rel=\"noopener noreferrer\"", async () => {
    const payload = validPayload();

    const { html } = await homePageWith([{ date: TODAY, payload }]);

    for (const item of payload.news as JsonObject[]) expectNewTab(item.sourceUrl as string, html);
  });

  it("C64 — given Markdown links in the TL;DR, summary, « pourquoi ça compte » and impact, when I click one, then it opens in a new tab with rel=\"noopener noreferrer\"", async () => {
    const seed = todayWith({
      tldr: "La [BCE](https://www.ecb.europa.eu/home/html/index.fr.html) ne bouge pas.",
      firstNews: {
        summary: "Voir [le communiqué](https://www.ecb.europa.eu/press/pr/html/index.fr.html).",
        whyItMatters: "Une [explication de l'AMF](https://www.amf-france.org/fr/espace-epargnants).",
        impact: "Une [analyse de la Banque de France](https://www.banque-france.fr/fr).",
      },
    });

    const { html } = await homePageWith([seed]);

    expectNewTab("https://www.ecb.europa.eu/home/html/index.fr.html", html);
    expectNewTab("https://www.ecb.europa.eu/press/pr/html/index.fr.html", html);
    expectNewTab("https://www.amf-france.org/fr/espace-epargnants", html);
    expectNewTab("https://www.banque-france.fr/fr", html);
  });

  it("C64 — given a brief on the home page, when I click any external link, then every one opens in a new tab with rel=\"noopener noreferrer\"", async () => {
    const { html } = await homePageWith([{ date: TODAY, payload: validPayload() }]);

    const external = anchors(html).filter((anchor) => /^https?:\/\//i.test(anchor.attributes.href ?? ""));
    expect(external.length).toBeGreaterThanOrEqual(3);
    for (const link of external) expectNewTab(link.attributes.href, html);
  });
});

/** Fixed widths (Tailwind classes, inline styles, width attributes) wider than a 375 px screen. */
function widthsOver375(html: string): string[] {
  const offenders: string[] = [];
  const CONTAINER_SIZES_OVER_375 = new Set(["sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl"]);
  for (const classes of classAttributes(html)) {
    for (const token of classes.split(/\s+/)) {
      const utility = token.split(":").pop() ?? "";
      const match = /^(?:min-)?w-(?:\[(\d+(?:\.\d+)?)(px|rem)\]|(\d+(?:\.\d+)?)|(\w+))$/.exec(utility);
      if (!match) continue;
      const px = match[1] ? Number(match[1]) * (match[2] === "rem" ? 16 : 1) : match[3] ? Number(match[3]) * 4 : 0;
      if (px > 375 || (match[4] && CONTAINER_SIZES_OVER_375.has(match[4]))) offenders.push(token);
    }
  }
  for (const match of html.matchAll(/style="[^"]*?\b(?:min-)?width\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
    if (Number(match[1]) > 375) offenders.push(match[0]);
  }
  for (const match of html.matchAll(/<[a-z]+\b[^>]*?\swidth="(\d+)"/gi)) {
    if (Number(match[1]) > 375) offenders.push(match[0]);
  }
  return offenders;
}

const WRAP_CLASS = /(?:^|\s)(?:break-words|wrap-break-word|wrap-anywhere|break-all)(?:\s|$)/;
const CSS_WRAP_RULE =
  /(?:^|[\s,}])(?:html|body|main|:root|\*)\b[^{}]*\{[^}]*(?:overflow-wrap\s*:\s*(?:anywhere|break-word)|word-wrap\s*:\s*break-word|word-break\s*:\s*break-(?:word|all))/i;

describe("C65 — given a 375 px screen, when I read the brief, then nothing scrolls horizontally and the educational notice is visible", () => {
  it("C65 — given a 375 px screen, when I read the brief, then « contenu éducatif, pas un conseil en investissement » is visible on the page, from the root layout", async () => {
    const payload = validPayload();
    await seedPayloads(databasePath, [{ date: TODAY, payload }]);

    const html = await renderDocument();

    const text = textOf(html);
    expect(text, "the brief must be on the page").toContain(payload.tldr as string);
    const notice = /contenu éducatif,? pas un conseil en investissement/i;
    expect(text).toMatch(notice);
    const position = html.search(notice);
    const lastTag = [...html.slice(0, position).matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)].pop();
    const classes = parseAttributes(lastTag?.[2] ?? "").class ?? "";
    expect(classes, "the notice must not be hidden").not.toMatch(/(?:^|\s)(?:hidden|sr-only|invisible)(?:\s|$)/);

    // In the root layout, so it shows on every page, not only the home page.
    expect(textOf(await renderDocument(<p>Une autre page</p>))).toMatch(notice);
  });

  it("C65 — given a 375 px screen, when I read a brief with long words and URLs, then the page fits the device width and they wrap instead of scrolling horizontally", async () => {
    const longWord = "Anticonstitutionnellement".repeat(3);
    const longSource = `https://www.exemple-de-source.fr/${"rubrique-tres-longue-".repeat(4)}`;
    const seed = todayWith({ firstNews: { summary: `Un mot sans espace : ${longWord}.`, sourceName: longSource } });
    await seedPayloads(databasePath, [seed]);

    const html = await renderDocument();
    const page = await renderHomePage();

    expect(textOf(html), "the brief must be on the page").toContain(longWord);

    const layout = (await import("../src/app/layout")) as { viewport?: { width?: unknown } };
    expect(layout.viewport?.width).toBe("device-width");

    const bodyClass = parseAttributes(/<body\b([^>]*)>/i.exec(html)?.[1] ?? "").class ?? "";
    // The page's outer element: its first tag, skipping the <link>/<meta> React may hoist.
    const pageRootClass = parseAttributes(/<(?!link\b|meta\b)[a-z][a-z0-9]*\b([^>]*)>/i.exec(page)?.[1] ?? "").class ?? "";
    const css = readFileSync(rootPath("src", "app", "globals.css"), "utf8");
    expect(
      WRAP_CLASS.test(bodyClass) || WRAP_CLASS.test(pageRootClass) || CSS_WRAP_RULE.test(css),
      "long words must wrap: a wrapping class on <body> or the page's outer element, or an overflow-wrap rule in globals.css",
    ).toBe(true);

    expect(widthsOver375(html), "no fixed width wider than 375 px").toEqual([]);
  });

  it("C65 — given a news item with its illustration, when I read it on a 375 px screen, then the illustration is not wider than the screen", async () => {
    const payload = { ...validPayload(), news: [newsItem({ category: "macro" })] };

    const { html } = await homePageWith([{ date: TODAY, payload }]);

    const illustration = images(html).find((image) => image.src === "/illustrations/macro.svg");
    expect(illustration, "the illustration must be shown").toBeDefined();
    if (illustration?.width !== undefined) expect(Number(illustration.width)).toBeLessThanOrEqual(375);
    expect(widthsOver375(html)).toEqual([]);
  });
});
