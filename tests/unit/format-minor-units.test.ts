import { describe, expect, it } from "vitest";
import { formatClose } from "../../src/lib/market/format";

describe("formatClose with minor units", () => {
  it("keeps pence as pence instead of reading them as pounds", () => {
    expect(formatClose(1234.5, "stock", "GBp")).toBe("1 234,50 GBp");
    expect(formatClose(1234.5, "stock", "GBX")).toBe("1 234,50 GBX");
  });
  it("still formats ISO currencies", () => {
    expect(formatClose(10, "stock", "EUR")).toContain("€");
  });
});
