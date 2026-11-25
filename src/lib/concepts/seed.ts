import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { concepts } from "@/lib/db/schema";
import { CONCEPTS } from "./data";

/**
 * Upserts the learning path on `slug` (US #30): title, level, order, definition, analogy and
 * example are refreshed, `seen_in_brief_id` is never touched, so a reseed keeps what was taught.
 *
 * `order` is unique, so reordering concepts could collide with the row that still holds the target
 * position. Inside one transaction every existing row is first parked on `-id` (negative, hence
 * outside the 1..N range and unique), then the upserts put each concept at its final order. A row
 * whose slug left the list stays parked on a negative order, which the path ignores.
 */
export function seedConcepts(db: Db): void {
  db.transaction((tx) => {
    tx.update(concepts).set({ order: sql`-${concepts.id}` }).run();
    for (const concept of CONCEPTS) {
      const values = {
        title: concept.title,
        level: concept.level,
        order: concept.order,
        bodyMd: concept.definition,
        analogy: concept.analogy ?? null,
        example: concept.example ?? null,
      };
      tx.insert(concepts)
        .values({ slug: concept.slug, ...values })
        .onConflictDoUpdate({ target: concepts.slug, set: values })
        .run();
    }
  });
}
