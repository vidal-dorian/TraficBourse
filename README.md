# TraficBourse — daily markets brief

Small self-hosted web app that shows a daily markets brief (news, market moves, one concept to learn) for a beginner investor in France. Everything a visitor sees is in French. The full scope, architecture and roadmap live in [`CLAUDE.md`](./CLAUDE.md).

Current state: phase 0 foundation — a provisional French home page, a `/api/health` route, the SQLite database layer (Drizzle, WAL mode) the Docker Compose stack for the Pi ([`DEPLOY.md`](./DEPLOY.md)) and the CI workflow that publishes its image. No business tables yet.

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

## Layout

```
src/app/page.tsx              provisional home page (French)
src/app/api/health/route.ts   health route
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

The QEMU build on an x64 runner costs Actions minutes (several times a native build); the GitHub Actions cache keeps it down. See [`DEPLOY.md`](./DEPLOY.md#ci-cost). Actions are pinned to commit SHAs, with their version in a comment; Dependabot proposes the bumps.

## Docker

`docker compose pull` then `docker compose up -d` runs the stack described in [`DEPLOY.md`](./DEPLOY.md), with the `linux/arm64` image published by CI on GHCR (private package: `docker login ghcr.io` first). CI only publishes `linux/arm64`, so on an x86 machine build for its own platform:

```bash
mkdir -p data && sudo chown 1000:1000 data   # the containers run as uid 1000
PLATFORM=linux/amd64 BOURSE_DATA_DIR=./data docker compose up -d --build
```

The `migrate` service applies the migrations and exits, then `web` (http://127.0.0.1:3000, bound to loopback only) and `jobs` start. `docker compose logs -f` follows the logs, `docker compose down` stops the stack; the database stays in `./data`.

The end-to-end Docker tests are skipped by default; run them with `DOCKER_TESTS=1 npx vitest run tests/docker.integration.test.ts` (`PLATFORM` defaults to the host platform).
