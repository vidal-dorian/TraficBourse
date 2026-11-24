// US #21 — a tile whose last close is older than the last finished session before the brief says so.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validPayload } from "./fixtures/brief-payloads";
import { renderBriefPage, seedPayloads } from "./helpers/home-page";
import { seedCloses, tileOf } from "./helpers/market-tiles";
import { makeMigratedDatabase } from "./helpers/mcp";

vi.mock("../src/app/globals.css", () => ({}));

let databasePath: string;

beforeEach(() => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("TZ", "UTC");
  vi.resetModules();
});

afterEach(() => vi.unstubAllEnvs());

describe("stale close on a tile", () => {
  it("given a close older than the previous Friday, when I open the Monday brief, then the tile shows « au 18/11 »", async () => {
    await seedPayloads(databasePath, [{ date: "2026-11-23", payload: validPayload() }]);
    await seedCloses(databasePath, [["^FCHI", "2026-11-17", 1], ["^FCHI", "2026-11-18", 2], ["^GSPC", "2026-11-20", 3]]);
    const html = await renderBriefPage("2026-11-23");
    expect(tileOf(html, "CAC 40").text).toContain("au 18/11");
    expect(tileOf(html, "S&P 500").text).not.toContain(" au ");
  });
});
