# Deploying on the Pi

How to run TraficBourse on the Raspberry Pi with Docker Compose. Nothing here is run by the
agent.

There is no CI workflow yet: the one that builds the `linux/arm64` image and pushes it to
GHCR (`ghcr.io/vidal-dorian/traficbourse`), with its tags, comes with story #9. Until then,
the image is built on the Pi itself from the repository (section 5). Pulling, updating and
rolling back from GHCR are described at the end, under [With the CI image](#with-the-ci-image-story-9).

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

Clone the repository on the Pi (for example in `/mnt/data/apps/traficbourse`): the local
build needs the whole source, not only `docker-compose.yml`. Next to `docker-compose.yml`,
put a `.env` copied from `.env.example`. Variables read by Compose:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOURSE_DATA_DIR` | `/mnt/data/bourse` | Host folder of the SQLite file |
| `IMAGE_TAG` | `latest` | Image tag to build or run |
| `PLATFORM` | `linux/arm64` | Image platform (`linux/amd64` on an x86 machine) |
| `WEB_PORT` | `3000` | Host port of `web` |
| `WEB_BIND` | `127.0.0.1` | Host address `web` is published on. Must stay `127.0.0.1` behind the host Caddy |

`WEB_BIND` keeps the app reachable only from the Pi itself, so every request goes through
Cloudflare Tunnel and Caddy. Do not set it to `0.0.0.0` or a LAN address: Docker writes its
own iptables rules ahead of ufw, so anyone on the LAN (or through a router port-forward or a
routable IPv6 address) could reach `http://<pi>:3000` directly and skip Cloudflare Access on
`/admin` and the rate limit on `/api/mcp`.

The same `.env` is passed to the containers (secrets such as `MCP_TOKEN` go there later).
Never commit it.

## 5. Build and start

From the clone on the Pi:

```bash
docker compose build
docker compose up -d
docker compose ps -a                 # web healthy, jobs running, migrate exited (0)
curl -s http://127.0.0.1:3000/api/health
```

Only `web` has a `build:` section. The image it builds is tagged with the shared `image:`
name (`ghcr.io/vidal-dorian/traficbourse:latest`, or `IMAGE_TAG`), so `migrate` and `jobs`
run that same local image. Do not run `docker compose pull` yet: there is no image on GHCR
before the CI workflow, and the pull of `migrate` and `jobs` fails.

`web` and `jobs` restart on their own after a crash or a reboot (`restart: unless-stopped`).

## Update

```bash
git pull
docker compose build && docker compose up -d
docker image prune -f                # drop the old images
```

`up -d` runs `migrate` again before restarting `web` and `jobs`.

## Logs

```bash
docker compose logs -f web
docker compose logs --tail 100 jobs
```

## Roll back

Without CI there are no earlier image tags: check out the previous commit and rebuild.

```bash
git checkout <previous-commit>
docker compose build && docker compose up -d
```

Migrations only go forward: if the faulty version changed the schema, restore a backup of
`bourse.db` (taken with `docker compose stop` first) before starting the older image.

## On an x86 machine

```bash
PLATFORM=linux/amd64 docker compose up -d --build
```

On a machine without the data disk, point `BOURSE_DATA_DIR` to an existing folder writable by
uid 1000 (see [README.md](./README.md#docker)).

## With the CI image (story #9)

Once the CI workflow builds the `linux/arm64` image and pushes it to GHCR, the Pi no longer
builds: it only pulls and restarts. If the GHCR package is private, log in once with
`docker login ghcr.io` (a GitHub token with `read:packages`).

Start and update:

```bash
docker compose pull && docker compose up -d
docker image prune -f                # drop the old images
```

Roll back by setting a previous tag pushed by CI, either in `.env` (`IMAGE_TAG=<tag>`) or for
one command (the migration warning above still applies):

```bash
IMAGE_TAG=<previous-tag> docker compose up -d
```
