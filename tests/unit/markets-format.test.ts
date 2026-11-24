import { describe, expect, it } from "vitest";
import { formatClose } from "@/lib/market/format";

describe("formatClose", () => {
  it("formats by instrument type and survives an unknown currency code", () => {
    expect(formatClose(7123.456, "index", "EUR").replace(/\s/g, " ")).toBe("7 123,46 pts");
    expect(formatClose(1.05234, "fx", "USD")).toMatch(/1,0523/);
    expect(formatClose(1.05234, "fx", "USD")).toMatch(/\$/);
    expect(formatClose(12.5, "stock", "EUR")).toMatch(/12,50/);
    expect(formatClose(12.5, "stock", "??")).toBe("12,50 ??");
  });
});
