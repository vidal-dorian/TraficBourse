// Sanitized Markdown rendering (CLAUDE.md principle 2, §8): the texts come from Claude, who read
// them on the web, so nothing in them is trusted. Only a small subset is understood — paragraphs,
// bullet and numbered lists, **bold**, *italic* and [links](https://…) — and everything else,
// raw HTML included, stays text: the output is React elements, which React escapes, never an HTML
// string. Only absolute http(s) URLs become links, and they open in a new tab.
//
// ponytail: hand-written subset, no headings, code, images nor reference links (shown as typed);
// switch to a CommonMark renderer (react-markdown, keeping raw HTML as text) if briefs need more.
import type { ReactNode } from "react";

/**
 * `url` when it is an absolute http(s) URL without user info, as typed; undefined otherwise.
 * User info is refused as in `SourceUrl`: `https://reuters.com@evil.example` opens another host.
 */
export function safeHref(url: string): string | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const { protocol, username, password } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && username === "" && password === "" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** A link leaving the site: new tab, no `window.opener`, no referrer. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  );
}

// **bold** | *italic* | [text](url), the URL allowing one level of parentheses (Wikipedia style).
const INLINE = /\*\*(.+?)\*\*|\*([^*\s](?:[^*]*[^*\s])?)\*|\[([^\]]+)\]\(\s*((?:[^\s()]|\([^\s()]*\))+)\s*\)/g;

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const [whole, bold, italic, label, url] = match;
    const index = match.index;
    if (index > last) nodes.push(text.slice(last, index));
    if (bold !== undefined) nodes.push(<strong key={index}>{inline(bold)}</strong>);
    else if (italic !== undefined) nodes.push(<em key={index}>{inline(italic)}</em>);
    else {
      const href = safeHref(url);
      nodes.push(
        href ? (
          <ExternalLink key={index} href={href}>
            {inline(label)}
          </ExternalLink>
        ) : (
          // Not a link we trust: keep its label, drop the URL.
          <span key={index}>{inline(label)}</span>
        ),
      );
    }
    last = index + whole.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const BULLET = /^[-*+]\s+/;
const NUMBERED = /^\d+[.)]\s+/;

type Run = { kind: "p" | "ul" | "ol"; lines: string[] };

/** The lines of a block grouped into runs of text, bullet items and numbered items. */
function runs(lines: string[]): Run[] {
  const kinds = lines.map((line) => (BULLET.test(line) ? "ul" : NUMBERED.test(line) ? "ol" : "p"));
  // A lone numbered line reads as text ("2026. Une année record."): a numbered list needs 2 items.
  const demoted = kinds.map((kind, index) =>
    kind === "ol" && kinds[index - 1] !== "ol" && kinds[index + 1] !== "ol" ? "p" : kind,
  );
  const result: Run[] = [];
  lines.forEach((line, index) => {
    const last = result.at(-1);
    if (last?.kind === demoted[index]) last.lines.push(line);
    else result.push({ kind: demoted[index], lines: [line] });
  });
  return result;
}

function run({ kind, lines }: Run, key: number): ReactNode {
  if (kind === "p") return <p key={key}>{inline(lines.join(" "))}</p>;
  const marker = kind === "ul" ? BULLET : NUMBERED;
  const items = lines.map((line, index) => <li key={index}>{inline(line.replace(marker, ""))}</li>);
  if (kind === "ul") {
    return (
      <ul key={key} className="list-disc space-y-1 pl-5">
        {items}
      </ul>
    );
  }
  const start = parseInt(lines[0], 10);
  return (
    <ol key={key} start={start === 1 ? undefined : start} className="list-decimal space-y-1 pl-5">
      {items}
    </ol>
  );
}

/** `text` rendered as sanitized Markdown, one block per paragraph or list. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => runs(part.split("\n").map((line) => line.trim())));
  return <div className={className ? `space-y-2 ${className}` : "space-y-2"}>{blocks.map(run)}</div>;
}
