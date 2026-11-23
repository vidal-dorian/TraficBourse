// US #15 — the sanitized Markdown subset (src/lib/render/markdown.tsx), beyond what the home page
// acceptance tests cover: lists, italic, nesting, URLs with parentheses, untrusted links.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown, safeHref } from "../../src/lib/render/markdown";

const render = (text: string) => renderToStaticMarkup(<Markdown text={text} />);
const NEW_TAB = 'target="_blank" rel="noopener noreferrer"';

describe("Markdown", () => {
  it("splits paragraphs on blank lines and joins soft line breaks", () => {
    expect(render("Un\ndeux\r\n\r\nTrois")).toBe('<div class="space-y-2"><p>Un deux</p><p>Trois</p></div>');
  });

  it("renders bullet and numbered lists", () => {
    expect(render("- a\n* **b**")).toContain("<ul");
    expect(render("- a\n* **b**")).toContain("<li>a</li><li><strong>b</strong></li>");
    expect(render("1. un\n2) deux")).toContain("<ol");
    expect(render("1. un\n2) deux")).toContain("<li>un</li><li>deux</li>");
  });

  it("renders italic and nested emphasis inside a link", () => {
    expect(render("un *mot* et **[gras](https://a.fr)**")).toBe(
      `<div class="space-y-2"><p>un <em>mot</em> et <strong><a href="https://a.fr" ${NEW_TAB} class="underline underline-offset-2">gras</a></strong></p></div>`,
    );
  });

  it("keeps one level of parentheses in a link URL", () => {
    expect(render("[CAC](https://fr.wikipedia.org/wiki/CAC_40_(indice))")).toContain(
      'href="https://fr.wikipedia.org/wiki/CAC_40_(indice)"',
    );
  });

  it("keeps the label of an untrusted link, without any href", () => {
    const html = render("[relatif](/admin) [ftp](ftp://a.fr) [mail](mailto:a@b.fr)");
    expect(html).not.toContain("href");
    expect(html).toContain("<span>relatif</span>");
  });

  it("leaves an unmatched marker as text", () => {
    expect(render("5 * 3 = 15 et **pas fermé")).toContain("<p>5 * 3 = 15 et **pas fermé</p>");
  });
});

describe("safeHref", () => {
  it.each([
    ["https://www.ecb.europa.eu/press", "https://www.ecb.europa.eu/press"],
    ["HTTP://exemple.fr", "HTTP://exemple.fr"],
    ["javascript:alert(1)", undefined],
    [" https://exemple.fr", undefined],
    ["https://", undefined],
    ["//exemple.fr", undefined],
  ])("%s → %s", (url, expected) => {
    expect(safeHref(url)).toBe(expected);
  });
});
