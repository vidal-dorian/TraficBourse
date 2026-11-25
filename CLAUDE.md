# HANDOFF — Daily markets brief web app

> Handoff for Claude Code. Source of truth: Dorian's scoping doc "Cadrage — Web app de veille boursière quotidienne" (Nov 18, 2026). This file is meant to live at the repo root (copy the relevant parts into `CLAUDE.md` once the repo exists).
> Code, comments and commits in English. **Everything a visitor sees is in French.**

---

## 1. What we are building

A small self-hosted web app on Dorian's Raspberry Pi that shows a **daily markets brief** (news, market moves, one concept to learn) for a beginner investor in France.

- Every weekday at ~07:00 Europe/Paris, a **Claude scheduled task** (claude.ai, not this repo) researches the news and **writes the brief into the app through an MCP connector the app exposes**.
- On Saturday morning, the same mechanism produces a **weekly recap**.
- The app **owns all numbers** (prices, variations, charts) via its own market-data job. Claude only writes text and references data; it never supplies chart values.
- **Single owner, public read-only site.** Anyone can read the brief (same content for everyone). Only Dorian manages the watchlist, under `/admin`.

### Non-negotiable principles

1. **Numbers come from the app, not from Claude.** A job on the Pi fetches closing prices from a market-data API and stores them. Claude reads them through MCP (`get_market_snapshot`) before writing, so the text matches the charts.
2. **Claude sends structured content, never HTML.** A Zod schema defines a brief; the app alone decides how it renders. Text fields are Markdown, rendered sanitized (no raw HTML, ever).
3. **One atomic, idempotent publication per date and kind.** Re-running the task replaces that day's brief in a single transaction: no duplicates, no half-written state.
4. **Teach, don't advise.** Each brief explains "why it matters", follows storylines and advances a learning path. No buy/sell/hold recommendations, no price targets. A visible "contenu éducatif, pas un conseil en investissement" notice on every page.
5. **No article images.** Each news item carries a category; the app shows a category illustration (static file in the repo) and, when relevant, a company logo. Nothing image-related is downloaded or stored.

---

## 2. Daily flow

| Time (Europe/Paris) | Actor | What happens |
| --- | --- | --- |
| 06:30 daily | `jobs` container | Fetch previous closes for all instruments, compute variations (1D, 1W, 1M, YTD), flag watchlist moves |
| ~07:00 Mon–Fri | Claude scheduled task | Reads context via MCP, searches the web, calls `publish_brief` (`kind = daily`) |
| ~09:00 Sat | Claude scheduled task | Same, `kind = weekly` (week in 5 points + a note for **every** watchlist stock) |
| 08:00 Mon–Fri / 10:00 Sat | `web` (request time) | Built (US #27): if no brief is published for today, the home page shows a "brief manquant" banner, computed at each request (no job). The notification is a future `jobs` task (phase 4) |
| 03:00 daily | `jobs` container | `sqlite3 .backup` to the NAS mount |

Watchlist rule:
- **Daily brief:** a stock note only for watchlist stocks that moved that day — variation ≥ 2 %, earnings published (flagged by the app), or a relevant news item (added by Claude). Others are hidden.
- **Weekly recap:** a stock note for **every** watchlist stock (weekly variation + highlights), so each stock is covered at least once a week.

---

## 3. Architecture

```
Claude scheduled task ──MCP (auth)──┐
Visitors (read-only) ──HTTPS────────┤
Dorian /admin ──Cloudflare Access───┤
                                     ▼
                     Cloudflare Tunnel → Caddy (on the Pi)
                                     ▼
          ┌──────────────── Docker Compose ────────────────┐
          │  web   : Next.js (pages + /api/mcp + /admin)   │
          │  jobs  : node-cron (prices, backup; phase 4:   │
          │          missing-brief notify) — same image    │
          │  volume: /mnt/data/bourse → SQLite (WAL)       │
          └────────────────────────────────────────────────┘
                 jobs → market-data API (Yahoo / Twelve Data)
                 jobs → NAS (nightly backup)
```

Only two inbound flows: visitors/Dorian through Cloudflare, Claude through `/api/mcp`. The prices job is the only component calling an external API.

---

## 4. Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Front + API | Next.js 15 (App Router), TypeScript, Tailwind, `output: "standalone"` | Server components for the brief pages |
| MCP server | Official `@modelcontextprotocol/sdk` (TypeScript), Streamable HTTP, route `/api/mcp`, **stateless** | Check the SDK's current docs for mounting inside a Next.js route handler (Web `Request`/`Response`). If it fights the framework, extract it into a small Hono service in the same repo — same schemas, same DB. |
| DB | SQLite (WAL) + Drizzle ORM + drizzle-kit migrations | `better-sqlite3`. Two processes (web, jobs) share the file: WAL + busy timeout |
| Validation | Zod, shared by MCP tools, server code and forms | One contract for everything Claude sends |
| Charts | TradingView Lightweight Charts (prices), Recharts (anything else) | Client components fed by server data. Built: `src/components/price-chart.tsx` (Lightweight Charts 5.3.0, US #22); Recharts not used yet |
| Market data | `yahoo-finance2` behind a `MarketDataProvider` interface; Twelve Data free tier as fallback (built, US #19: used per instrument through `fallback_symbol`, only when Yahoo fails) | Yahoo is unofficial and may break: keep the provider swappable. Twelve Data's free tier only covers US equities, forex and crypto |
| Jobs | `node-cron` in a `jobs` container (same image, different entrypoint) | Timezone `Europe/Paris` explicitly |
| Notifications (phase 4) | Self-hosted ntfy, or Web Push via PWA | — |
| Tests | Vitest | See §10 |
| CI/CD | GitHub Actions → buildx `linux/arm64` → GHCR; the Pi pulls and restarts | **The agent never deploys.** |

---

## 5. Suggested repo layout

```
/src
  /app
    /(public)/page.tsx            → "Aujourd'hui" (latest brief)
    /(public)/brief/[date]/page.tsx
    /(public)/archives/page.tsx
    /(public)/marches/page.tsx    → instruments + charts (built, US #19/#23, without the `(public)` group)
    /(public)/apprendre/page.tsx  → concepts / learning path (phase 3)
    /(public)/fils-rouges/page.tsx (phase 3)
    /(public)/agenda/page.tsx     (phase 3)
    /admin/...                    → watchlist, status (MCP audit, prices job; built), instruments
    /api/mcp/route.ts             → MCP endpoint
    /api/health/route.ts
  /lib
    /auth       cloudflare-access.ts (Access JWT check for /admin)
    /db         schema.ts, client.ts, migrate.ts, migrations/
    /schemas    brief.ts (Zod), chart-spec.ts, ...
    /mcp        server.ts, tools/*.ts, auth.ts
    /market     provider.ts, yahoo.ts, twelvedata.ts, snapshot.ts
    /render     markdown.tsx (sanitized)
  middleware.ts → Access check, matcher `/admin` and `/admin/:path*` only
  /jobs         index.ts (cron entrypoint), prices.ts, backup.ts (phase 4: missing-brief notification)
/public/illustrations/<category>.svg
/docs          mise-en-service.md (setup guide), prompt-tache-planifiee.md (prompt in force)
/tests
Dockerfile, docker-compose.yml, .env.example
```

Implemented today (US #15, US #16): the home page "Aujourd'hui" is `src/app/page.tsx`, the archives `src/app/archives/page.tsx` (by month, newest first) and the brief of a date `src/app/brief/[date]/page.tsx` (no `(public)` group yet), fed by `src/lib/briefs/latest.ts` (latest `published` brief dated up to Paris today, weekly before daily) and `src/lib/briefs/archives.ts` (same rule); the home page and the brief of a date are rendered by `src/lib/render/brief.tsx`, with the market tiles of US #21 (`src/lib/render/market-tiles.tsx`, see §6) between the TL;DR and the news, then the « Ma watchlist » section of US #26 (stock notes, see §6) when the brief has notes. An invalid date or a date without a published brief gets the French 404 `src/app/not-found.tsx` (link to the archives), as does any unknown URL; no `loading.tsx` or Suspense on the brief page, it would turn that 404 into a 200 (see `README.md`). The root layout links "Aujourd'hui" and "Archives" on every page. Text fields go through `src/lib/render/markdown.tsx`, a hand-written sanitized subset (paragraphs, lists, bold, italic, links; React elements only, raw HTML shown as text, links only to absolute http(s) URLs without user info, new tab + `rel="noopener noreferrer"`). A minimal public page `src/app/marches/page.tsx` ("Marchés", US #19, #23) lists every instrument with its last known close and its variations 1 j / 1 sem / 1 mois / depuis janvier (`getMarketOverview` of `src/lib/market/overview.ts`: closes up to Paris today, variations equal to `computeVariations` on the full history, 2 + N queries, sorted by name `fr`; shown with `variationLabel` of `src/lib/render/market-tiles.tsx`; formatting in `src/lib/market/format.ts`, `isStale` of `src/lib/market/latest.ts`): « au JJ/MM » is shown when the latest close is older than the last finished session (previous day for crypto, previous weekday otherwise; holidays are not modelled, so they show the mention), « Pas encore de cours » when there is none; linked from the root layout. Each name links to `/marches?instrument=<symbol>`: the selected row (`aria-current="true"`) opens a section with the name as `<h2>`, range links « 1M », « 3M », « Depuis janvier », « 1 an » (`plage` `1M` default | `3M` | `YTD` | `1Y`, invalid → `1M`, unknown instrument → no chart) and a `ChartFigure` (exported from `src/lib/render/brief.tsx`) fed by `loadChartData` with `normalize` false up to Paris today; `getLatestCloses` is no longer used by a page. Under a news item that has a chart spec (US #22), `ChartFigure` of `src/lib/render/brief.tsx` shows a `<figure>` after « Impact possible »: the curves (`src/components/price-chart.tsx`, client component, `lightweight-charts` 5.3.0, series titles as legend, French number format, TradingView attribution logo kept), a French caption (names, range, « base 100 » when normalized) and an `sr-only` table (dates `JJ/MM/AAAA`) for screen readers; « Pas encore de cours pour ce graphique. » when no symbol has a close. The series come from `src/lib/market/chart.ts` (`loadChartData`, passed by `newsOf` in `src/lib/briefs/latest.ts`). Admin watchlist (US #24): `src/app/admin/watchlist/page.tsx` (`/admin/watchlist`, linked from `/admin`, rendered per request, noindex). GET `?q=` searches by name or symbol (trimmed, capped at 100 characters, only `stock` and `etf` results kept, `ADDABLE_TYPES`): each result shows « Ajouter » or « Déjà suivie »; the followed list (`listWatchlist`, by name `fr`) shows « Retirer »; the last action's feedback comes as `?status=` and only known codes show a French message (`role="status"`, or `role="alert"` on a failure). The search is a port, `InstrumentSearchProvider` (`src/lib/market/search.ts`, with `CurrencyLookup`), implemented by `src/lib/market/yahoo-search.ts` (`search` of `yahoo-finance2`, Yahoo `quoteType` mapped to the instrument types; `currency` empty in a result; `createYahooCurrencyLookup` reads the currency from Yahoo's `quote`, as Yahoo writes it, and rejects when absent). Domain `src/lib/watchlist/watchlist.ts`: `addToWatchlist` upserts the instrument (`symbol` = `provider_symbol` = Yahoo symbol; an existing instrument keeps its data, only `in_watchlist` is set) then stores one year of bars (Paris today minus 12 months) with `storeFinishedBars` (`src/lib/market/store-bars.ts`, the storing rules now shared with the prices job: bars dated before Paris today, upsert on (`symbol`, `date`)); if the bars fail the stock stays followed (`HistoryFetchError`, the prices job fills it later). `removeFromWatchlist` only clears `in_watchlist`: the instrument and its history stay. Entry points `src/lib/watchlist/owner-actions.ts` (`addStockAsOwner`, `removeStockAsOwner`, called by the server actions of `src/app/admin/watchlist/actions.ts`, thin wrappers that redirect with `?status=`): each re-checks Cloudflare Access (same rules as the middleware, fail closed, `ADMIN_AUTH_DISABLED` honoured outside production) before any call or write, because a server action can be POSTed to any path, where the middleware does not run. On add the form fields are not trusted: the symbol and fields are validated, the result is re-resolved through the search (name, type and exchange replaced by what Yahoo says; `not_found` if absent or not a stock/ETF), and the currency comes from the lookup (none, or a failed lookup, refuses the add). Failure reasons: `forbidden`, `invalid`, `not_found`, `search_failed`, `currency_failed`, `write_failed`, `history_failed` (add); `forbidden`, `invalid`, `not_found` (remove). Minor-unit currencies (`GBp`, `GBX`, `ZAc`) are not ISO codes: `formatClose` shows the plain number with the code instead of a currency amount 100 times too high. A removed stock stays an instrument: it keeps its tile, its `/marches` row, its `get_market_snapshot` entry and its prices-job updates (none of them filters on `in_watchlist`). Missing-brief banner (US #27): `src/app/page.tsx` shows a `<p role="status">` first in `<main>` (also above the empty state) when `expectedBriefMissing(db, now)` (`src/lib/briefs/missing.ts`, one query on the `published` briefs dated Paris today; a draft does not count) returns a kind: Monday to Friday from 08:00 Paris without a published daily → « Le brief du jour n'est pas encore arrivé »; Saturday from 10:00 without a published weekly → « Le récap de la semaine n'est pas encore arrivé » (`MISSING_BRIEF_MESSAGES`); never on Sunday or before those hours. The pure rule is `missingBriefAt(now, { daily, weekly })`, the Paris weekday and hour come from `parisWeekdayAndHour` (`src/lib/dates/paris.ts`). Holidays are not modelled (the banner shows on a bank holiday). No job is involved: the notification on the `jobs` side stays phase 4. Admin status (US #28): `src/app/admin/status/page.tsx` (`/admin/status`, linked from `/admin`, per request, noindex, behind the middleware like the other admin pages): first « Tâche des cours » (last `job_runs` row: Paris date and time, number updated, failed symbols with their message, « Aucune exécution enregistrée » when none), then « Derniers appels MCP » (table of the 50 latest `mcp_audit` rows, newest first: tool, « Succès »/« Échec », error, duration, « Aucun appel enregistré » when empty). Data: `getAdminStatus(db)` (`src/lib/admin/status.ts`, `STATUS_CALLS_LIMIT` 50, two queries). One illustration per category in `/public/illustrations`. Details in `README.md`.

---

## 6. Data model (12 tables)

| Table | Purpose | Key fields |
| --- | --- | --- |
| `briefs` | One brief per date and kind | `date`, `kind` (daily / weekly), `status` (draft / published), `tldr`, `mood`, `raw_payload` (JSON as received), `published_at` — unique (`date`, `kind`) |
| `news_items` | News items of a brief | `brief_id`, `rank`, `title`, `summary`, `why_it_matters`, `impact`, `category`, `tickers` (JSON), `source_name`, `source_url`, `chart_spec` (JSON) |
| `instruments` | Tracked universe | `symbol`, `provider_symbol`, `name`, `type` (index, ETF, stock, fx, crypto, commodity), `exchange`, `currency`, `in_watchlist`, `fallback_symbol`, `last_earnings_date` |
| `stock_notes` | Per-stock note in a brief | `brief_id`, `symbol`, `reason` (move / earnings / news / weekly), `summary`, `news_refs` (JSON), `next_event` |
| `prices_daily` | Closing history | `symbol`, `date`, `open`, `high`, `low`, `close`, `volume` — PK (`symbol`, `date`) |
| `concepts` | Learning path (seeded, ~60 concepts, basics → advanced) | `slug`, `title`, `level` (1–3), `order`, `body_md`, `analogy`, `example`, `seen_in_brief_id` |
| `storylines` | Ongoing stories | `slug`, `title`, `status` (active / closed), `summary` |
| `storyline_updates` | Episodes of a storyline | `storyline_id`, `brief_id`, `text` |
| `calendar_events` | Agenda | `date`, `time`, `type`, `title`, `importance`, `region` — dedup on (`date`, `title`) |
| `quiz_questions` | Phase 4 | `brief_id`, `question`, `options`, `answer`, `explanation` |
| `mcp_audit` | MCP call log | `tool`, `ok`, `error`, `duration_ms`, `at` |
| `job_runs` | One row per prices job run (US #28) | `at`, `updated_count`, `failed` (JSON `{symbol, error}[]`) |

Keep `raw_payload` so a brief can be re-rendered after a design change.

Default instruments to seed (verify each Yahoo symbol before committing): CAC 40 `^FCHI`, Euro Stoxx 50 `^STOXX50E`, S&P 500 `^GSPC`, Nasdaq 100 `^NDX`, an MSCI World ETF (e.g. `IWDA.AS`), EUR/USD `EURUSD=X`, gold `GC=F`, Brent `BZ=F`, BTC `BTC-EUR`. Watchlist stocks: ask Dorian.

Prices (US #18): the `jobs` container runs the prices job (`src/jobs/prices.ts`, schedule `30 6 * * *` Europe/Paris in `src/jobs/schedule.ts`) through the `MarketDataProvider` interface (`src/lib/market/provider.ts`, implemented by `src/lib/market/yahoo.ts` with `yahoo-finance2`). Tables `instruments` and `prices_daily` (migration 0004); the nine default instruments of this section are seeded by migration 0005, none in the watchlist (the owner adds stocks from `/admin/watchlist`, US #24, see §5). First run: one year; later runs restart from the last stored date, inclusive; upsert on (`symbol`, `date`); bars dated Paris today are not stored; a failing symbol is logged and the others go on. The Yahoo symbols were not verified live: check them on the Pi after deploy. Fallback (US #19): `src/lib/market/twelvedata.ts` (Twelve Data, `MarketDataProvider` named `twelvedata`, requests spaced 8 s for the free tier's 8 calls/min); migration 0006 adds the nullable `instruments.fallback_symbol` (the Twelve Data symbol, null = not covered; seeded `EUR/USD` for `EURUSD=X`, `BTC/EUR` for `BTC-EUR`). When Yahoo throws for an instrument with a `fallback_symbol`, `runPricesJob` asks the `fallback` provider (built in `src/jobs/index.ts` when env `TWELVE_DATA_API_KEY` is set) for the same period with the same rules; `updated` entries carry the `source`. Snapshot (US #20): `get_market_snapshot({date?})` (`src/lib/mcp/tools/get-market-snapshot.ts`, read-only, `date` defaults to Paris today, later closes ignored) returns `structuredContent` `{ date, instruments }`, sorted by name, each `{ symbol, name, type, currency, lastClose, lastCloseDate, stale, variations: { day, week, month, ytd } }` plus a French text (« (cours ancien) » when stale, « Pas encore de cours » when none). `computeVariations` (`src/lib/market/snapshot.ts`, pure): percentages rounded to 2 decimals; day = previous stored close, week = last close on or before last close date − 7 days, month = same day one calendar month earlier (day clamped), ytd = last close on or before 31 December of the previous year; `null` when the reference is missing or 0. `stale` reuses `isStale` of `src/lib/market/latest.ts`. Market tiles (US #21): on the home page and `/brief/[date]`, `MarketTiles` (`src/lib/render/market-tiles.tsx`, server component, inline SVG, no chart library) is passed as `afterTldr` to `BriefContent`, so a `<section aria-label="Marchés">` sits between the TL;DR and the news (once per date when a daily and a weekly share it): one tile per instrument sorted by name (`localeCompare` `fr`) with close (`formatClose`), « au JJ/MM » when stale against the brief date (`sinceMention` now in `src/lib/market/format.ts`, shared with `/marches`), signed coloured day variation (« +1,25 % » green, « −0,80 % » red with U+2212, « 0,00 % » / « n/d » neutral) and a 1 month polyline curve (≥ 2 points); « Pas encore de cours » without close; horizontal scroll on narrow screens. Data: `getMarketTiles(db, briefDate)` (`src/lib/market/tiles.ts`) uses only closes dated strictly before the brief date (what `get_market_snapshot` showed Claude that morning, so archives show the closes of their date), day variation from `computeVariations`, curve from `subtractOneMonth` (now exported) of the last close date to the last close. Charts (US #22): `NewsItem.chart` is an optional `ChartSpec` (strict: `type` `"price"`, 1 to 3 distinct `symbols`, `range` `5D` | `1M` | `3M` | `YTD` | `1Y`, `normalize` default false), stored as JSON in `news_items.chart_spec` (migration 0007, null without chart). `publish_brief` refuses, dry run included and before any write, a chart symbol that is not in `instruments`, one `payload.news.N.chart.symbols.M : …` line per symbol. `src/lib/market/chart.ts` (`computeChartSeries` pure, `loadChartData` reads `prices_daily` only) builds the series for the brief date: per symbol the anchor is the last close on or before the brief date, the base the last close on or before `referenceDate(anchor, range)` (`src/lib/market/snapshot.ts`, shared with `computeVariations`: 5D = anchor − 7 days, 1M and 3M = calendar months back with the day clamped, YTD = 31 December of the previous year, 1Y = one year back), then every close up to the anchor. When the history is shorter than the range the base is the first close: the snapshot variation is then `null` while the chart shows a curve. Normalized values are base 100 (2 decimals), so the last point − 100 equals the snapshot variation. Built (US #24): the watchlist admin page (§5). Watchlist tool and earnings (US #25): `instruments.last_earnings_date` (migration 0008, nullable `YYYY-MM-DD`) is filled by the prices job (`refreshLastEarningsDate` in `src/jobs/prices.ts`) for `in_watchlist` stocks only, after their prices, through the optional `MarketDataProvider.getLastEarningsDate(providerSymbol, asOf)` (Yahoo: `quoteSummary` modules `calendarEvents` + `earnings`, estimated dates ignored, latest date on or before `asOf`; the Twelve Data provider has none); a date overwrites, null keeps the stored one, a failure is logged and never fails the prices. `get_watchlist` (§7) uses it. Stock notes (US #26): table `stock_notes` (migration 0009, indexed on `brief_id`; `brief_id` cascades, `news_refs` JSON, `next_event` nullable), written by `publishBrief` in the same transaction as the news (republishing deletes then re-inserts the notes of the brief). Rendering: `BriefContent` shows, after the market tiles (`afterTldr`) and before the news, a `<section aria-label="Ma watchlist">` with an `<h2>` and one card per note in payload order (`id` order): the instrument name (the symbol when the instrument is gone), the day variation (`variationLabel`, « n/d » when unknown), a French label of the reason, the summary through the sanitized Markdown renderer, « Prochain événement » when present and the `newsRefs` as safe links (« Article »); no section when the brief has no note. Data: `stockNotesOf` (`src/lib/briefs/latest.ts`, used by `getLatestBrief` and `getBriefsOfDate`), 3 queries whatever the number of notes (notes, instruments, last two closes per symbol) and none without notes; the day variation is `computeVariations` over closes dated strictly before the brief date, as for the market tiles. Missing-brief banner (US #27): the home page shows it, see §5. Job runs and status (US #28): `runPricesJob` inserts one `job_runs` row at the end of each run (migration 0010; `at` = the run's `now`, `updated_count`, `failed` JSON of the failed symbols with their message), failures included; `getAdminStatus` (`src/lib/admin/status.ts`) reads it, see §5. Not built yet: the weekly coverage rule (T13), the missing-brief notification (phase 4, a `jobs` task), backup. Details in `README.md`.

---

## 7. MCP contract

8 coarse-grained tools rather than many small ones: fewer calls per run, and no half-written brief if a run stops midway. Every call is logged in `mcp_audit`.

| Tool | Type | Behavior |
| --- | --- | --- |
| `get_market_snapshot(date)` | Read | Variations 1D / 1W / 1M / YTD for all instruments, computed by the app. Includes data freshness (last close date per symbol) |
| `get_recent_briefs(days = 7)` | Read | TL;DRs and news titles, to avoid repetition |
| `list_storylines(status = "active")` | Read | Active storylines with their latest episode |
| `get_learning_progress()` | Read | Concepts already seen + 3 suggested next ones (by `order`) |
| `get_watchlist(date?)` | Read | Watchlist stocks with latest prices; flags `moved: true` when variation ≥ 2 % or earnings were published |
| `publish_brief(date, kind, payload, dry_run?)` | Write | Validates, then replaces the brief for (`date`, `kind`) in one transaction. Returns field-level validation errors. `dry_run` validates without writing |
| `upsert_storyline(slug, title, summary, status)` | Write | Create, update or close a storyline |
| `add_calendar_events(events)` | Write | Add upcoming events, deduplicated by date + title |

No delete tool is exposed.

Implemented today: `publish_brief`, `get_recent_briefs`, `get_market_snapshot` (US #20) and `get_watchlist` (US #25); the other tools of the table come with later tickets. A tool may declare MCP `annotations` (`readOnlyHint` on the read tools that have it).

`get_watchlist({date?})` (US #25, `src/lib/mcp/tools/get-watchlist.ts`, read-only; the optional real-day `date` argument is shared with `get_market_snapshot` in `src/lib/mcp/tools/date-argument.ts`): `date` defaults to Paris today, later closes ignored. Returns `structuredContent` `{ date, threshold, stocks }` for the `stock`/`etf` instruments with `in_watchlist`, sorted by name, each `{ symbol, name, type, currency, lastClose, lastCloseDate, stale, variations: { day, week }, lastEarningsDate, moved, reasons }` (`computeVariations` and `isStale`, as the snapshot) plus a French text, one line per stock. `reasons` holds `move` when `|day| >= WATCHLIST_MOVE_THRESHOLD` (env, percent, default 2, decimal comma accepted, invalid or non-positive → 2) and `earnings` when `previousWeekday(date) <= lastEarningsDate < date` (`previousWeekday` in `src/lib/dates/paris.ts`; holidays not modelled); `moved` = `reasons` not empty. No earnings date stored: Claude looks for results itself and the stock note uses reason `news`. `docs/prompt-tache-planifiee.md` calls `get_watchlist` and asks for one stock note (US #26) per moved stock; the weekly coverage rule is not built yet (T13).

### `publish_brief` payload (starting point — refine in phase 1)

Implemented today (`src/lib/schemas/brief.ts`, US #13): `tldr`, `mood` and `news` (1 to 5 items with `title`, `summary`, `whyItMatters`, `impact`, `category`, `tickers`, `sourceName`, `sourceUrl`), plus an optional `chart` per news item (US #22, see §6). `stockNotes` (US #26, see §6): optional, default `[]`, at most 50 notes, each `{ symbol, reason, summary, newsRefs, nextEvent }` with `symbol` a ticker (same format as `tickers`), `reason` `move` | `earnings` | `news` | `weekly`, `summary` required text ≤ 600, `newsRefs` at most 5 http(s) URLs (same rules as `sourceUrl`, default `[]`), `nextEvent` optional, not blank when present, ≤ 200. `publish_brief` refuses, dry run included and before any write, a note whose symbol is not an instrument with `in_watchlist` (one line `payload.stockNotes.N.symbol : « SYM » n'est pas dans la watchlist de l'application.`, one query for the whole payload); chart and watchlist refusals are merged into one result (sections « Graphique refusé » and « Fiche refusée », « rien n'a été écrit »), so Claude fixes both in one round trip. `concept` and `storylineUpdates` come with later tickets; until then objects are strict, so sending them is a validation error; unknown top-level tool arguments are rejected too. Also enforced: required texts not blank, `sourceUrl` an absolute http(s) URL (≤ 2048 chars, no `user@` part), `sourceName` ≤ 120, at most 10 `tickers` of 1–20 chars (letters, digits, `. ^ = -`).

`get_recent_briefs` is implemented too (US #14, `src/lib/briefs/recent.ts`, dates in `src/lib/dates/paris.ts`): `days` 1–30 (default 7), `published` briefs dated from Paris today − `days` to Paris today, date descending then weekly before daily, each entry `{ date, kind, tldr, newsTitles }`; `structuredContent` `{ days, since, briefs }`, empty window → `briefs: []`. Details in `README.md`.

```ts
const Category = z.enum(["monde", "geopolitique", "energie", "macro", "taux", "entreprises", "crypto"]);

const ChartSpec = z.object({
  type: z.literal("price"),
  symbols: z.array(z.string()).min(1).max(3),   // must exist in `instruments`
  range: z.enum(["5D", "1M", "3M", "YTD", "1Y"]),
  normalize: z.boolean().optional(),
});

const NewsItem = z.object({
  title: z.string().max(120),
  summary: z.string().max(600),           // Markdown
  whyItMatters: z.string().max(400),
  impact: z.string().max(300),
  category: Category,
  tickers: z.array(z.string()).default([]),
  sourceName: z.string(),
  sourceUrl: z.string().url(),
  chart: ChartSpec.optional(),
});

const StockNote = z.object({
  symbol: z.string(),                      // must be in the watchlist
  reason: z.enum(["move", "earnings", "news", "weekly"]),
  summary: z.string().max(600),
  newsRefs: z.array(z.string().url()).default([]),
  nextEvent: z.string().optional(),
});

const BriefPayload = z.object({
  tldr: z.string().max(400),
  mood: z.enum(["appetit_risque", "aversion_risque", "mitige"]),
  news: z.array(NewsItem).min(1).max(5),
  stockNotes: z.array(StockNote).default([]),
  concept: z.object({
    slug: z.string(),                      // must exist in `concepts`
    explanation: z.string(),               // Markdown
    analogy: z.string(),
    example: z.string(),
    linkToNews: z.string().optional(),
  }).optional(),
  storylineUpdates: z.array(z.object({ slug: z.string(), text: z.string() })).default([]),
});
```

Server-side rules beyond Zod:
- Unknown chart symbol (built, US #22: checked by `publish_brief`, dry run included) or concept slug (not built) → **error**. Unknown ticker in `tickers` → warning only.
- `kind = "weekly"` → `stockNotes` must cover **every** watchlist symbol (not built: T13; today a weekly brief accepts any notes on watchlist symbols).
- Stock note symbol not in the watchlist (built, US #26: checked by `publish_brief`, dry run included) → **error** naming the symbol.
- Errors are returned as a flat, readable list (`path` + message) so Claude can fix them in one round trip.

---

## 8. Security

- **Public pages**: read-only, identical for every visitor. No login code.
- **`/admin`**: protected by a Cloudflare Access application on that path (email one-time code). The app also checks the `Cf-Access-Jwt-Assertion` header (`src/middleware.ts`): RS256 against the team certs, issuer, audience `CF_ACCESS_AUD`, `email` in `ADMIN_EMAILS`; any failure or missing config → 403 (fail closed). `ADMIN_AUTH_DISABLED=true` skips the check in local dev only, never when `NODE_ENV=production`. The middleware matcher only covers `/admin` paths, and a Next.js server action can be POSTed to any path with a `Next-Action` header: the watchlist actions (US #24) therefore re-verify the Access token themselves (`src/lib/watchlist/owner-actions.ts`, same rules, before any provider call or write), and any new server action that writes must do the same.
- **`/api/mcp`**: bypassed in Cloudflare Access (Claude cannot pass Access), so the app protects it itself:
  - **Option A (preferred):** static `Authorization: Bearer <token>` configured in the Claude custom connector ("Request headers", currently a beta feature not open to every account). Constant-time comparison against `MCP_TOKEN` from env.
  - **Option B (if A is unavailable):** single-user OAuth inside the app (login page with Dorian's password).
  - Both options are implemented and `/api/mcp` accepts either: `MCP_TOKEN` or an OAuth access token (US #12, `src/lib/mcp/oauth/`). OAuth is on when `PUBLIC_URL` is set and fails closed: `MCP_OAUTH_PASSWORD` of at least 16 characters, public clients registered dynamically (redirect URIs allowlisted, Claude callbacks by default), PKCE `S256` only, single-use codes, refresh rotation, tokens stored as SHA-256 hashes and revoked when the password changes, a per-address login lockout plus a global ceiling. The Cloudflare Access bypass must cover only `/api/mcp` and the OAuth paths. Details in `README.md`, setup in `DEPLOY.md`.
  - **Never** an unauthenticated connector relying on a "secret" URL.
- Cloudflare rate limiting on `/api/mcp` and `/oauth/*`; secrets in `.env` (provide `.env.example`, never commit `.env`).
- Prompt injection: Claude reads the web, then writes here. Render Markdown sanitized, strip raw HTML, `rel="noopener noreferrer"` on links, validate every URL.

---

## 9. Deployment (handled by Dorian's CI, not by the agent)

- `bourse.dorianvidal.com` (name to confirm) → Cloudflare Tunnel → Caddy → `web:3000`.
- Compose: `web` and `jobs` from the same image, one volume for SQLite.
- **Disk:** the Pi boots from a 7.5 GB USB key that must stay system-only. Everything runs on the ~40 GB data disk: the app volume (e.g. `/mnt/data/bourse`) **and** Docker's own `data-root` (`/etc/docker/daemon.json`). Configure log rotation for containers.
- Nightly `sqlite3 .backup` to the Ugreen NAS mount.
- Provide: multi-stage arm64 `Dockerfile`, `docker-compose.yml`, GitHub Actions workflow (build + push to GHCR), a short `DEPLOY.md`.

---

## 10. Working conventions

- Dorian drives development from **Cockpit**: card → user stories with acceptance tests → GitHub issue → implementation → tests → **PR**. Dorian reviews and merges PRs himself. Do not merge, do not deploy.
- Small PRs, one phase or sub-feature at a time.
- Tests (Vitest), at minimum:
  - Zod schemas: valid and invalid payloads (fixtures in `/tests/fixtures`).
  - `publish_brief`: idempotency (publishing twice for the same date/kind leaves one brief), transaction rollback on error, weekly coverage rule.
  - Snapshot calculations (variations, `moved` flag) on fixed price fixtures.
  - One integration test calling the MCP endpoint with the SDK client (auth required, tools listed, `publish_brief` dry run).
- Commands (Node 22, npm 10; details in `README.md`):
  - `npm run dev` / `npm run build` / `npm run start`: Next.js dev server, production build, production server.
  - `npm run lint` (ESLint), `npm test` (Vitest, `tests/**/*.test.{ts,tsx}`), `npm run typecheck` (`tsc --noEmit`).
  - `npm run db:generate`: new Drizzle migration from `src/lib/db/schema.ts`. `npm run db:migrate`: applies the migrations to the SQLite file at `DATABASE_PATH` (default `./data/bourse.db`, see `.env.example`), in WAL mode.
  - `npm run build:scripts`: bundles the migration runner and the jobs entrypoint into `dist/` with esbuild (used by the Docker image, where `tsx` is not shipped).
  - Docker: `docker compose up -d` runs the `migrate` (one-shot), `web` and `jobs` services from one image (`PLATFORM=linux/amd64` on x86; see `DEPLOY.md`). `DOCKER_TESTS=1 npx vitest run tests/docker.integration.test.ts` runs the end-to-end Docker tests, skipped otherwise.
- Local dev: a seed script with fake instruments, prices and one sample brief so every page renders without Claude. Use the MCP Inspector for manual tool testing.
- UI: mobile-first (Dorian reads on his phone in the morning), French copy, minimal Tailwind until the design system is chosen (see §12).

---

## 11. Roadmap

Phase 1 aims for a real brief published by the scheduled task as early as possible, even if ugly, to validate the Claude → MCP → app chain.

| Phase | Scope | Done when |
| --- | --- | --- |
| 0. Foundation | Next.js + Tailwind + Drizzle repo; arm64 Dockerfile; GHCR CI; compose; health route | A "hello" page is served on the subdomain, `/admin` behind Access |
| 1. Claude → app chain | `briefs` + `news_items` schema; MCP route with auth, `publish_brief`, `get_recent_briefs`; pages "Aujourd'hui" + archives + brief by date; sanitized Markdown; `mcp_audit` | A real brief is published one morning with no manual step |
| 2. Market data | `instruments` + `prices_daily`; `MarketDataProvider` + prices job; `get_market_snapshot`; market tiles + charts from chart specs; watchlist admin + `get_watchlist` + `stock_notes`; missing-brief banner (built, US #27; the notification is phase 4) | Numbers in the brief and in the charts are identical |
| 3. Learning | Seeded `concepts` + `get_learning_progress` + "Apprendre" page; storylines (tools + page); agenda (tool + page) | Every brief advances the learning path |
| 4. Comfort | Notifications; weekly recap polish; quiz + XP/streaks; optional evening flash | Decided after 2–3 weeks of real use |

**Start with phase 0, then phase 1.** Don't build phase 2+ features early.

---

## 12. Open decisions — ask Dorian, don't guess

1. **MCP auth:** is the "Request headers" section available in his "Add custom connector" dialog? → Option A or B (both are implemented: A when the header exists, B otherwise).
2. **Watchlist content:** which stocks/ETFs (needed for phase 2 seeds).
3. **Design system:** his professional dashboard design system (square, strict, rounded shapes, minimalist) or "Encrage" (cel-shading). Keep UI minimal until decided.
4. **App name and subdomain** (`bourse.dorianvidal.com` is a placeholder).
5. **Gamification timing** (quiz, XP, streaks): phase 4 by default.

---

## Appendix A — Scheduled task prompt (target v1; the version in force is in `docs/prompt-tache-planifiee.md`)

The version in force, limited to the tools and fields the app accepts today, is `docs/prompt-tache-planifiee.md`: it is the single source of truth to paste into the tasks (setup in `docs/mise-en-service.md`). The prompt below is the target once every tool ships.

Keep the MCP tool names and payload in sync with this prompt; update it when the contract changes. Adding, renaming or removing an MCP tool, or changing the `BriefPayload` contract, also means updating `docs/prompt-tache-planifiee.md` (`tests/docs-prompt-tache-planifiee.test.ts` checks that its tool list equals the tools exposed on `/api/mcp`).

```
You are the editor of my private daily markets brief. I am a beginner investor in France (broker: Trade Republic). Your job is to help me understand what happens in markets, not to tell me what to buy.

1. Gather context with the connector first:
   - get_market_snapshot for today (these numbers are the only market figures you may state)
   - get_recent_briefs(7), list_storylines, get_learning_progress, get_watchlist
2. Search the web for the last 24 hours of market-moving news (Europe, US, Asia, rates, energy, crypto) and today's agenda. Prefer primary or reputable sources (central banks, company releases, Reuters, Les Echos, Bloomberg, Zonebourse, AMF). Skip anything already covered in recent briefs unless there is a real development.
3. Select 3 to 5 news items. For each: a short title, a 2-3 sentence summary, why it matters for a beginner, the possible market impact, related tickers, the source URL, a category (used to pick an illustration; never send image URLs), and an optional chart spec (never chart values). Add a stock note for each watchlist stock that moved (`moved` in get_watchlist, or a news item about it).
4. Pick the next concept from get_learning_progress that best connects to today's news. Explain it with an analogy and a concrete numeric example.
5. Update storylines with upsert_storyline and add upcoming events with add_calendar_events.
6. Write everything in French, plain and friendly. Never give buy/sell/hold recommendations, price targets or personal financial advice; describe facts, mechanisms and scenarios.
7. Call publish_brief with dry_run=true, fix any validation error, then call it again with dry_run=false.
```

A second task (Saturday ~09:00) reuses it with `kind = weekly` and a synthesis instruction (week in 5 points, a note for every watchlist stock).

## Appendix B — References

- Custom connectors, auth options, request headers: https://claude.com/docs/connectors/custom/remote-mcp
- Remote MCP servers in Claude (transports, auth): https://support.claude.com/en/articles/11503834
- Scheduled tasks and connectors: https://code.claude.com/docs/en/web-scheduled-tasks
- Twelve Data plans: https://twelvedata.com/pricing-business
