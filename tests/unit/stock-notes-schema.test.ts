// US #26 — BriefPayload accepts `stockNotes` (#97): { symbol, reason, summary, newsRefs, nextEvent }.
import { describe, expect, it } from "vitest";
import { validPayload, type JsonObject } from "../fixtures/brief-payloads";

async function loadBriefPayload() {
  return (await import("../../src/lib/schemas/brief")).BriefPayload;
}

function note(overrides: JsonObject = {}): JsonObject {
  return { symbol: "AI.PA", reason: "move", summary: "Air Liquide gagne **2,4 %**.", ...overrides };
}

function withNotes(...notes: JsonObject[]): JsonObject {
  return { ...validPayload(), stockNotes: notes };
}

describe("#97 — BriefPayload stockNotes", () => {
  it("#97 — given a payload without stockNotes, when it is validated, then stockNotes defaults to []", async () => {
    const BriefPayload = await loadBriefPayload();
    const parsed = BriefPayload.parse(validPayload()) as unknown as { stockNotes: unknown };
    expect(parsed.stockNotes).toEqual([]);
  });

  it("#97 — given a full note, when it is validated, then every field is kept", async () => {
    const BriefPayload = await loadBriefPayload();
    const full = note({ reason: "earnings", newsRefs: ["https://example.com/a"], nextEvent: "Résultats le 12/02" });
    const parsed = BriefPayload.parse(withNotes(full)) as unknown as { stockNotes: JsonObject[] };
    expect(parsed.stockNotes).toEqual([full]);
  });

  it("#97 — given a note without newsRefs, when it is validated, then newsRefs defaults to [] and nextEvent stays absent", async () => {
    const BriefPayload = await loadBriefPayload();
    const parsed = BriefPayload.parse(withNotes(note())) as unknown as { stockNotes: JsonObject[] };
    expect(parsed.stockNotes[0].newsRefs).toEqual([]);
    expect(parsed.stockNotes[0].nextEvent ?? undefined).toBeUndefined();
  });

  it.each(["move", "earnings", "news", "weekly"])("#97 — given the reason %s, when it is validated, then it is accepted", async (reason) => {
    const BriefPayload = await loadBriefPayload();
    expect(BriefPayload.safeParse(withNotes(note({ reason }))).success).toBe(true);
  });

  it.each([
    ["an unknown reason", note({ reason: "rumeur" }), "stockNotes.0.reason"],
    ["a missing symbol", (() => { const n = note(); delete n.symbol; return n; })(), "stockNotes.0.symbol"],
    ["a blank summary", note({ summary: "   " }), "stockNotes.0.summary"],
    ["a summary over 600 characters", note({ summary: "x".repeat(601) }), "stockNotes.0.summary"],
    ["a relative news ref", note({ newsRefs: ["/article"] }), "stockNotes.0.newsRefs.0"],
    ["a javascript: news ref", note({ newsRefs: ["javascript:alert(1)"] }), "stockNotes.0.newsRefs.0"],
    ["an unknown key in the note", note({ price: 12 }), "stockNotes.0"],
  ])("#97 — given %s, when it is validated, then it fails at that path", async (_name, bad, path) => {
    const BriefPayload = await loadBriefPayload();
    const parsed = BriefPayload.safeParse(withNotes(bad));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => i.path.join("."))).toContain(path);
  });
});
