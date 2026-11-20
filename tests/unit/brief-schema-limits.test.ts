// US #13 — size and format limits of the news item metadata (sourceName, sourceUrl, tickers), so
// that every leaf of `BriefPayload` is bounded and one call cannot store megabytes of text.
import { describe, expect, it } from "vitest";
import { BriefPayload } from "../../src/lib/schemas/brief";
import { metadataLimitCases, metadataLimitsPayload } from "../fixtures/brief-payloads";

describe("BriefPayload metadata limits", () => {
  it("accepts a payload at the limits (120-character source name, 2048-character URL, ten 20-character tickers, real provider symbols)", () => {
    const parsed = BriefPayload.safeParse(metadataLimitsPayload());

    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2)).toBe(true);
  });

  it.each(metadataLimitCases().map((invalid) => [invalid.name, invalid] as const))(
    "rejects a payload with %s, with an issue at that path",
    (_name, invalid) => {
      const parsed = BriefPayload.safeParse(invalid.payload);

      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(parsed.error.issues.map((issue) => issue.path.map(String).join("."))).toContain(invalid.path);
      if (invalid.mentions) expect(JSON.stringify(parsed.error.issues)).toContain(invalid.mentions);
    },
  );
});
