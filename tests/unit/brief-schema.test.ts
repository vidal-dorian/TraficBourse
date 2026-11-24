// US #13 — the shared Zod contract of a brief payload (CLAUDE.md §7, §10: valid and invalid
// payloads from tests/fixtures).
//
// Contract: `src/lib/schemas/brief.ts` exports `BriefPayload`, the Zod schema of the
// `publish_brief` payload for this story (tldr, mood, 1 to 5 news items). Strict objects:
// concept and storylineUpdates arrive with later tickets and are rejected until then
// (stockNotes is accepted since US #26). Each issue carries the path of the faulty field.
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  boundaryPayload,
  CATEGORIES,
  invalidCases,
  MOODS,
  newsItem,
  otherValidPayload,
  payloadWithSeveralErrors,
  validPayload,
  type JsonObject,
} from "../fixtures/brief-payloads";

type Schema = z.ZodType;

async function loadBriefPayload(): Promise<Schema> {
  const mod = (await import("../../src/lib/schemas/brief")) as unknown as { BriefPayload?: Schema };
  expect(mod.BriefPayload, "src/lib/schemas/brief.ts must export BriefPayload").toBeDefined();
  return mod.BriefPayload as Schema;
}

function issuePaths(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.map(String).join("."));
}

describe("C56 — BriefPayload accepts a valid payload", () => {
  it.each([
    ["a daily payload with three news items", validPayload()],
    ["another payload with two news items", otherValidPayload()],
    ["a payload at every limit (max lengths, five news items)", boundaryPayload()],
  ])("C56 — given %s, when it is validated, then it passes", async (_name, payload) => {
    const BriefPayload = await loadBriefPayload();

    const parsed = BriefPayload.safeParse(payload);

    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2)).toBe(true);
  });

  it("C56 — given a news item without tickers, when it is validated, then tickers defaults to an empty list", async () => {
    const BriefPayload = await loadBriefPayload();

    const parsed = BriefPayload.parse(validPayload()) as { news: { tickers: string[] }[] };

    expect(parsed.news[2].tickers).toEqual([]);
    expect(parsed.news[0].tickers).toEqual(["^STOXX50E", "EURUSD=X"]);
  });

  it("C56 — given every category and every mood of the contract, when they are validated, then each one passes", async () => {
    const BriefPayload = await loadBriefPayload();

    for (const mood of MOODS) {
      for (const category of CATEGORIES) {
        const payload: JsonObject = { ...validPayload(), mood, news: [newsItem({ category })] };
        expect(BriefPayload.safeParse(payload).success, `${mood} / ${category}`).toBe(true);
      }
    }
  });
});

describe("C55 — BriefPayload rejects an invalid payload with the path of each error", () => {
  it.each(invalidCases().map((invalid) => [invalid.name, invalid] as const))(
    "C55 — given a payload with %s, when it is validated, then it fails with an issue at that path",
    async (_name, invalid) => {
      const BriefPayload = await loadBriefPayload();

      const parsed = BriefPayload.safeParse(invalid.payload);

      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(issuePaths(parsed.error)).toContain(invalid.path);
      for (const issue of parsed.error.issues) expect(issue.message.trim().length).toBeGreaterThan(0);
      if (invalid.mentions) expect(JSON.stringify(parsed.error.issues)).toContain(invalid.mentions);
    },
  );

  it("C55 — given a payload with several errors, when it is validated, then every error is reported at once", async () => {
    const BriefPayload = await loadBriefPayload();
    const { payload, paths } = payloadWithSeveralErrors();

    const parsed = BriefPayload.safeParse(payload);

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(issuePaths(parsed.error)).toEqual(expect.arrayContaining(paths));
  });
});
