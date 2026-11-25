// US #28 — the admin status page: « une page d'état dans /admin » to understand why a brief is missing.
//
// Contract chosen for the developer (names are minimal on purpose):
// - `src/app/admin/status/page.tsx` default-exports an async server component taking no useful props
//   (called with `{ params, searchParams }` promises), renderable without the Next.js runtime; it exports
//   `dynamic = "force-dynamic"` and `metadata` with robots noindex. It reads the database with `getDb()`
//   (`DATABASE_PATH`) through a domain function under `src/lib` (name free, e.g. `getAdminStatus`).
// - `/admin` links to `/admin/status`.
// - New table `job_runs` (drizzle migration). `runPricesJob` (src/jobs/prices.ts) itself records one row per
//   run in the `db` it is given (run time = its `now`, number updated, and the failed symbols with their
//   message), so the jobs entrypoint needs no extra wiring. A run is recorded even when symbols fail.
//   The tests seed job runs ONLY by calling `runPricesJob`, so column names stay the developer's choice.
// - Criterion 1: an `<h1>` « État », then the 50 latest `mcp_audit` rows, newest first, one table row each:
//   tool, « Succès » or « Échec », the error text (if any), the duration as « 1234 ms ». Older rows are not shown.
//   No row → « Aucun appel enregistré ».
// - Criterion 2: a « Tâche des cours » section with the date of the last run as « JJ/MM/AAAA HH:MM » in Paris
//   time and its result « N mis à jour, M en échec ». No run → « Aucune exécution enregistrée ».
// - Criterion 3: the failed symbols of the LAST run only, each with its symbol and message; none →
//   « Aucun symbole en erreur ».
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bar, fakeLogger, fakeProvider } from "./helpers/prices";
import { makeMigratedDatabase } from "./helpers/mcp";

vi.mock("../src/app/globals.css", () => ({}));

let databasePath: string;

beforeEach(() => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
}

async function renderPage(): Promise<string> {
  const { default: Page } = await import("../src/app/admin/status/page");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const element = await (Page as (p: unknown) => unknown)({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
}

type Call = { tool: string; ok: boolean; error?: string | null; durationMs: number; at: number };

async function seedCalls(calls: Call[]) {
  const { openDatabase } = await import("../src/lib/db/client");
  const sqlite = openDatabase(databasePath);
  try {
    const insert = sqlite.prepare("INSERT INTO mcp_audit (tool, ok, error, duration_ms, at) VALUES (?, ?, ?, ?, ?)");
    for (const c of calls) insert.run(c.tool, c.ok ? 1 : 0, c.error ?? null, c.durationMs, c.at);
  } finally {
    sqlite.close();
  }
}

/** Runs the real prices job on the test database; `failing` provider symbols throw `boom <symbol>`. */
async function runJob(now: Date, failing: string[] = []) {
  const { openDatabase } = await import("../src/lib/db/client");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const schema = await import("../src/lib/db/schema");
  const { runPricesJob } = await import("../src/jobs/prices");
  const sqlite = openDatabase(databasePath);
  try {
    const db = drizzle(sqlite, { schema });
    const provider = fakeProvider({ "^FCHI": [bar("2026-11-20", 100)] }, failing);
    return await runPricesJob({ db, provider, now, logger: fakeLogger() });
  } finally {
    sqlite.close();
  }
}

// 2026-11-23T07:00Z is Monday 08:00 in Paris.
const MONDAY = new Date("2026-11-23T07:00:00Z");
const TUESDAY = new Date("2026-11-24T07:00:00Z");

describe("US #28 — the page exists and is reachable from /admin", () => {
  it("given the admin home, when I open it, then it links to /admin/status", async () => {
    const { default: Admin } = await import("../src/app/admin/page");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup((Admin as () => Parameters<typeof renderToStaticMarkup>[0])());
    expect(html).toMatch(/<a[^>]*href="\/admin\/status"/);
  });

  it("given the status page module, then it is rendered per request and not indexed", async () => {
    const mod = await import("../src/app/admin/status/page");
    expect(mod.dynamic).toBe("force-dynamic");
    expect(mod.metadata.robots).toMatchObject({ index: false });
  });
});

describe("criterion 1 — the 50 latest MCP calls", () => {
  it("given 60 logged calls, when I open the page, then I see the 50 latest, newest first, with tool, success, error and duration", async () => {
    const base = 1_795_000_000;
    const calls: Call[] = Array.from({ length: 60 }, (_, i) => ({
      tool: `outil_${String(i + 1).padStart(2, "0")}`,
      ok: i + 1 !== 60,
      error: i + 1 === 60 ? "Charge utile refusée" : null,
      durationMs: 1000 + i,
      at: base + i * 60,
    }));
    await seedCalls(calls);
    const html = await renderPage();
    const text = textOf(html);

    expect(html.match(/outil_\d\d/g)).toHaveLength(50);
    expect(text).toContain("outil_11");
    expect(text).toContain("outil_60");
    expect(text).not.toContain("outil_10");
    expect(text).not.toContain("outil_01");
    expect(text.indexOf("outil_60")).toBeLessThan(text.indexOf("outil_59"));
    expect(text).toMatch(/outil_60 Échec Charge utile refusée 1059 ms/);
    expect(text).toMatch(/outil_59 Succès\s+1058 ms/);
  });

  it("given no logged call, when I open the page, then I read « Aucun appel enregistré »", async () => {
    expect(textOf(await renderPage())).toContain("Aucun appel enregistré");
  });
});

describe("criterion 2 — date and result of the last prices job run", () => {
  it("given no run, when I open the page, then I read « Aucune exécution enregistrée »", async () => {
    expect(textOf(await renderPage())).toContain("Aucune exécution enregistrée");
  });

  it("given two runs, when I open the page, then I see the date (Paris time) and result of the latest only", async () => {
    await runJob(MONDAY, ["^FCHI", "GC=F", "BZ=F"]);
    const second = await runJob(TUESDAY, ["BZ=F"]);
    const text = textOf(await renderPage());

    expect(text).toMatch(/Tâche des cours/);
    expect(text).toContain("24/11/2026 08:00");
    expect(text).not.toContain("23/11/2026 08:00");
    expect(text).toContain(`${second.updated.length} mis à jour, 1 en échec`);
  });
});

describe("criterion 3 — the symbols in error at the last run", () => {
  it("given a symbol failing at the last run, when I open the page, then it is listed with its message", async () => {
    await runJob(MONDAY, ["GC=F"]);
    await runJob(TUESDAY, ["BZ=F"]);
    const text = textOf(await renderPage());

    expect(text).toContain("BZ=F");
    expect(text).toContain("boom BZ=F");
    expect(text).not.toContain("GC=F");
    expect(text).not.toContain("Aucun symbole en erreur");
  });

  it("given a last run without failure, when I open the page, then I read « Aucun symbole en erreur » and no earlier failure", async () => {
    await runJob(MONDAY, ["GC=F"]);
    await runJob(TUESDAY);
    const text = textOf(await renderPage());

    expect(text).toContain("Aucun symbole en erreur");
    expect(text).not.toContain("GC=F");
  });
});
