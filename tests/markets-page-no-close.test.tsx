// US #23 — a selected instrument without any close still gets its heading and a French notice instead of a chart.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { textOf } from "./helpers/home-page";
import { makeMigratedDatabase } from "./helpers/mcp";

vi.mock("../src/app/globals.css", () => ({}));

beforeEach(() => {
  vi.stubEnv("DATABASE_PATH", makeMigratedDatabase());
  vi.stubEnv("TZ", "UTC");
  vi.resetModules();
});

afterEach(() => vi.unstubAllEnvs());

it("given a selected instrument without close, when I open its page, then the heading and the notice show", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: Page } = await import("../src/app/marches/page");
  const element = await (Page as (p: unknown) => unknown)({ searchParams: Promise.resolve({ instrument: "BTC-EUR" }) });
  const html = renderToStaticMarkup(element as never);
  expect(html).toMatch(/<h2\b[^>]*>[^<]*Bitcoin[^<]*<\/h2>/);
  expect(textOf(html)).toContain("Pas encore de cours pour ce graphique.");
});
