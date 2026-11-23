# Deploying on the Pi

How to run TraficBourse on the Raspberry Pi with Docker Compose. Nothing here is run by the
agent.

The Pi does not compile anything. Every push on `main` runs the CI workflow
(`.github/workflows/ci.yml`): once lint, typecheck, tests and build pass, it builds the
`linux/arm64` image and pushes it to GHCR as `ghcr.io/vidal-dorian/traficbourse`, tagged
`latest` and with the full commit SHA. A failing check publishes nothing; pull requests run
the checks only. The Pi then pulls the image and restarts the stack. Building the image on
the Pi itself remains possible as a fallback ([Build locally](#build-locally-fallback)).

## The stack

`docker-compose.yml` runs three services from the same image:

| Service | Command | Role |
| --- | --- | --- |
| `migrate` | `node dist/lib/db/migrate.js` | One-shot: applies the database migrations, then exits. `web` and `jobs` only start once it succeeded. |
| `web` | `node server.js` | Next.js server on port 3000, published on `127.0.0.1:WEB_PORT` on the host only, health check on `/api/health`. |
| `jobs` | `node dist/jobs/index.js` | node-cron scheduler, timezone Europe/Paris. For now it only logs an hourly heartbeat; the real jobs come in phase 2. |

The SQLite database is the file `/data/bourse.db` inside the containers, bind-mounted from
`BOURSE_DATA_DIR` on the host (default `/mnt/data/bourse`). Every container logs with the
`json-file` driver, rotated at 3 files of 10 MB.

## 1. Prerequisites

- Docker Engine with the Compose plugin (`docker compose version`).
- The 40 GB data disk mounted at `/mnt/data` at boot (`/etc/fstab`).
- Caddy reverse-proxying the subdomain to `127.0.0.1:3000` (or `WEB_PORT`).

## 2. Move Docker's data-root to the data disk

The Pi boots from a 7.5 GB USB key that must stay system-only. By default Docker keeps
images, containers and their logs in `/var/lib/docker`, on that key: a few image updates
are enough to fill it. Move Docker's `data-root` to the data disk once, before the first
deployment:

```bash
sudo systemctl stop docker docker.socket
sudo mkdir -p /mnt/data/docker
sudo rsync -aHAX /var/lib/docker/ /mnt/data/docker/   # skip on a fresh install
```

Create or edit `/etc/docker/daemon.json` (the log options are the default for any other
container on the Pi; this stack sets its own in the compose file):

```json
{
  "data-root": "/mnt/data/docker",
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

Make Docker wait for the data disk at boot, then restart it:

```bash
sudo systemctl edit docker   # add the two lines below, then save
#   [Unit]
#   RequiresMountsFor=/mnt/data
sudo systemctl start docker
docker info --format '{{.DockerRootDir}}'   # must print /mnt/data/docker
```

Once everything works, the old `/var/lib/docker` can be deleted to free the USB key.

## 3. Create the data folder

The containers run as the `node` user (uid 1000), which must be able to write the database:

```bash
sudo mkdir -p /mnt/data/bourse
sudo chown 1000:1000 /mnt/data/bourse
```

To store it elsewhere, set `BOURSE_DATA_DIR` in `.env`. The folder must exist: Compose does
not create it, so the database never silently lands on the USB key if the disk is missing.

## 4. Configure

Put `docker-compose.yml` on the Pi (for example in `/mnt/data/apps/traficbourse`, a clone of
the repository is the simplest way to keep it up to date). Next to it, put a `.env` copied
from `.env.example`. Variables read by Compose:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOURSE_DATA_DIR` | `/mnt/data/bourse` | Host folder of the SQLite file |
| `IMAGE_TAG` | `latest` | Image tag to pull and run: `latest` or a full commit SHA |
| `PLATFORM` | `linux/arm64` | Image platform (`linux/amd64` on an x86 machine) |
| `WEB_PORT` | `3000` | Host port of `web` |
| `WEB_BIND` | `127.0.0.1` | Host address `web` is published on. Must stay `127.0.0.1` behind the host Caddy |

`WEB_BIND` keeps the app reachable only from the Pi itself, so every request goes through
Cloudflare Tunnel and Caddy. Do not set it to `0.0.0.0` or a LAN address: Docker writes its
own iptables rules ahead of ufw, so anyone on the LAN (or through a router port-forward or a
routable IPv6 address) could reach `http://<pi>:3000` directly and skip Cloudflare Access on
`/admin` and the rate limit on `/api/mcp`.

The same `.env` is passed to the containers, with the app settings listed in
[README.md](./README.md#configuration). Set `MCP_TOKEN` there (`openssl rand -hex 32`): without
it, every request on `/api/mcp` answers `401`. Never commit it.

To connect the Claude connector through OAuth instead of a header (`CLAUDE.md` §8, option B; details in [README.md](./README.md#oauth-login-for-the-claude-connector)), also set in `.env`:

- `PUBLIC_URL`: the exact https origin of the site, for example `https://bourse.example.com` (no path, no trailing slash). It is the issuer and the base of the OAuth endpoints, so a wrong value breaks the login. Unset, the OAuth endpoints answer `503` and `/api/mcp` accepts `MCP_TOKEN` only.
- `MCP_OAUTH_PASSWORD`: at least 16 characters (`openssl rand -base64 24`), typed on the login page. Changing it, then restarting `web` (`docker compose up -d web`), revokes every OAuth token already issued: the connector has to log in again.

OAuth rows (clients, codes, tokens) that expired are not purged yet; they stay in the database until a later change removes them.

### Cloudflare and Caddy for OAuth

- **Access bypass**: Claude cannot pass Access, so if an Access application covers these paths (for example one on the whole host name), bypass exactly `/api/mcp`, `/.well-known/oauth-protected-resource*`, `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/token` and `/oauth/authorize`, and nothing broader. `/admin` stays behind Access.
- **Rate limiting**: add a Cloudflare rate-limit rule on `/oauth/*` as well as on `/api/mcp`. The app also locks the login after 5 wrong passwords per address, but only Cloudflare stops the flood before it reaches the Pi.
- **Client address**: the login lockout reads the `CF-Connecting-IP` header. Caddy must not let a client on the LAN forge it: keep the site reachable only through the tunnel (bind it to loopback, or to the tunnel's address, never to the LAN), or strip the header from requests that did not come from Cloudflare. A forged address would let an attacker dodge the per-address lockout.

## 5. Log in to GHCR

The repository is private, so the GHCR package is private too: the Pi must log in once
before it can pull. The first push from CI creates the package and links it to the
repository (the workflow token pushes it, and the image carries the
`org.opencontainers.image.source` label); check under the repository's "Packages" that it is
there.

1. On GitHub, create a **classic** personal access token (Settings → Developer settings →
   Personal access tokens → Tokens (classic)) with the `read:packages` scope only, and an
   expiry date. GHCR does not accept fine-grained tokens (at the time of writing).
2. On the Pi, as the user that runs `docker compose`:

   ```bash
   docker login ghcr.io -u vidal-dorian --password-stdin   # paste the token, then Ctrl-D
   ```

Docker stores the credentials in `~/.docker/config.json` on the Pi. The token never goes in
the repository, in `.env` or in a shell history. When it expires, create a new one and log in
again.

Alternative: make the package public (package settings → Change visibility → Public); the Pi
then pulls without logging in. The image contains the built application, so anyone could
download it, even though the repository stays private.

## 6. Start

```bash
docker compose pull && docker compose up -d --no-build
docker compose ps -a                 # web healthy, jobs running, migrate exited (0)
curl -s http://127.0.0.1:3000/api/health
```

Always pull first and start with `--no-build`. `web` also has a `build:` section (for the
local fallback below): without `--no-build`, a failed pull (expired token, unknown tag, no
image for that commit) makes Compose quietly build the current checkout and tag it with the
GHCR name, so the Pi would run code that CI never checked. `docker compose pull` exits with
an error when the pull is denied, so `&&` stops before `up`.

`migrate`, `web` and `jobs` run the same image, `ghcr.io/vidal-dorian/traficbourse:latest`
(or the tag in `IMAGE_TAG`). `web` and `jobs` restart on their own after a crash or a reboot
(`restart: unless-stopped`).

## Update

After a push on `main`, wait for the CI run to finish (Actions tab), then:

```bash
docker compose pull && docker compose up -d --no-build
docker image prune -f                # drop the old images
```

`up -d` runs `migrate` again before restarting `web` and `jobs`.

## Logs

```bash
docker compose logs -f web
docker compose logs --tail 100 jobs
```

## Roll back

Every image pushed by CI is also tagged with its full commit SHA (40 characters, as shown in
the commit list on GitHub or on the package page). Run a previous one, either for one command
or by setting `IMAGE_TAG=<commit-sha>` in `.env`:

```bash
IMAGE_TAG=<previous-commit-sha> docker compose pull && IMAGE_TAG=<previous-commit-sha> docker compose up -d --no-build
```

If the pull fails (mistyped SHA, expired token, or no image for that commit because its CI run
failed or was superseded by a newer push), the command stops there and the current version
keeps running: never drop `--no-build`, or Compose would build the current checkout and tag it
with the old SHA.

Remove `IMAGE_TAG` from `.env` to follow `latest` again. Migrations only go forward: if the
faulty version changed the schema, restore a backup of `bourse.db` (taken with
`docker compose stop` first) before starting the older image.

## CI cost

GitHub's hosted arm64 runners are not included for free in private repositories (at the time
of writing), so the publish job builds the `linux/arm64` image on a standard x64 runner under
QEMU emulation, which is several times slower than a native build. Those minutes count
against the Actions quota of the account (2,000 minutes a month on GitHub Free for private
repositories, at the time of writing). To keep them down, the build reuses the
GitHub Actions cache (`cache-from`/`cache-to` `type=gha`), only `main` publishes (pull
requests run the checks, without building the image), and a newer push on a pull request
cancels the run in progress. Watch the duration of the first runs in the Actions tab and the
usage under Settings → Billing. If it gets too expensive, a native arm64 runner (hosted or
self-hosted) would replace QEMU.

## Build locally (fallback)

Without GHCR (CI down, or a test of uncommitted changes), the image can still be built on the
Pi from a clone of the repository. Only `web` has a `build:` section; the image it builds is
tagged with the shared `image:` name, so `migrate` and `jobs` run that same local image:

```bash
git pull
docker compose build && docker compose up -d
```

The next `docker compose pull` replaces it with the CI image.

## On an x86 machine

```bash
PLATFORM=linux/amd64 docker compose up -d --build
```

CI only publishes `linux/arm64`, so an x86 machine always builds locally. On a machine
without the data disk, point `BOURSE_DATA_DIR` to an existing folder writable by uid 1000
(see [README.md](./README.md#docker)).
