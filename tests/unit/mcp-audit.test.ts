// US #11 — error text kept in mcp_audit: one short line, never empty.
import { describe, expect, it } from "vitest";
import { MAX_AUDIT_ERROR_LENGTH, shortError } from "../../src/lib/mcp/audit";

describe("shortError", () => {
  it("keeps a short message on one trimmed line", () => {
    expect(shortError("  Échec\n  de l'outil \t ", "fallback")).toBe("Échec de l'outil");
  });

  it("uses the fallback for an empty or blank message", () => {
    expect(shortError("", "fallback")).toBe("fallback");
    expect(shortError(" \n ", "fallback")).toBe("fallback");
  });

  it("cuts a long message to the maximum length", () => {
    const cut = shortError("x".repeat(5_000), "fallback");
    expect(cut).toHaveLength(MAX_AUDIT_ERROR_LENGTH);
    expect(cut.endsWith("…")).toBe(true);
    expect(shortError("y".repeat(MAX_AUDIT_ERROR_LENGTH), "fallback")).toBe("y".repeat(MAX_AUDIT_ERROR_LENGTH));
  });
});
