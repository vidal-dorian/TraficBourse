# TraficBourse — daily markets brief

Small self-hosted web app that shows a daily markets brief (news, market moves, one concept to learn) for a beginner investor in France. Everything a visitor sees is in French. The full scope, architecture and roadmap live in [`CLAUDE.md`](./CLAUDE.md).

Current state: phase 0 foundation — a provisional French home page, a `/api/health` route, the SQLite database layer (Drizzle, WAL mode) and a provisional `/admin` page reserved to the owner. No business tables yet.

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

The database is always opened in WAL mode with a busy timeout, so the web and jobs processes can share the file.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (`output: "standalone"`) |
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

## Admin access

`/admin` is protected twice: by a Cloudflare Access application on that path (configured in Cloudflare, outside this repo), and by the app itself. `src/middleware.ts` runs on `/admin` and `/admin/*` only (public pages and `/api/*` never go through it) and verifies the `Cf-Access-Jwt-Assertion` header: RS256 signature against the team keys (`https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, cached), issuer, audience `CF_ACCESS_AUD`, expiry, and an `email` claim listed in `ADMIN_EMAILS`.

Any failure answers `403` with a short « Accès refusé. » and `Cache-Control: no-store`, whatever the reason. A missing or invalid Access setting also answers `403` (fail closed) and logs the problem on the server.

To open `/admin` locally without Cloudflare, set `ADMIN_AUTH_DISABLED=true` in `.env` and run `npm run dev`. The flag has no effect when `NODE_ENV=production` (`npm run build` / `npm run start`, the Docker image).

## Layout

```
src/app/page.tsx              provisional home page (French)
src/app/api/health/route.ts   health route
src/app/admin/page.tsx        provisional admin page (French, noindex)
src/middleware.ts             Cloudflare Access check on /admin
src/lib/auth/                 Access token verification (jose)
src/lib/db/client.ts          SQLite connection (WAL, busy timeout) and Drizzle client
src/lib/db/schema.ts          Drizzle schema
src/lib/db/migrate.ts         migration runner used by `npm run db:migrate`
src/lib/db/migrations/        generated SQL migrations
tests/                        Vitest tests
```
