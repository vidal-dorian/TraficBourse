// US #22 (C84) — the `chart` spec of a news item in the shared Zod contract.
//
// Contract (`src/lib/schemas/brief.ts`):
// - exports `ChartSpec`, a strict object: `type` literal "price", `symbols` 1 to 3 tickers (same
//   format as `tickers`) without duplicates, `range` in "5D" | "1M" | "3M" | "YTD" | "1Y",
//   `normalize` optional boolean (default false).
// - `NewsItem` gets an optional `chart: ChartSpec`; other unknown keys stay rejected.
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { newsItem, validPayload, type JsonObject } from "../fixtures/brief-payloads";

type Schema = z.ZodType;

async function load(): Promise<{ ChartSpec: Schema; BriefPayload: Schema }> {
  const mod = (await import("../../src/lib/schemas/brief")) as unknown as { ChartSpec?: Schema; BriefPayload: Schema };
  expect(mod.ChartSpec, "src/lib/schemas/brief.ts must export ChartSpec").toBeDefined();
  return { ChartSpec: mod.ChartSpec as Schema, BriefPayload: mod.BriefPayload };
}

const SPEC = { type: "price", symbols: ["^FCHI", "^GSPC"], range: "1M", normalize: true };

describe("C84 — ChartSpec", () => {
  it("given the spec of the story, when it is validated, then it passes unchanged", async () => {
    const { ChartSpec } = await load();
    const result = ChartSpec.safeParse(SPEC);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(SPEC);
  });

  it("given a spec without normalize, when it is validated, then normalize defaults to false", async () => {
    const { ChartSpec } = await load();
    const result = ChartSpec.safeParse({ type: "price", symbols: ["^FCHI"], range: "5D" });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ normalize: false });
  });

  it.each(["5D", "1M", "3M", "YTD", "1Y"])("given the range %s, when it is validated, then it passes", async (range) => {
    const { ChartSpec } = await load();
    expect(ChartSpec.safeParse({ ...SPEC, range }).success).toBe(true);
  });

  it.each([
    ["a type other than price", { ...SPEC, type: "candles" }],
    ["no type", { symbols: ["^FCHI"], range: "1M" }],
    ["no symbol", { ...SPEC, symbols: [] }],
    ["four symbols", { ...SPEC, symbols: ["^FCHI", "^GSPC", "^NDX", "GC=F"] }],
    ["a duplicated symbol", { ...SPEC, symbols: ["^FCHI", "^FCHI"] }],
    ["a symbol with a space", { ...SPEC, symbols: ["CAC 40"] }],
    ["a range outside the enum", { ...SPEC, range: "10Y" }],
    ["no range", { type: "price", symbols: ["^FCHI"] }],
    ["a normalize that is not a boolean", { ...SPEC, normalize: "yes" }],
    ["an extra key (values cannot be sent)", { ...SPEC, values: [1, 2, 3] }],
  ])("given %s, when it is validated, then it is rejected", async (_name, spec) => {
    const { ChartSpec } = await load();
    expect(ChartSpec.safeParse(spec).success).toBe(false);
  });
});

describe("C84 — a news item carries an optional chart", () => {
  it("given a news item with a chart, when the payload is validated, then it passes and keeps the chart", async () => {
    const { BriefPayload } = await load();
    const payload = validPayload();
    (payload.news as JsonObject[])[0] = newsItem({ chart: SPEC });
    const result = BriefPayload.safeParse(payload);
    expect(result.success).toBe(true);
    expect((result.data as { news: { chart?: unknown }[] }).news[0].chart).toEqual(SPEC);
  });

  it("given a news item without chart, when the payload is validated, then it passes", async () => {
    const { BriefPayload } = await load();
    expect(BriefPayload.safeParse(validPayload()).success).toBe(true);
  });

  it("given a bad chart in a news item, when the payload is validated, then the issue path points into the chart", async () => {
    const { BriefPayload } = await load();
    const payload = validPayload();
    (payload.news as JsonObject[])[1] = newsItem({ chart: { ...SPEC, range: "10Y" } });
    const result = BriefPayload.safeParse(payload);
    expect(result.success).toBe(false);
    const paths = (result.error as z.ZodError).issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("news.1.chart.range");
  });

  it("given another unknown key in a news item, when the payload is validated, then it is still rejected", async () => {
    const { BriefPayload } = await load();
    const payload = validPayload();
    (payload.news as JsonObject[])[0] = newsItem({ imageUrl: "https://exemple.fr/a.png" });
    expect(BriefPayload.safeParse(payload).success).toBe(false);
  });
});
