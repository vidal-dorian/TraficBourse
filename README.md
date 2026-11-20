# TraficBourse — daily markets brief

Small self-hosted web app that shows a daily markets brief (news, market moves, one concept to learn) for a beginner investor in France. Everything a visitor sees is in French. The full scope, architecture and roadmap live in [`CLAUDE.md`](./CLAUDE.md).

Current state: phase 0 foundation — a provisional French home page, a `/api/health` route, the SQLite database layer (Drizzle, WAL mode), a provisional `/admin` page reserved to the owner, the Docker Compose stack for the Pi ([`DEPLOY.md`](./DEPLOY.md)) and the CI workflow that publishes its image. Phase 1 has started with the authenticated MCP endpoint `/api/mcp`, its `mcp_audit` log and the `publish_brief` tool, which writes the `briefs` and `news_items` tables, and the `get_recent_briefs` tool, which rereads them (no page shows a brief yet).

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
| `MCP_TOKEN` | — | Bearer token required on `/api/mcp`. Generate one with `openssl rand -hex 32`. Unset or empty: every MCP request answers `401`. |

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

## MCP endpoint

`/api/mcp` is the MCP server the Claude scheduled task connects to (`CLAUDE.md` §7): official `@modelcontextprotocol/sdk`, Streamable HTTP, stateless (a fresh server and transport per request, JSON responses, no session). It runs on the Node.js runtime and is never cached.

- **Auth** (`CLAUDE.md` §8, option A): every request on the methods it serves (POST, GET, DELETE, and HEAD through GET) must carry `Authorization: Bearer <MCP_TOKEN>`. The token is compared in constant time (both sides hashed with SHA-256, then `timingSafeEqual`). A missing or wrong token answers `401` with a short « Non autorisé. » and `Cache-Control: no-store`; an unset `MCP_TOKEN` answers `401` too (fail closed) and logs the problem on the server, never the token. `src/middleware.ts` does not run on this route. Next.js answers OPTIONS (204) and PUT or PATCH (405) by itself, before any MCP handling.
- **Methods**: once authenticated, only `POST` is served; `GET` and `DELETE` answer `405` (no standalone SSE stream, no session to end).
- **Tools**: the server is built from a tool registry (`src/lib/mcp/tools/index.ts`); an empty registry lists nothing rather than failing. A handler gets the validated arguments; a tool that sets `rawArguments: true` also gets, as a second argument, the arguments exactly as received (before defaults).
- **`publish_brief(date, kind, payload, dry_run?)`**: `date` is `YYYY-MM-DD` (a real calendar date), `kind` is `daily` or `weekly`, `payload` follows `BriefPayload` (`src/lib/schemas/brief.ts`: `tldr`, `mood`, 1 to 5 news items). Objects are strict, and so are the tool arguments: a key not handled yet (`stockNotes`, `concept`, `storylineUpdates`, `chart`) or a misspelt argument (`dryRun` for `dry_run`) is an error. Every field is bounded (texts by length, `sourceName` 120 characters, `sourceUrl` an absolute http(s) URL of 2048 characters at most, with no user info before an `@`, at most 10 `tickers` of 1 to 20 characters among letters, digits and `. ^ = -`), so a call cannot store an oversized brief. Invalid arguments come back as one error result listing every issue at once, one `path : message` line each (e.g. `payload.news.0.sourceUrl : …`), and write nothing. `dry_run: true` validates and writes nothing. Otherwise the brief of (`date`, `kind`) is written as `published` with its news items and its raw JSON payload, in one transaction: republishing updates the same `briefs` row (same id) and replaces its news items, and a failure leaves the previous brief intact. The result is a short French text plus `structuredContent` `{ dryRun, date, kind, newsCount }`, with `briefId` when written. Markdown is stored as received. Tables: `briefs` (unique on `date` + `kind`, `status` draft or published, `raw_payload`, `published_at`) and `news_items` (`rank` in payload order, unique per brief; `tickers` as JSON; deleted with their brief). The `chart_spec` column of `CLAUDE.md` §6 comes with the chart ticket.
- **`get_recent_briefs(days?)`**: read-only. `days` is an integer from 1 to 30, 7 when absent. The window is counted in calendar days back from today in Europe/Paris (whatever the server's time zone), today included: `since` = Paris today − `days`, and every `published` brief dated `since` or later comes back (drafts never). Order: date descending, and on the same date the weekly recap before the daily brief. The result is a short French text naming each brief's date, kind, TL;DR and news titles (or saying there is none), plus `structuredContent` `{ days, since, briefs }`, each entry exactly `{ date, kind, tldr, newsTitles }` (titles in rank order; no summary, source or raw payload). An empty window gives `briefs: []`, not an error. Two queries whatever the number of briefs (`src/lib/briefs/recent.ts`); Paris dates and day arithmetic in `src/lib/dates/paris.ts`.
- **Audit**: every `tools/call` adds one row to `mcp_audit` (`tool`, `ok`, `error`, `duration_ms`, `at`), for successes, error results, thrown errors, unknown tools and invalid arguments alike. The error is one line of at most 200 characters; arguments and results are never stored. A failing audit write is logged on the server and does not affect the call. Invalid arguments come back to the client as one `path : message` line per issue.

## Admin access

`/admin` is protected twice: by a Cloudflare Access application on that path (configured in Cloudflare, outside this repo), and by the app itself. `src/middleware.ts` runs on `/admin` and `/admin/*` only (public pages and `/api/*` never go through it) and verifies the `Cf-Access-Jwt-Assertion` header: RS256 signature against the team keys (`https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, cached), issuer, audience `CF_ACCESS_AUD`, expiry, and an `email` claim listed in `ADMIN_EMAILS`.

Any failure answers `403` with a short « Accès refusé. » and `Cache-Control: no-store`, whatever the reason. A missing or invalid Access setting also answers `403` (fail closed) and logs the problem on the server.

To open `/admin` locally without Cloudflare, set `ADMIN_AUTH_DISABLED=true` in `.env` and run `npm run dev`. The flag has no effect when `NODE_ENV=production` (`npm run start` after `npm run build`, and any production run): a stray `ADMIN_AUTH_DISABLED=true` there only logs a warning and the check stays on. Without the flag, a local `/admin` answers `403`, since no Access token reaches the app.

### Cloudflare Access setup (manual, done once in the Zero Trust dashboard)

1. Create a self-hosted Access application for the site's host name, restricted to the path `admin`, with an Allow policy on the owner's e-mail (one-time code login).
2. Copy the application's Audience (AUD) tag into `CF_ACCESS_AUD`, the team domain (`<team>.cloudflareaccess.com`) into `CF_ACCESS_TEAM_DOMAIN`, and the allowed e-mail(s) into `ADMIN_EMAILS` (same list as the Access policy).
3. If an Access application covers `/api/mcp` (for example one on the whole host name), add a Bypass policy for that path: Claude cannot pass Access, so the app protects that route itself with `MCP_TOKEN` ([MCP endpoint](#mcp-endpoint)).

## Layout

```
src/app/page.tsx              provisional home page (French)
src/app/api/health/route.ts   health route
src/app/api/mcp/route.ts      MCP endpoint (bearer token, stateless Streamable HTTP)
src/app/admin/page.tsx        provisional admin page (French, noindex)
src/middleware.ts             Cloudflare Access check on /admin
src/lib/auth/                 Access token verification (jose)
src/lib/mcp/server.ts         MCP handler: auth, tool registry, audited tools/call
src/lib/mcp/auth.ts           bearer token check against MCP_TOKEN
src/lib/mcp/audit.ts          mcp_audit writes
src/lib/mcp/tools/            production tool registry (publish_brief, get_recent_briefs)
src/lib/schemas/brief.ts      Zod contract of a brief payload, shared by the MCP tools (enum values in brief-enums.ts)
src/lib/briefs/publish.ts     transactional publication of a brief and its news items
src/lib/briefs/recent.ts      latest published briefs (TL;DR and news titles)
src/lib/dates/paris.ts        Europe/Paris calendar dates and day arithmetic
src/lib/db/client.ts          SQLite connection (WAL, busy timeout) and Drizzle client
src/lib/db/schema.ts          Drizzle schema
src/lib/db/migrate.ts         migration runner used by `npm run db:migrate`
src/lib/db/migrations/        generated SQL migrations
src/jobs/index.ts             node-cron entrypoint of the `jobs` container
tests/                        Vitest tests
Dockerfile                    multi-stage image shared by the web, jobs and migrate services
docker-compose.yml            stack run on the Pi (see DEPLOY.md)
.github/workflows/ci.yml      CI: checks on every push and PR, image publication from main
.github/dependabot.yml        weekly bumps of the actions, npm packages and base image
```

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
