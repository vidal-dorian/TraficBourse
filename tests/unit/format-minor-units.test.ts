import { describe, expect, it } from "vitest";
import { formatClose } from "../../src/lib/market/format";

describe("formatClose with minor units", () => {
  it("keeps pence as pence instead of reading them as pounds", () => {
    expect(formatClose(1234.5, "stock", "GBp")).toMatch(/^1\s234,50\sGBp$/);
    expect(formatClose(1234.5, "stock", "GBX")).toMatch(/^1\s234,50\sGBX$/);
  });
  it("still formats ISO currencies", () => {
    expect(formatClose(10, "stock", "EUR")).toContain("€");
  });
});
