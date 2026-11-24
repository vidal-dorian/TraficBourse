# TraficBourse — daily markets brief

Small self-hosted web app that shows a daily markets brief (news, market moves, one concept to learn) for a beginner investor in France. Everything a visitor sees is in French. The full scope, architecture and roadmap live in [`CLAUDE.md`](./CLAUDE.md).

Current state: phase 0 foundation — a `/api/health` route, the SQLite database layer (Drizzle, WAL mode), a provisional `/admin` page reserved to the owner, the Docker Compose stack for the Pi ([`DEPLOY.md`](./DEPLOY.md)) and the CI workflow that publishes its image. Phase 1 has started with the authenticated MCP endpoint `/api/mcp` (static token or OAuth login), its `mcp_audit` log and the `publish_brief` tool, which writes the `briefs` and `news_items` tables, the `get_recent_briefs` tool, which rereads them, and the `get_market_snapshot` tool, which gives the variations of the stored closes; the home page shows the latest published brief, `/archives` lists every published one and `/brief/AAAA-MM-JJ` shows the brief of a date. The procedure to plug the Claude scheduled task into the app is versioned in [`docs/mise-en-service.md`](./docs/mise-en-service.md) (French setup guide), with the prompt in force in [`docs/prompt-tache-planifiee.md`](./docs/prompt-tache-planifiee.md).

## Prerequisites

- Node.js 22 or later (`engines.node` in `package.json`)
- npm 10

`better-sqlite3` is a native module: `npm install` downloads a prebuilt binary, or compiles it if none matches your platform (that needs Python and a C++ toolchain).

## Install

```bash
npm install
cp .env.example .env   # then adjust the values if needed
npm run db:migrate     # creates the SQLite database and applies the migrations
npm run dev            # http://localhost:3000
```

## Configuration

Settings are read from the environment. `.env.example` lists them; copy it to `.env` (never commit `.env`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_PATH` | `./data/bourse.db` | Path of the SQLite file, resolved from the current directory. The file and its parent folder are created on first use. |
| `CF_ACCESS_TEAM_DOMAIN` | — | Cloudflare Access team domain, host name only (e.g. `myteam.cloudflareaccess.com`). |
| `CF_ACCESS_AUD` | — | Audience (AUD) tag of the Access application protecting `/admin`. |
| `ADMIN_EMAILS` | — | E-mails allowed on `/admin`, comma-separated, case-insensitive. |
| `ADMIN_AUTH_DISABLED` | unset | Local dev only: `true` skips the `/admin` check. Ignored when `NODE_ENV=production`. |
| `MCP_TOKEN` | — | Bearer token required on `/api/mcp`. Generate one with `openssl rand -hex 32`. Unset or empty: option A is off (OAuth tokens still work when configured). |
| `PUBLIC_URL` | — | Public origin of the app (e.g. `https://bourse.example.com`, no path), the issuer and base of the OAuth endpoints. It must be the exact origin Claude reaches. Unset or not an http(s) URL: the OAuth endpoints answer `503` and `/api/mcp` accepts `MCP_TOKEN` only. |
| `MCP_OAUTH_PASSWORD` | — | Password typed on the OAuth login page, at least 16 characters (`openssl rand -base64 24`). Unset, blank or shorter: the login is always refused. Changing it and restarting the app revokes every OAuth token already issued. |
| `TWELVE_DATA_API_KEY` | — | Twelve Data API key for the prices job fallback (free tier, see [Closing prices](#closing-prices)). Unset or blank: no fallback, the `jobs` container logs it once at start. Read by `jobs` only. |
| `MCP_OAUTH_REDIRECT_URIS` | `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback` | Comma-separated redirect URIs a client may register (and use at login). Any other one is refused at registration. |

The database is always opened in WAL mode with a busy timeout, so the web and jobs processes can share the file.

Docker Compose reads a few more variables (all optional, commented out in `.env.example`): `BOURSE_DATA_DIR` (host folder of the database, default `/mnt/data/bourse`), `IMAGE_TAG` (default `latest`), `PLATFORM` (default `linux/arm64`), `WEB_PORT` (default `3000`) and `WEB_BIND` (default `127.0.0.1`). They are described in [`DEPLOY.md`](./DEPLOY.md#4-configure). In the containers, `DATABASE_PATH` is always `/data/bourse.db`, inside the `BOURSE_DATA_DIR` mount.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (`output: "standalone"`) |
| `npm run build:scripts` | Bundles the migration runner and the jobs entrypoint into `dist/` with esbuild (used by the Docker image) |
| `npm run start` | Serves the production build |
| `npm run lint` | ESLint (`eslint.config.mjs`, Next.js core-web-vitals + TypeScript rules) |
| `npm test` | Vitest, runs `tests/**/*.test.{ts,tsx}` once |
| `npm run typecheck` | `tsc --noEmit` (TypeScript strict) |
| `npm run db:generate` | Generates a new Drizzle migration in `src/lib/db/migrations/` from `src/lib/db/schema.ts` |
| `npm run db:migrate` | Applies the committed migrations to the database at `DATABASE_PATH` (creates it if missing), loading `.env` when present |

To change the schema: edit `src/lib/db/schema.ts`, run `npm run db:generate`, commit the generated migration, then run `npm run db:migrate`.

## Health check

`GET /api/health` returns, never cached:

- `200` with `{ "status": "ok", "db": { "status": "ok", "journalMode": "wal" } }` when the database answers;
- `503` with `{ "status": "error", "db": { "status": "error" } }` otherwise (details go to the server logs only).

## Home page

`/` (« Aujourd'hui », `src/app/page.tsx`) is rendered on each request and shows the latest brief: the `published` one with the most recent date up to today in Europe/Paris (drafts and future-dated briefs left out; on the same date the weekly recap wins). `src/lib/render/brief.tsx` renders it, as it renders the [brief of a date](#archives-and-brief-of-a-date): its French date as the heading (« Récap de la semaine — <date> » for a weekly recap), its TL;DR, its mood and every news item in rank order (summary, « Pourquoi ça compte », « Impact possible », source link, category illustration from `public/illustrations/<category>.svg`). No published brief: a French empty state. The root layout (`src/app/layout.tsx`) puts on every page a French navigation, « Aujourd'hui » (`/`) and « Archives » (`/archives`), and the educational notice. The home page, the archives and the brief of a date read the database at each request, so they need the tables: on a fresh clone run `npm run db:migrate` before `npm run dev`.

Text fields go through `src/lib/render/markdown.tsx`, a small hand-written Markdown subset (paragraphs, bullet and numbered lists, `**bold**`, `*italic*`, `[links](https://…)`) that outputs React elements only: raw HTML shows as text, anything else stays as typed, only absolute http(s) URLs without user info (`https://host@other.example`) become links (otherwise the label stays, as text), and every external link opens in a new tab with `rel="noopener noreferrer"`. Titles and source names are plain text.

## Archives and brief of a date

Both pages are rendered on each request and count the same briefs as the home page: `published` ones dated up to today in Europe/Paris (drafts and future-dated briefs left out). The queries are in `src/lib/briefs/archives.ts`.

- **`/archives`** (`src/app/archives/page.tsx`, title « Archives — Veille boursière »): every such brief, one heading per month in French (« novembre 2026 », `formatFrenchMonth` in `src/lib/dates/paris.ts`), the newest month and date first, and on the same date the weekly recap before the daily brief. Each entry links to `/brief/<date>` and reads as the brief's heading (its French date, « Récap de la semaine — <date> » for a weekly recap). No published brief: a French empty state.
- **`/brief/AAAA-MM-JJ`** (`src/app/brief/[date]/page.tsx`): every published brief of that date, the weekly recap first, each rendered like the home page. The segment must be a real calendar date (`BriefDate`, `src/lib/schemas/brief.ts`), checked before any database read. The page title, « Brief du <date> — Veille boursière », comes from the URL alone, without reading the database; a 404 keeps the default « Veille boursière ».
- **404**: an invalid segment (`2026-02-30`, `hier`), a date without a published brief (none, or a draft only) or a date after today calls `notFound()`. `src/app/not-found.tsx` answers it, and any unknown URL too: « Page introuvable », a French explanation and a link to `/archives`.

Known limitation: both 404s answer HTTP `404`, but for `/brief/<date>` Next.js 15.5 sends its empty error shell (`<html id="__next_error__">`) as the initial HTML, and the French page appears once the client scripts run. An unknown URL (e.g. `/nimporte`) gets the full French HTML from the static `/_not-found` route. A `loading.tsx` or a Suspense boundary would stream the page, but with a `200` (a soft 404), so the app has none.

## MCP endpoint

`/api/mcp` is the MCP server the Claude scheduled task connects to (`CLAUDE.md` §7): official `@modelcontextprotocol/sdk`, Streamable HTTP, stateless (a fresh server and transport per request, JSON responses, no session). It runs on the Node.js runtime and is never cached. To connect Claude to it and create the scheduled tasks, follow [`docs/mise-en-service.md`](./docs/mise-en-service.md).

- **Auth** (`CLAUDE.md` §8): every request on the methods it serves (POST, GET, DELETE, and HEAD through GET) must carry `Authorization: Bearer <token>`, where the token is either `MCP_TOKEN` (option A) or a live OAuth access token (option B, [OAuth login](#oauth-login-for-the-claude-connector)). `MCP_TOKEN` is compared in constant time (both sides hashed with SHA-256, then `timingSafeEqual`). A missing or wrong token answers `401` with a short « Non autorisé. » and `Cache-Control: no-store`; when `PUBLIC_URL` is set, the `WWW-Authenticate` header of that `401` is `Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource/api/mcp"` (plain `Bearer` otherwise), which is how a connector added without a header finds the login. An unset `MCP_TOKEN` refuses option A too (fail closed) and, when OAuth is not configured either, logs the problem on the server, never the token. `src/middleware.ts` does not run on this route. Next.js answers OPTIONS (204) and PUT or PATCH (405) by itself, before any MCP handling.
- **Methods**: once authenticated, only `POST` is served; `GET` and `DELETE` answer `405` (no standalone SSE stream, no session to end).
- **Tools**: the server is built from a tool registry (`src/lib/mcp/tools/index.ts`); an empty registry lists nothing rather than failing. A handler gets the validated arguments; a tool may set `annotations` (e.g. `readOnlyHint: true`), listed to clients as is; a tool that sets `rawArguments: true` also gets, as a second argument, the arguments exactly as received (before defaults).
- **`publish_brief(date, kind, payload, dry_run?)`**: `date` is `YYYY-MM-DD` (a real calendar date), `kind` is `daily` or `weekly`, `payload` follows `BriefPayload` (`src/lib/schemas/brief.ts`: `tldr`, `mood`, 1 to 5 news items). Objects are strict, and so are the tool arguments: a key not handled yet (`stockNotes`, `concept`, `storylineUpdates`, `chart`) or a misspelt argument (`dryRun` for `dry_run`) is an error. Every field is bounded (texts by length, `sourceName` 120 characters, `sourceUrl` an absolute http(s) URL of 2048 characters at most, with no user info before an `@`, at most 10 `tickers` of 1 to 20 characters among letters, digits and `. ^ = -`), so a call cannot store an oversized brief. Invalid arguments come back as one error result listing every issue at once, one `path : message` line each (e.g. `payload.news.0.sourceUrl : …`), and write nothing. `dry_run: true` validates and writes nothing. Otherwise the brief of (`date`, `kind`) is written as `published` with its news items and its raw JSON payload, in one transaction: republishing updates the same `briefs` row (same id) and replaces its news items, and a failure leaves the previous brief intact. The result is a short French text plus `structuredContent` `{ dryRun, date, kind, newsCount }`, with `briefId` when written. Markdown is stored as received. Tables: `briefs` (unique on `date` + `kind`, `status` draft or published, `raw_payload`, `published_at`) and `news_items` (`rank` in payload order, unique per brief; `tickers` as JSON; deleted with their brief). The `chart_spec` column of `CLAUDE.md` §6 comes with the chart ticket.
- **`get_recent_briefs(days?)`**: read-only. `days` is an integer from 1 to 30, 7 when absent. The window is counted in calendar days back from today in Europe/Paris (whatever the server's time zone), today included: `since` = Paris today − `days`, and every `published` brief dated from `since` to Paris today comes back (drafts never; briefs dated after today are left out, so the answer is bounded at (`days` + 1) x 2 briefs). Order: date descending, and on the same date the weekly recap before the daily brief. The result is a short French text naming each brief's date, kind, TL;DR and news titles (or saying there is none); stored texts are flattened onto one quoted line each (« … ») under a fixed line saying they are data written from web sources, not instructions, so a TL;DR or title holding newlines cannot pass for an entry of the list, plus `structuredContent` `{ days, since, briefs }`, each entry exactly `{ date, kind, tldr, newsTitles }` (titles in rank order; no summary, source or raw payload). An empty window gives `briefs: []`, not an error. Two queries whatever the number of briefs (`src/lib/briefs/recent.ts`); Paris dates and day arithmetic in `src/lib/dates/paris.ts`.
- **`get_market_snapshot(date?)`**: read-only. `date` is `AAAA-MM-JJ` (a real calendar day), Paris today when absent; closes dated after it are ignored. For every instrument, ordered by name, `structuredContent` `{ date, instruments }` with each entry `{ symbol, name, type, currency, lastClose, lastCloseDate, stale, variations: { day, week, month, ytd } }`. `lastClose` is the latest stored close up to `date` (`null` and no variation when there is none); `stale` is true when that close is older than the last finished session expected on `date` (`isStale` in `src/lib/market/latest.ts`, same rule as `/marches`). The French text gives one line per instrument with the close formatted as on `/marches`, its date, « (cours ancien) » when stale, « Pas encore de cours » when none, and the four variations (« n/d » when missing). Variations are percentages rounded to 2 decimals, computed from `prices_daily` by `computeVariations` (`src/lib/market/snapshot.ts`, pure): `day` against the previous stored close; `week` against the last close on or before the last close date minus 7 days; `month` against the last close on or before the same day one calendar month earlier (day clamped, 31 March gives 28 February); `ytd` against the last close on or before 31 December of the previous year. `null` when the reference close is missing or 0. Two queries whatever the number of instruments.
- **Audit**: every `tools/call` adds one row to `mcp_audit` (`tool`, `ok`, `error`, `duration_ms`, `at`), for successes, error results, thrown errors, unknown tools and invalid arguments alike. The error is one line of at most 200 characters; arguments and results are never stored. A failing audit write is logged on the server and does not affect the call. Invalid arguments come back to the client as one `path : message` line per issue.

## OAuth login for the Claude connector

`CLAUDE.md` §8, option B, for an account whose connector dialog has no « Request headers ». It sits next to option A: `MCP_TOKEN` keeps working unchanged. The app is both the authorization server and the resource server (MCP authorization spec, RFC 9728, RFC 8414, RFC 7591, OAuth 2.1 with PKCE `S256` only). It needs `PUBLIC_URL` and `MCP_OAUTH_PASSWORD`; without `PUBLIC_URL` every endpoint below answers `503`. The code is in `src/lib/mcp/oauth/`.

| Endpoint | Role |
| --- | --- |
| `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp` | RFC 9728: `resource` is `<PUBLIC_URL>/api/mcp`, `authorization_servers` is `[<PUBLIC_URL>]` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: issuer `PUBLIC_URL`, the three endpoints below, `S256` only, public clients (`none`), `authorization_response_iss_parameter_supported` |
| `POST /oauth/register` | Dynamic client registration (RFC 7591), JSON body, public clients only. Every `redirect_uris` entry must be in the allowlist (`MCP_OAUTH_REDIRECT_URIS`), else `400 invalid_redirect_uri` |
| `GET` and `POST /oauth/authorize` | The login page (French, no script, never framed, `no-store`) and its form |
| `POST /oauth/token` | Form-urlencoded token endpoint: `authorization_code` and `refresh_token` grants |

Flow: a request on `/api/mcp` without a valid token gets the `401` challenge, the client reads the two metadata documents, registers itself, and sends the owner to `/oauth/authorize` with a PKCE `S256` challenge. The client, the redirect URI (exactly one registered and still on the allowlist) and the optional `resource` (must be `<PUBLIC_URL>/api/mcp`) are checked first; a problem there shows an error page and never redirects. The owner types `MCP_OAUTH_PASSWORD` (compared in constant time); a wrong one answers `401` with the page again and issues nothing. The right one redirects with a single-use code (10 minutes) plus `state` and `iss` (RFC 9207). The client exchanges it with its `code_verifier` for an access token and a refresh token. A refresh rotates the pair: the old refresh token is revoked at once. Presenting a used code again revokes the tokens it produced.

- **Lifetimes**: access token 1 hour; refresh token 30 days, and a login never lasts more than 90 days in total, however often it is refreshed (the owner then logs in again).
- **Lockout**: 5 wrong passwords within 15 minutes from one address lock that address for 15 minutes (`429`, the password is not even compared). The address is `CF-Connecting-IP` (requests without it share one bucket), IPv6 grouped by its /64 prefix. A global ceiling of 50 failures in 15 minutes locks the login for everyone, owner included, for 15 minutes. Anyone who can send that many wrong passwords can therefore block new logins for a while; tokens already issued keep working. The counters live in memory and a restart clears them.
- **Storage**: tables `oauth_clients`, `oauth_codes` and `oauth_tokens`. Codes and tokens are 32 random bytes and only their SHA-256 hash is stored. The password itself is never stored: the `app_meta` table holds a random generation id, which every token carries, and a scrypt verifier of the password. A new password gets a new generation id on first use, so every token issued under the old one stops working. Expired rows are not purged yet.

To connect in Claude: set `PUBLIC_URL` and `MCP_OAUTH_PASSWORD`, make the OAuth paths reachable ([Cloudflare Access setup](#cloudflare-access-setup-manual-done-once-in-the-zero-trust-dashboard)), then add a custom connector with the URL `<PUBLIC_URL>/api/mcp` and no header. Claude opens the login page; type the password.

## Admin access

`/admin` is protected twice: by a Cloudflare Access application on that path (configured in Cloudflare, outside this repo), and by the app itself. `src/middleware.ts` runs on `/admin` and `/admin/*` only (public pages and `/api/*` never go through it) and verifies the `Cf-Access-Jwt-Assertion` header: RS256 signature against the team keys (`https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, cached), issuer, audience `CF_ACCESS_AUD`, expiry, and an `email` claim listed in `ADMIN_EMAILS`.

Any failure answers `403` with a short « Accès refusé. » and `Cache-Control: no-store`, whatever the reason. A missing or invalid Access setting also answers `403` (fail closed) and logs the problem on the server.

To open `/admin` locally without Cloudflare, set `ADMIN_AUTH_DISABLED=true` in `.env` and run `npm run dev`. The flag has no effect when `NODE_ENV=production` (`npm run start` after `npm run build`, and any production run): a stray `ADMIN_AUTH_DISABLED=true` there only logs a warning and the check stays on. Without the flag, a local `/admin` answers `403`, since no Access token reaches the app.

### Cloudflare Access setup (manual, done once in the Zero Trust dashboard)

1. Create a self-hosted Access application for the site's host name, restricted to the path `admin`, with an Allow policy on the owner's e-mail (one-time code login).
2. Copy the application's Audience (AUD) tag into `CF_ACCESS_AUD`, the team domain (`<team>.cloudflareaccess.com`) into `CF_ACCESS_TEAM_DOMAIN`, and the allowed e-mail(s) into `ADMIN_EMAILS` (same list as the Access policy).
3. Claude cannot pass Access, so create a **separate** self-hosted Access application on the same host name, whose destinations are exactly these paths (no `*`): `/api/mcp`, `/oauth/authorize`, `/oauth/register`, `/oauth/token`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp`, with one Bypass policy (Include: Everyone). Cloudflare applies the most specific path, so the application covering `/admin` (or the whole host) keeps its Allow policy; never add a Bypass to that one. Check that `/admin` still shows the Cloudflare login page and that `/api/mcp` without a token answers the app's `401`. The app protects these paths itself: `MCP_TOKEN` or an OAuth access token on `/api/mcp` ([MCP endpoint](#mcp-endpoint)), the password and PKCE on the OAuth endpoints ([OAuth login](#oauth-login-for-the-claude-connector)). Do not use a wildcard such as `/oauth/*` or `/.well-known/*`.

## Layout

```
src/app/page.tsx              home page: the latest published brief (French)
src/app/archives/page.tsx     archives: published briefs grouped by month (French)
src/app/brief/[date]/page.tsx brief of a date, /brief/AAAA-MM-JJ (French)
src/app/not-found.tsx         French 404 page, with a link to the archives
src/app/layout.tsx            root layout: navigation and educational notice on every page
src/app/api/health/route.ts   health route
src/app/api/mcp/route.ts      MCP endpoint (bearer token or OAuth, stateless Streamable HTTP)
src/app/admin/page.tsx        provisional admin page (French, noindex)
src/middleware.ts             Cloudflare Access check on /admin
src/lib/auth/                 Access token verification (jose)
src/lib/mcp/server.ts         MCP handler: auth (MCP_TOKEN or OAuth), tool registry, audited tools/call
src/lib/mcp/auth.ts           bearer token parsing and check against MCP_TOKEN
src/lib/mcp/audit.ts          mcp_audit writes
src/lib/mcp/oauth/            OAuth login of the connector (config, metadata, register, authorize, token, store, credential, login limiter)
src/app/oauth/                /oauth/register, /oauth/authorize, /oauth/token route handlers
src/app/.well-known/          OAuth discovery documents (protected resource, authorization server)
src/lib/mcp/tools/            production tool registry (publish_brief, get_recent_briefs, get_market_snapshot)
src/lib/schemas/brief.ts      Zod contract of a brief payload, shared by the MCP tools (enum values in brief-enums.ts)
src/lib/briefs/publish.ts     transactional publication of a brief and its news items
src/lib/briefs/recent.ts      latest published briefs (TL;DR and news titles)
src/lib/briefs/latest.ts      the brief shown on the home page, with its news items, and the query parts the brief queries share
src/lib/briefs/archives.ts    archives list and published briefs of a date
src/lib/render/brief.tsx      one brief as the public pages show it (home page, brief of a date)
src/lib/render/markdown.tsx   sanitized Markdown subset rendered as React elements
src/lib/dates/paris.ts        Europe/Paris calendar dates, day arithmetic and French date and month labels
src/lib/db/client.ts          SQLite connection (WAL, busy timeout) and Drizzle client
src/lib/db/schema.ts          Drizzle schema
src/lib/db/migrate.ts         migration runner used by `npm run db:migrate`
src/lib/db/migrations/        generated SQL migrations (0005 seeds the default instruments, 0006 adds `fallback_symbol`)
src/lib/market/provider.ts    `MarketDataProvider` interface (daily bars of a provider symbol)
src/lib/market/yahoo.ts       `MarketDataProvider` backed by yahoo-finance2
src/lib/market/twelvedata.ts  `MarketDataProvider` backed by Twelve Data (fallback of Yahoo)
src/lib/market/latest.ts      last known close of every instrument, with its `stale` flag
src/lib/market/format.ts      French formatting of a close by instrument type
src/lib/market/snapshot.ts    variations (1 day, 1 week, 1 month, year to date) of one instrument, pure
src/app/marches/page.tsx      markets page: last close of every instrument
src/jobs/index.ts             node-cron entrypoint of the `jobs` container
src/jobs/schedule.ts          schedules (Europe/Paris) and their registration
src/jobs/prices.ts            prices job: closing prices into `prices_daily`
docs/mise-en-service.md       setup guide: connector and scheduled tasks (French)
docs/prompt-tache-planifiee.md prompt in force for the scheduled tasks (French)
public/illustrations/         one static SVG per news category
tests/                        Vitest tests
Dockerfile                    multi-stage image shared by the web, jobs and migrate services
docker-compose.yml            stack run on the Pi (see DEPLOY.md)
.github/workflows/ci.yml      CI: checks on every push and PR, image publication from main
.github/dependabot.yml        weekly bumps of the actions, npm packages and base image
```

## Closing prices

The app fetches the closing prices itself; Claude never supplies a number. The `jobs` container runs the prices job (`src/jobs/prices.ts`) every day at 06:30 Europe/Paris (`30 6 * * *`, `src/jobs/schedule.ts`; it does not run at start-up). The job only knows the `MarketDataProvider` interface (`src/lib/market/provider.ts`); `src/lib/market/yahoo.ts` implements it with `yahoo-finance2` (unofficial, may break, hence the interface). Migration `0004` creates `instruments` and `prices_daily` (primary key `symbol` + `date`), migration `0005` seeds the nine default instruments: CAC 40 `^FCHI`, Euro Stoxx 50 `^STOXX50E`, S&P 500 `^GSPC`, Nasdaq 100 `^NDX`, `IWDA.AS`, EUR/USD `EURUSD=X`, gold `GC=F`, Brent `BZ=F`, Bitcoin `BTC-EUR`. None is in the watchlist yet.

For each instrument, the first run fetches one year (Paris today minus one year); later runs restart from the last stored date, inclusive, so a revised close is corrected. Rows are upserted on (`symbol`, `date`), so a second run the same day creates no duplicate. A bar dated Paris today is dropped: at 06:30 that day is still trading (24/7 markets, futures, FX) and its close would be a live price stored as final. A bar's `date` is the exchange's local day. A failing symbol is logged (`prices: <symbol> failed: …`) and the others are processed; the run ends with a `prices: N instrument(s) updated, M failed` line. The container needs outbound internet access.

### Twelve Data fallback

When Yahoo fails on an instrument (its call throws), the job asks Twelve Data (`src/lib/market/twelvedata.ts`, `MarketDataProvider` named `twelvedata`) for the same period, if the instrument has a `fallback_symbol` (migration `0006`, nullable: the Twelve Data symbol, null = not covered) and `TWELVE_DATA_API_KEY` is set. Only the symbols Yahoo failed on are asked. The rules are the same (bars dated Paris today dropped, upsert on `symbol` + `date`, rows stored under the app symbol). Migration `0006` sets `EUR/USD` for `EURUSD=X` and `BTC/EUR` for `BTC-EUR`; the indices, the Euronext ETF and the futures stay null, because the free tier covers US stocks and ETFs, forex and crypto only. A US stock or ETF added later gets its plain ticker (e.g. `AAPL`) as `fallback_symbol`. The Yahoo error and the fallback used are logged; if the fallback fails too, or there is none, the symbol is reported failed (both messages when both failed). The final line becomes `prices: N instrument(s) updated (yahoo: A, twelvedata: B), M failed`. The free tier allows 8 calls a minute: request starts are at least 8 s apart (`minIntervalMs`). Error messages never contain the key.

### Markets page

`/marches` (`src/app/marches/page.tsx`, linked as « Marchés » in the nav, rendered at each request) lists every instrument by name (`src/lib/market/latest.ts`, `getLatestCloses`) with its last known close, formatted in French by type (`src/lib/market/format.ts`: points for an index, 4 decimals for a currency pair, the instrument's currency otherwise). The expected close is that of the last finished session before Paris today: the day before for `crypto`, the previous weekday for every other type (Monday, Saturday and Sunday expect Friday). When the latest stored date is earlier than that, the line also shows « au JJ/MM » (e.g. « au 18/11 »). Bank holidays are not modelled, so an instrument closed the day before shows the mention too. An instrument with no price yet shows « Pas encore de cours ». No chart yet.

**The Yahoo symbols have not been verified live** (no network in the development sandbox): check them on the Pi after the first run, see [DEPLOY.md](./DEPLOY.md#closing-prices).

## CI

`.github/workflows/ci.yml` runs on every push on `main` and on every pull request, whatever its base branch (stacked PRs included):

- `check`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` on Node 22. The Docker integration tests stay skipped.
- `publish`: only for a push on `main`, and only once `check` passed. It builds the `linux/arm64` image with buildx under QEMU and pushes it to `ghcr.io/vidal-dorian/traficbourse` with the tags `latest` and the full commit SHA. It is the only job allowed to write packages.

Each run shows up in the repository's Actions tab; the published image and its tags are on the `traficbourse` package page, under the repository's Packages.

The QEMU build on an x64 runner costs Actions minutes (several times a native build); the GitHub Actions cache keeps it down. See [`DEPLOY.md`](./DEPLOY.md#ci-cost). Actions are pinned to commit SHAs, with their version in a comment; Dependabot proposes the bumps.

## Docker

`docker compose pull && docker compose up -d --no-build` runs the stack described in [`DEPLOY.md`](./DEPLOY.md), with the `linux/arm64` image published by CI on GHCR (private package: `docker login ghcr.io` first). CI only publishes `linux/arm64`, so on an x86 machine build for its own platform:

```bash
mkdir -p data && sudo chown 1000:1000 data   # the containers run as uid 1000
PLATFORM=linux/amd64 BOURSE_DATA_DIR=./data docker compose up -d --build
```

The `migrate` service applies the migrations and exits, then `web` (http://127.0.0.1:3000, bound to loopback only) and `jobs` start. `docker compose logs -f` follows the logs, `docker compose down` stops the stack; the database stays in `./data`.

The end-to-end Docker tests are skipped by default; run them with `DOCKER_TESTS=1 npx vitest run tests/docker.integration.test.ts` (`PLATFORM` defaults to the host platform).
