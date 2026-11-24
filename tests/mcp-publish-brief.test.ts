// US #13 — the Claude scheduled task publishes the brief through the `publish_brief` MCP tool
// (C54 to C58), so that it shows up in the app with no manual step.
//
// Integration tests with the official SDK client routed into the production route handler
// (`src/app/api/mcp/route.ts`, see tests/helpers/mcp.ts): what Claude's connector really calls.
//
// Contract:
// - The production registry (`src/lib/mcp/tools/index.ts`) serves a tool named `publish_brief`
//   taking `{ date, kind, payload, dry_run? }` (CLAUDE.md §7):
//   - `date`: "YYYY-MM-DD", a real calendar date; `kind`: "daily" | "weekly";
//   - `payload`: tldr (max 400), mood (appetit_risque | aversion_risque | mitige), news (1 to 5
//     items: title max 120, summary max 600, whyItMatters max 400, impact max 300, category in
//     the CLAUDE.md enum, tickers string[] defaulting to [], sourceName, sourceUrl). Strict
//     objects: unknown keys (concept, storylineUpdates, ...) are rejected.
//     Required text fields must not be blank; sourceUrl is an absolute http(s) URL;
//   - `dry_run`: optional, false when absent.
//   Its input schema is listed by tools/list, so Claude sees the whole contract.
// - Invalid arguments: an `isError` result whose text lists every issue at once, one
//   "<path> : <message>" per issue, the path dot-joined from the tool arguments
//   (e.g. `payload.news.0.title`). Nothing is written to `briefs` / `news_items`.
// - Success: a short text for Claude plus `structuredContent` with
//   `{ dryRun, date, kind, newsCount }`, and `briefId` (the `briefs.id` written) when not a dry run.
// - Publication: one row in `briefs` per (date, kind) with status "published", `published_at`
//   set, tldr, mood and `raw_payload` = the payload exactly as received, as JSON text; one row in
//   `news_items` per news item, `rank` following the payload order, `tickers` as JSON text.
// - Republishing the same (date, kind) updates that brief row in place (same id) and replaces its
//   news items, in one transaction: a failure in the middle leaves the previous brief intact.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boundaryPayload,
  invalidCases,
  newsItem,
  otherValidPayload,
  payloadWithSeveralErrors,
  validPayload,
  type Json,
  type JsonObject,
} from "./fixtures/brief-payloads";
import {
  countBriefRows,
  failNewsItemInsertsTitled,
  readBriefs,
  readNewsItems,
  SIMULATED_FAILURE,
} from "./helpers/briefs";
import { connectClient, dispatch, makeMigratedDatabase, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

const DATE = "2026-11-20";

let databasePath: string;
const clients: Client[] = [];

beforeEach(() => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
  vi.resetModules();
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** An SDK client connected to the production /api/mcp route. */
async function connect(): Promise<Client> {
  const route = (await import("../src/app/api/mcp/route")) as unknown as RouteModule;
  const client = await connectClient((request) => dispatch(route, request), MCP_TEST_TOKEN);
  clients.push(client);
  return client;
}

function publish(client: Client, args: Record<string, Json | undefined>): Promise<ToolResult> {
  return client.callTool({ name: "publish_brief", arguments: args });
}

function resultText(result: ToolResult): string {
  const content = (result.content ?? []) as { type: string; text?: string }[];
  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The error text reports `path` as one "<path> : <message>" line with a non-empty message. */
function expectIssueAt(text: string, path: string): void {
  const line = new RegExp(`(^|\\n)[\\s\\-*•]*${escapeRegExp(path)}\\s*:\\s*\\S`);
  expect(text, `expected an error line for "${path}" in:\n${text}`).toMatch(line);
}

function expectSuccess(result: ToolResult): void {
  expect(result.isError, `publish_brief failed:\n${resultText(result)}`).not.toBe(true);
  expect(resultText(result).trim().length).toBeGreaterThan(0);
}

function toMillis(value: unknown): number {
  return typeof value === "number" ? value : Date.parse(String(value));
}

describe("C54 — a dry run of a valid payload answers OK and writes nothing", () => {
  it("C54 — given the MCP endpoint, when Claude lists the tools, then publish_brief is listed with its whole input contract", async () => {
    const client = await connect();

    const { tools } = await client.listTools();

    const tool = tools.find((candidate) => candidate.name === "publish_brief");
    expect(tool, `tools listed: ${tools.map((candidate) => candidate.name).join(", ") || "(none)"}`).toBeDefined();
    expect(tool?.description?.trim().length).toBeGreaterThan(0);
    const schema = tool?.inputSchema as {
      properties: Record<string, { properties?: Record<string, unknown>; additionalProperties?: unknown }>;
      required?: string[];
    };
    expect(Object.keys(schema.properties).sort()).toEqual(["date", "dry_run", "kind", "payload"]);
    expect([...(schema.required ?? [])].sort()).toEqual(["date", "kind", "payload"]);
    const payload = schema.properties.payload;
    expect(Object.keys(payload.properties ?? {}).sort()).toEqual(["mood", "news", "stockNotes", "tldr"]);
    expect(payload.additionalProperties).toBe(false);
    const news = payload.properties?.news as { items?: { properties?: Record<string, unknown>; additionalProperties?: unknown } };
    expect(Object.keys(news.items?.properties ?? {}).sort()).toEqual(
      ["category", "chart", "impact", "sourceName", "sourceUrl", "summary", "tickers", "title", "whyItMatters"].sort(),
    );
    expect(news.items?.additionalProperties).toBe(false);
    const notes = payload.properties?.stockNotes as { items?: { properties?: Record<string, unknown>; additionalProperties?: unknown } };
    expect(Object.keys(notes.items?.properties ?? {}).sort()).toEqual(["newsRefs", "nextEvent", "reason", "summary", "symbol"]);
    expect(notes.items?.additionalProperties).toBe(false);
  });

  it("C54 — given a valid payload and dry_run = true, when I call publish_brief, then it answers OK and no brief nor news item is written", async () => {
    const client = await connect();

    const result = await publish(client, { date: DATE, kind: "daily", payload: validPayload(), dry_run: true });

    expectSuccess(result);
    expect(result.structuredContent).toMatchObject({ dryRun: true, date: DATE, kind: "daily", newsCount: 3 });
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("C54 — given a valid payload at every limit (max lengths, 5 news items) and dry_run = true, when I call publish_brief, then it answers OK and nothing is written", async () => {
    const client = await connect();

    const result = await publish(client, { date: DATE, kind: "weekly", payload: boundaryPayload(), dry_run: true });

    expectSuccess(result);
    expect(result.structuredContent).toMatchObject({ dryRun: true, date: DATE, kind: "weekly", newsCount: 5 });
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("C54 — given a brief already published for the date and a dry run of another payload, when I call publish_brief, then the published brief is left untouched", async () => {
    const client = await connect();
    expectSuccess(await publish(client, { date: DATE, kind: "daily", payload: validPayload() }));
    const briefsBefore = readBriefs(databasePath);
    const newsBefore = readNewsItems(databasePath);

    const result = await publish(client, { date: DATE, kind: "daily", payload: otherValidPayload(), dry_run: true });

    expectSuccess(result);
    expect(result.structuredContent).toMatchObject({ dryRun: true, newsCount: 2 });
    expect(readBriefs(databasePath)).toEqual(briefsBefore);
    expect(readNewsItems(databasePath)).toEqual(newsBefore);
  });
});

describe("C55 — an invalid payload returns the list of errors (path + message) and writes nothing", () => {
  it.each(invalidCases().map((invalid) => [invalid.name, invalid] as const))(
    "C55 — given a payload with %s, when I call publish_brief, then the error names its field path and nothing is written",
    async (_name, invalid) => {
      const client = await connect();

      const result = await publish(client, { date: DATE, kind: "daily", payload: invalid.payload });

      expect(result.isError).toBe(true);
      const text = resultText(result);
      expectIssueAt(text, invalid.path ? `payload.${invalid.path}` : "payload");
      if (invalid.mentions) expect(text).toContain(invalid.mentions);
      expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
    },
  );

  it.each([
    ["a month 13", { date: "2026-13-01" }, "date"],
    ["a day that does not exist (Feb 30)", { date: "2026-02-30" }, "date"],
    ["a French-formatted date", { date: "20/11/2026" }, "date"],
    ["a date-time instead of a date", { date: "2026-11-20T07:00:00Z" }, "date"],
    ["no date", { date: undefined }, "date"],
    ["an unknown kind", { kind: "monthly" }, "kind"],
    ["no kind", { kind: undefined }, "kind"],
    ["no payload", { payload: undefined }, "payload"],
  ] as const)(
    "C55 — given %s, when I call publish_brief, then the error names that argument and nothing is written",
    async (_name, override, path) => {
      const client = await connect();
      const args: Record<string, Json | undefined> = { date: DATE, kind: "daily", payload: validPayload(), ...override };
      for (const key of Object.keys(args)) if (args[key] === undefined) delete args[key];

      const result = await publish(client, args);

      expect(result.isError).toBe(true);
      expectIssueAt(resultText(result), path);
      expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
    },
  );

  it("C55 — given a payload with several errors, when I call publish_brief, then every error comes back at once with its path", async () => {
    const client = await connect();
    const { payload, paths } = payloadWithSeveralErrors();

    const result = await publish(client, { date: "2026-02-30", kind: "monthly", payload });

    expect(result.isError).toBe(true);
    const text = resultText(result);
    for (const path of ["date", "kind", ...paths.map((path) => `payload.${path}`)]) expectIssueAt(text, path);
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("C55 — given an invalid payload and dry_run = true, when I call publish_brief, then the dry run reports the same errors", async () => {
    const client = await connect();
    const { payload, paths } = payloadWithSeveralErrors();

    const result = await publish(client, { date: DATE, kind: "daily", payload, dry_run: true });

    expect(result.isError).toBe(true);
    const text = resultText(result);
    for (const path of paths) expectIssueAt(text, `payload.${path}`);
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("C55 — given a brief already published and an invalid republication, when I call publish_brief, then the published brief is left untouched", async () => {
    const client = await connect();
    expectSuccess(await publish(client, { date: DATE, kind: "daily", payload: validPayload() }));
    const briefsBefore = readBriefs(databasePath);
    const newsBefore = readNewsItems(databasePath);
    const { payload } = payloadWithSeveralErrors();

    const result = await publish(client, { date: DATE, kind: "daily", payload });

    expect(result.isError).toBe(true);
    expectIssueAt(resultText(result), "payload.tldr");
    expect(readBriefs(databasePath)).toEqual(briefsBefore);
    expect(readNewsItems(databasePath)).toEqual(newsBefore);
  });
});

describe("C56 — a valid payload is published with its news items and its raw JSON", () => {
  it("C56 — given a valid payload, when I publish it, then the brief is published with its tldr, mood, published_at and the raw JSON as received", async () => {
    const client = await connect();
    const payload = validPayload();

    const result = await publish(client, { date: DATE, kind: "daily", payload });

    expectSuccess(result);
    const briefs = readBriefs(databasePath);
    expect(briefs).toHaveLength(1);
    const [brief] = briefs;
    expect(brief).toMatchObject({ date: DATE, kind: "daily", status: "published", tldr: payload.tldr, mood: payload.mood });
    expect(brief.published_at).not.toBeNull();
    expect(Number.isNaN(toMillis(brief.published_at))).toBe(false);
    // Exactly as received: the third news item has no `tickers`, the stored JSON must not gain one.
    expect(typeof brief.raw_payload).toBe("string");
    expect(JSON.parse(brief.raw_payload)).toStrictEqual(payload);
    expect(result.structuredContent).toMatchObject({ dryRun: false, briefId: brief.id, date: DATE, kind: "daily", newsCount: 3 });
  });

  it("C56 — given a valid payload, when I publish it, then its news items are stored with every field, in the payload order", async () => {
    const client = await connect();
    const payload = validPayload();
    const sent = payload.news as JsonObject[];

    expectSuccess(await publish(client, { date: DATE, kind: "daily", payload, dry_run: false }));

    const [brief] = readBriefs(databasePath);
    const items = readNewsItems(databasePath);
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.brief_id === brief.id)).toBe(true);
    const ranks = items.map((item) => item.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(new Set(ranks).size).toBe(3);
    expect(
      items.map((item) => ({
        title: item.title,
        summary: item.summary,
        whyItMatters: item.why_it_matters,
        impact: item.impact,
        category: item.category,
        tickers: JSON.parse(item.tickers) as unknown,
        sourceName: item.source_name,
        sourceUrl: item.source_url,
      })),
    ).toEqual(sent.map((news) => ({ tickers: [], ...news })));
  });

  it("C56 — given a payload with Markdown text, when I publish it, then the Markdown is stored as received", async () => {
    const client = await connect();
    const payload = validPayload();
    const markdown = "Le CAC 40 gagne **1,2 %**.\n\n- point un\n- point deux\n\nSource : [AMF](https://www.amf-france.org/)";
    (payload.news as JsonObject[])[0] = newsItem({ summary: markdown });

    expectSuccess(await publish(client, { date: DATE, kind: "daily", payload }));

    expect(readNewsItems(databasePath)[0].summary).toBe(markdown);
  });
});

describe("C57 — republishing the same date and kind replaces the brief, only one brief exists", () => {
  it("C57 — given a brief already published for the date and kind, when I republish other content, then the same brief row holds the new content and only one brief exists", async () => {
    const client = await connect();
    const first = await publish(client, { date: DATE, kind: "daily", payload: validPayload() });
    expectSuccess(first);
    const [before] = readBriefs(databasePath);
    const replacement = otherValidPayload();

    const second = await publish(client, { date: DATE, kind: "daily", payload: replacement, dry_run: false });

    expectSuccess(second);
    const briefs = readBriefs(databasePath);
    expect(briefs).toHaveLength(1);
    const [after] = briefs;
    expect(after.id).toBe(before.id);
    expect(after).toMatchObject({ date: DATE, kind: "daily", status: "published", tldr: replacement.tldr, mood: replacement.mood });
    expect(JSON.parse(after.raw_payload)).toStrictEqual(replacement);
    expect(after.published_at).not.toBeNull();
    expect(toMillis(after.published_at)).toBeGreaterThanOrEqual(toMillis(before.published_at));
    expect(second.structuredContent).toMatchObject({ dryRun: false, briefId: before.id, newsCount: 2 });
    expect(first.structuredContent).toMatchObject({ briefId: before.id });
  });

  it("C57 — given a brief already published, when I republish it, then its old news items are gone and only the new ones remain", async () => {
    const client = await connect();
    expectSuccess(await publish(client, { date: DATE, kind: "daily", payload: validPayload() }));
    const replacement = otherValidPayload();

    expectSuccess(await publish(client, { date: DATE, kind: "daily", payload: replacement }));

    const [brief] = readBriefs(databasePath);
    const items = readNewsItems(databasePath);
    expect(items.map((item) => item.title)).toEqual((replacement.news as JsonObject[]).map((news) => news.title));
    expect(items.every((item) => item.brief_id === brief.id)).toBe(true);
  });

  it("C57 — given the same payload published three times, when I count, then one brief with its news items exists, not three", async () => {
    const client = await connect();

    for (let run = 0; run < 3; run += 1) {
      expectSuccess(await publish(client, { date: DATE, kind: "daily", payload: validPayload() }));
    }

    expect(countBriefRows(databasePath)).toEqual({ briefs: 1, newsItems: 3 });
  });

  it("C57 — given a daily brief for a date, when I publish the weekly one or another date, then each is a separate brief and the daily one is untouched", async () => {
    const client = await connect();
    expectSuccess(await publish(client, { date: DATE, kind: "daily", payload: validPayload() }));
    const [daily] = readBriefs(databasePath);
    const dailyNews = readNewsItems(databasePath);

    expectSuccess(await publish(client, { date: DATE, kind: "weekly", payload: otherValidPayload() }));
    expectSuccess(await publish(client, { date: "2026-11-19", kind: "daily", payload: otherValidPayload() }));

    const briefs = readBriefs(databasePath);
    expect(briefs.map((brief) => [brief.date, brief.kind]).sort()).toEqual([
      ["2026-11-19", "daily"],
      [DATE, "daily"],
      [DATE, "weekly"],
    ]);
    expect(briefs.find((brief) => brief.id === daily.id)).toEqual(daily);
    expect(readNewsItems(databasePath).filter((item) => item.brief_id === daily.id)).toEqual(dailyNews);
    expect(countBriefRows(databasePath)).toEqual({ briefs: 3, newsItems: 7 });
  });
});

describe("C58 — an error in the middle of the write rolls the transaction back", () => {
  // Only an insert of this title fails (trigger installed before the app opens the database),
  // so the first, valid publication of a test goes through.
  const MARKER = "Titre qui fait échouer l'écriture";

  it("C58 — given a published brief and a failure while writing the news items of its republication, when it happens, then the old brief and its news items stay intact", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failNewsItemInsertsTitled(databasePath, MARKER);
    const client = await connect();
    expectSuccess(await publish(client, { date: DATE, kind: "daily", payload: validPayload() }));
    const briefsBefore = readBriefs(databasePath);
    const newsBefore = readNewsItems(databasePath);
    const failing = otherValidPayload();
    // Second item: the brief row and the first news item are already written when it fails.
    (failing.news as JsonObject[])[1].title = MARKER;

    const result = await publish(client, { date: DATE, kind: "daily", payload: failing });

    expect(result.isError).toBe(true);
    expect(resultText(result)).not.toContain(SIMULATED_FAILURE);
    expect(readBriefs(databasePath)).toEqual(briefsBefore);
    expect(readNewsItems(databasePath)).toEqual(newsBefore);
  });

  it("C58 — given a rolled-back republication, when I republish without the failure, then the brief is replaced normally", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failNewsItemInsertsTitled(databasePath, MARKER);
    const client = await connect();
    expectSuccess(await publish(client, { date: DATE, kind: "daily", payload: validPayload() }));
    const [before] = readBriefs(databasePath);
    const failing = otherValidPayload();
    (failing.news as JsonObject[])[1].title = MARKER;
    expect((await publish(client, { date: DATE, kind: "daily", payload: failing })).isError).toBe(true);
    const replacement = otherValidPayload();

    expectSuccess(await publish(client, { date: DATE, kind: "daily", payload: replacement }));

    const briefs = readBriefs(databasePath);
    expect(briefs).toHaveLength(1);
    expect(briefs[0].id).toBe(before.id);
    expect(briefs[0].tldr).toBe(replacement.tldr);
    expect(readNewsItems(databasePath).map((item) => item.title)).toEqual(
      (replacement.news as JsonObject[]).map((news) => news.title),
    );
  });

  it("C58 — given no brief yet and a failure while writing the news items of the first publication, when it happens, then no half-written brief is left", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failNewsItemInsertsTitled(databasePath, MARKER);
    const client = await connect();
    const failing = validPayload();
    (failing.news as JsonObject[])[2].title = MARKER;

    const result = await publish(client, { date: DATE, kind: "daily", payload: failing });

    expect(result.isError).toBe(true);
    expect(resultText(result)).not.toContain(SIMULATED_FAILURE);
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });
});
