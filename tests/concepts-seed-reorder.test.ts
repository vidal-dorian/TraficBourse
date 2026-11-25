// US #30 — reseeding after a reorder never hits the unique `order` constraint.
import { describe, expect, it } from "vitest";
import { CONCEPTS } from "@/lib/concepts/data";
import { seedConcepts } from "@/lib/concepts/seed";
import { openMigrated } from "./helpers/prices";

interface Row {
  slug: string;
  order: number;
}

describe("seedConcepts — reorder", () => {
  it("given shifted orders and an extra row, when I reseed, then the concepts are on 1..N and the extra row keeps a non-positive order", () => {
    const { sqlite, db } = openMigrated();
    seedConcepts(db);
    sqlite.prepare('UPDATE concepts SET "order" = "order" + 61').run();
    sqlite
      .prepare("INSERT INTO concepts (slug, title, level, \"order\", body_md) VALUES ('hors-liste', 'Hors liste', 1, 5, 'x')")
      .run();

    expect(() => seedConcepts(db)).not.toThrow();

    const rows = sqlite.prepare('SELECT slug, "order" FROM concepts ORDER BY "order"').all() as Row[];
    const listed = rows.filter((r) => r.order > 0);
    expect(listed.map((r) => r.order)).toEqual(CONCEPTS.map((_, i) => i + 1));
    expect(listed.map((r) => r.slug)).toEqual(CONCEPTS.map((c) => c.slug));
    const extra = rows.find((r) => r.slug === "hors-liste");
    expect(extra).toBeDefined();
    expect(extra!.order).toBeLessThanOrEqual(0);
  });
});
