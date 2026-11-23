// US #16 — the titles of the archives page and of the brief of a date (browser tab, history).
import { describe, expect, it } from "vitest";
import { metadata } from "../../src/app/archives/page";
import { generateMetadata } from "../../src/app/brief/[date]/page";

function titleOf(date: string) {
  return generateMetadata({ params: Promise.resolve({ date }) }).then((meta) => meta.title);
}

describe("page titles", () => {
  it("names the archives page", () => {
    expect(metadata.title).toBe("Archives — Veille boursière");
  });

  it("names the brief page after its date in French", async () => {
    expect(await titleOf("2026-11-21")).toBe("Brief du samedi 21 novembre 2026 — Veille boursière");
  });

  it.each(["2026-02-30", "2026-11-2", "hier"])("keeps the default title for the segment %s", async (date) => {
    expect(await titleOf(date)).toBeUndefined();
  });
});
