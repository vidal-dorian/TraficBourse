// US #30 — a learning path of about 60 concepts ranked from basics to advanced (C112, C113, C114).
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONCEPTS } from "@/lib/concepts/data";
import { seedConcepts } from "@/lib/concepts/seed";
import { openMigrated } from "./helpers/prices";
import { ROOT } from "./helpers/project";
import { makeTempDir } from "./helpers/sqlite";

interface ConceptRow {
  id: number;
  slug: string;
  title: string;
  level: number;
  order: number;
  body_md: string;
  seen_in_brief_id: number | null;
}

function allConcepts(sqlite: ReturnType<typeof openMigrated>["sqlite"]): ConceptRow[] {
  return sqlite.prepare('SELECT id, slug, title, level, "order", body_md, seen_in_brief_id FROM concepts ORDER BY "order"').all() as ConceptRow[];
}

function insertBrief(sqlite: ReturnType<typeof openMigrated>["sqlite"]): number {
  const info = sqlite
    .prepare("INSERT INTO briefs (date, kind, status, tldr, mood, raw_payload) VALUES ('2026-11-20', 'daily', 'published', 't', 'mitige', '{}')")
    .run();
  return Number(info.lastInsertRowid);
}

const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

describe("C112 — the seed fills the concepts table", () => {
  it("C112 — given the concept list, then it holds about 60 concepts with contiguous orders, non-decreasing levels 1 to 3, unique kebab-case slugs", () => {
    expect(CONCEPTS.length).toBeGreaterThanOrEqual(55);
    expect(CONCEPTS.length).toBeLessThanOrEqual(65);
    expect(CONCEPTS.map((c) => c.order)).toEqual(CONCEPTS.map((_, i) => i + 1));
    const levels = CONCEPTS.map((c) => c.level);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    expect(new Set(levels)).toEqual(new Set([1, 2, 3]));
    const slugs = CONCEPTS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const c of CONCEPTS) {
      expect(c.title.trim()).not.toBe("");
      expect(c.definition.trim()).not.toBe("");
    }
  });

  it("C112 — given a fresh migrated database, when I run the seed, then concepts holds each concept with title, level, order and definition", () => {
    const { sqlite, db } = openMigrated();
    seedConcepts(db);
    const rows = allConcepts(sqlite);
    expect(rows).toHaveLength(CONCEPTS.length);
    for (const row of rows) {
      expect(row.title.trim()).not.toBe("");
      expect(row.body_md.trim()).not.toBe("");
      expect([1, 2, 3]).toContain(row.level);
      expect(row.seen_in_brief_id).toBeNull();
    }
    expect(rows.map((r) => r.order)).toEqual(CONCEPTS.map((_, i) => i + 1));
    expect(rows.map((r) => r.slug)).toEqual(CONCEPTS.map((c) => c.slug));
    expect(new Set(rows.map((r) => r.level))).toEqual(new Set([1, 2, 3]));
  });
});

describe("C113 — the seed is idempotent and keeps what was seen", () => {
  it("C113 — given a seed already run, when I run it again, then no duplicate is created and ids are unchanged", () => {
    const { sqlite, db } = openMigrated();
    seedConcepts(db);
    const before = allConcepts(sqlite);
    seedConcepts(db);
    const after = allConcepts(sqlite);
    expect(after).toHaveLength(before.length);
    expect(after.map((r) => [r.id, r.slug])).toEqual(before.map((r) => [r.id, r.slug]));
  });

  it("C113 — given a concept already seen in a brief, when I reseed, then it keeps seen_in_brief_id even if its title was changed", () => {
    const { sqlite, db } = openMigrated();
    seedConcepts(db);
    const briefId = insertBrief(sqlite);
    const target = allConcepts(sqlite)[0];
    sqlite.prepare("UPDATE concepts SET seen_in_brief_id = ?, title = 'modifié' WHERE id = ?").run(briefId, target.id);

    seedConcepts(db);

    const rows = allConcepts(sqlite);
    expect(rows).toHaveLength(CONCEPTS.length);
    const again = rows.find((r) => r.id === target.id);
    expect(again?.seen_in_brief_id).toBe(briefId);
    expect(again?.slug).toBe(target.slug);
    expect(rows.filter((r) => r.seen_in_brief_id !== null)).toHaveLength(1);
  });
});

describe("C114 — level 1 covers the basics", () => {
  const REQUIRED: Record<string, RegExp[]> = {
    action: [/\baction\b/],
    indice: [/\bindice\b/],
    ETF: [/\betf\b/],
    "ETF capitalisant ou distribuant": [/capitalisant/, /distribuant/],
    frais: [/\bfrais\b/],
    diversification: [/diversification/],
    "PEA et compte-titres": [/\bpea\b/, /compte-titres|compte titres|\bcto\b/],
    volatilité: [/volatilite/],
  };

  it("C114 — given level 1, when I read the list, then it covers action, indice, ETF, ETF capitalisant ou distribuant, frais, diversification, PEA et compte-titres, volatilité", () => {
    const level1 = CONCEPTS.filter((c) => c.level === 1).map((c) => plain(`${c.slug} ${c.title}`));
    expect(level1.length).toBeGreaterThan(0);
    for (const [notion, patterns] of Object.entries(REQUIRED)) {
      for (const pattern of patterns) {
        expect(
          level1.some((text) => pattern.test(text)),
          `level 1 should cover « ${notion} » (${pattern})`,
        ).toBe(true);
      }
    }
  });

  it("C114 — given the seeded table, then those level 1 notions are stored with level 1", () => {
    const { sqlite, db } = openMigrated();
    seedConcepts(db);
    const level1 = allConcepts(sqlite)
      .filter((r) => r.level === 1)
      .map((r) => plain(`${r.slug} ${r.title}`));
    for (const patterns of Object.values(REQUIRED)) {
      for (const pattern of patterns) expect(level1.some((t) => pattern.test(t))).toBe(true);
    }
  });
});

describe("US #30 — npm run db:seed-concepts", () => {
  function run(script: string, databasePath: string): void {
    try {
      execFileSync("npm", ["run", script], {
        cwd: ROOT,
        env: { ...process.env, DATABASE_PATH: databasePath },
        stdio: "pipe",
        encoding: "utf8",
      });
    } catch (error) {
      const { stdout, stderr } = error as { stdout?: string; stderr?: string };
      throw new Error(`npm run ${script} failed:\n${stdout ?? ""}\n${stderr ?? ""}`);
    }
  }

  it("C112/C113 — given a migrated database, when I run db:seed-concepts twice, then the table holds each concept once", async () => {
    const databasePath = join(makeTempDir(), "bourse.db");
    run("db:migrate", databasePath);
    run("db:seed-concepts", databasePath);
    run("db:seed-concepts", databasePath);

    const { createRequire } = await import("node:module");
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const count = db.prepare("SELECT COUNT(*) AS n FROM concepts").get() as { n: number };
      const distinct = db.prepare("SELECT COUNT(DISTINCT slug) AS n FROM concepts").get() as { n: number };
      expect(Number(count.n)).toBe(CONCEPTS.length);
      expect(Number(distinct.n)).toBe(CONCEPTS.length);
    } finally {
      db.close();
    }
  }, 60_000);
});
