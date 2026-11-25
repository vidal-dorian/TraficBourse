# One image for the `web`, `jobs` and `migrate` services (docker-compose.yml).
# Built for linux/arm64 (the Pi) by CI; any platform works for local builds.

# 1. Dependencies, dev ones included (needed to build). Install scripts are skipped: the
#    only one that matters, better-sqlite3's `node-gyp rebuild`, would need a C++ toolchain
#    just to fall back on the prebuilt binaries the package already ships (linux x64/arm64,
#    glibc and musl). Other native packages come as prebuilt optional dependencies.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# 2. Build: Next.js standalone server, plus the migration runner, the concepts seed and the jobs entrypoint
#    bundled with esbuild (tsx is a dev dependency and is not shipped).
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build && npm run build:scripts

# 3. Runtime: only what the three services run, as the unprivileged `node` user (uid 1000).
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/bourse.db

# The standalone output brings the traced node_modules (better-sqlite3 included).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/dist ./dist
# migrate.js looks for its migrations next to itself.
COPY --from=build /app/src/lib/db/migrations ./dist/lib/db/migrations
# Kept external to the jobs bundle: its ESM build relies on import.meta.
COPY --from=build /app/node_modules/node-cron ./node_modules/node-cron

# Mount point of the data disk; owned by `node` so it also works without a bind mount.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
CMD ["node", "server.js"]
