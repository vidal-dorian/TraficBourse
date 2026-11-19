// US #8 — Run the app on the Pi with Docker Compose (static checks, no Docker needed).
//
// Contract:
// - `docker-compose.yml` at the repo root, with (at least) services `web` and `jobs`.
// - Both use the same image `ghcr.io/vidal-dorian/traficbourse:${IMAGE_TAG:-latest}`,
//   `platform: ${PLATFORM:-linux/arm64}`, and different commands; at least one of them has a
//   `build:` section for local builds.
// - Both bind-mount `${BOURSE_DATA_DIR:-/mnt/data/bourse}` (on the host) and set an absolute
//   `DATABASE_PATH` that lies under that mount, identical in both services.
//   `.env.example` documents BOURSE_DATA_DIR.
// - Every service logs with the `json-file` driver and both `max-size` and `max-file` options.
// - Multi-stage `Dockerfile` on node:22; its runtime stage copies `.next/standalone`,
//   `.next/static` and the SQL migrations, and runs as a non-root user.
// The end-to-end checks (containers really start, data survives a restart) live in
// tests/docker.integration.test.ts, gated by DOCKER_TESTS=1.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commandOf,
  composeService,
  composeServices,
  environmentOf,
  interpolate,
  mountHolding,
} from "./helpers/compose";
import { rootPath } from "./helpers/project";

const APP_SERVICES = ["web", "jobs"] as const;
const IMAGE_REPOSITORY = "ghcr.io/vidal-dorian/traficbourse";

type Stage = { from: string; lines: string[] };

/** Splits the Dockerfile into its build stages (instructions joined across `\` continuations). */
function dockerfileStages(): Stage[] {
  const path = rootPath("Dockerfile");
  if (!existsSync(path)) throw new Error("Dockerfile is missing at the repo root");
  const instructions = readFileSync(path, "utf8")
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const stages: Stage[] = [];
  for (const line of instructions) {
    if (/^FROM\s/i.test(line)) stages.push({ from: line, lines: [] });
    else stages.at(-1)?.lines.push(line);
  }
  return stages;
}

/** Size in bytes of a Docker log size such as "10m", "512k", "1g". */
function parseLogSize(value: string): number {
  const match = /^(\d+)\s*([kmg]?)b?$/i.exec(value.trim());
  if (!match) return Number.NaN;
  const unit = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2].toLowerCase() as "" | "k" | "m" | "g"];
  return Number(match[1]) * unit;
}

describe("C37 — web and jobs start from the same arm64 image", () => {
  it("C37 — given the Pi, when I run `docker compose up -d`, then the web and jobs services use the same image reference", () => {
    const web = composeService("web");
    const jobs = composeService("jobs");

    expect(web.image, "web must declare an image").toBeTruthy();
    expect(jobs.image).toBe(web.image);
    expect(interpolate(web.image ?? "")).toBe(`${IMAGE_REPOSITORY}:latest`);
    expect(interpolate(web.image ?? "", { IMAGE_TAG: "sha-1234567" })).toBe(`${IMAGE_REPOSITORY}:sha-1234567`);
  });

  it("C37 — given the Pi, when I run `docker compose up -d`, then the image platform defaults to linux/arm64 and can be overridden with PLATFORM", () => {
    for (const name of APP_SERVICES) {
      const platform = composeService(name).platform;
      expect(platform, `${name} must declare a platform`).toBeTruthy();
      expect(interpolate(platform ?? ""), name).toBe("linux/arm64");
      expect(interpolate(platform ?? "", { PLATFORM: "linux/amd64" }), name).toBe("linux/amd64");
    }
  });

  it("C37 — given the Pi, when I run `docker compose up -d`, then web and jobs run different commands from that image", () => {
    expect(commandOf(composeService("jobs"))).not.toBe(commandOf(composeService("web")));
    expect(commandOf(composeService("jobs")), "jobs must override the image command").not.toBe("|");
  });

  it("C37 — given the repo, when I look at the compose file, then the shared image can be built locally (build section)", () => {
    const withBuild = APP_SERVICES.filter((name) => composeService(name).build !== undefined);
    expect(withBuild.length, "web or jobs must declare a build section").toBeGreaterThan(0);
  });

  it("C37 — given the repo, when I read the Dockerfile, then it is a multi-stage node:22 build whose runtime stage ships the standalone Next.js server and runs as non-root", () => {
    const stages = dockerfileStages();
    expect(stages.length, "the Dockerfile must have several stages").toBeGreaterThanOrEqual(2);
    const aliases: string[] = [];
    for (const stage of stages) {
      const match = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?$/i.exec(stage.from);
      expect(match, `unexpected FROM line: ${stage.from}`).not.toBeNull();
      const [, base, alias] = match!;
      const fromNode22 = /^(docker\.io\/)?(library\/)?node:22([.-]\S*)?(@\S+)?$/i.test(base);
      const fromEarlierStage = aliases.includes(base.toLowerCase());
      expect(fromNode22 || fromEarlierStage, `stage "${stage.from}" must be based on node:22 or an earlier stage`).toBe(true);
      if (alias) aliases.push(alias.toLowerCase());
    }

    const runtime = stages.at(-1)!;
    const copies = runtime.lines.filter((line) => /^COPY\s/i.test(line)).join("\n");
    expect(copies, "runtime stage copies .next/standalone").toMatch(/\.next\/standalone/);
    expect(copies, "runtime stage copies .next/static").toMatch(/\.next\/static/);
    expect(copies, "runtime stage ships the SQL migrations").toMatch(/migrations/);

    const users = runtime.lines.filter((line) => /^USER\s/i.test(line));
    expect(users.length, "runtime stage must switch to a non-root user").toBeGreaterThan(0);
    expect(users.at(-1)).not.toMatch(/^USER\s+(root|0)(:\S*)?$/i);
  });
});

describe("C38 — the database lives on the data disk", () => {
  it("C38 — given the compose file, when I look at the volumes, then the database is bind-mounted from /mnt/data/bourse by default", () => {
    for (const name of APP_SERVICES) {
      const service = composeService(name);
      const databasePath = environmentOf(service).DATABASE_PATH;
      expect(databasePath, `${name} must set DATABASE_PATH`).toBeTruthy();
      expect(isAbsolute(databasePath), `${name} DATABASE_PATH must be absolute`).toBe(true);

      const mount = mountHolding(service, databasePath);
      expect(mount, `${name}: DATABASE_PATH (${databasePath}) must be under a mounted folder`).toBeDefined();
      expect(mount).toMatchObject({ type: "bind", source: "/mnt/data/bourse" });
    }
  });

  it("C38 — given the compose file, when BOURSE_DATA_DIR is set, then the database folder on the host is that path", () => {
    const env = { BOURSE_DATA_DIR: "/srv/elsewhere/bourse" };
    for (const name of APP_SERVICES) {
      const service = composeService(name);
      const mount = mountHolding(service, environmentOf(service, env).DATABASE_PATH ?? "", env);
      expect(mount, name).toMatchObject({ type: "bind", source: "/srv/elsewhere/bourse" });
    }
  });

  it("C38 — given the compose file, when I compare web and jobs, then they share the same database file", () => {
    expect(environmentOf(composeService("jobs")).DATABASE_PATH).toBe(
      environmentOf(composeService("web")).DATABASE_PATH,
    );
  });

  it("C38 — given the repo, when I read .env.example, then it documents BOURSE_DATA_DIR", () => {
    const envExample = readFileSync(rootPath(".env.example"), "utf8");
    expect(envExample).toMatch(/^\s*#?\s*BOURSE_DATA_DIR=/m);
  });
});

describe("C39 — data is kept across restarts (static part)", () => {
  it("C39 — given data in the database, when I restart the containers, then it is kept because the database folder is a writable host bind mount, not container storage", () => {
    for (const name of APP_SERVICES) {
      const service = composeService(name);
      const databasePath = environmentOf(service).DATABASE_PATH ?? "";
      const mount = mountHolding(service, databasePath);
      expect(mount?.type, `${name}: database folder must be a host bind mount`).toBe("bind");
      const raw = (service.volumes ?? []).find((entry) =>
        typeof entry === "string" ? entry.includes(`:${mount?.target}`) : entry.target === mount?.target,
      );
      expect(typeof raw === "string" ? raw : JSON.stringify(raw), `${name}: database mount must be writable`).not.toMatch(
        /:ro$|"read_only":true/,
      );
    }
  });
});

describe("C40 — container logs are size-limited", () => {
  it("C40 — given the containers running, when they run for several days, then every service logs with json-file, max-size and max-file", () => {
    const services = composeServices();
    expect(Object.keys(services)).toEqual(expect.arrayContaining([...APP_SERVICES]));

    for (const [name, service] of Object.entries(services)) {
      expect(service.logging?.driver, `${name}: logging driver`).toBe("json-file");
      const maxSize = String(service.logging?.options?.["max-size"] ?? "");
      const maxFile = Number(service.logging?.options?.["max-file"]);
      const bytes = parseLogSize(maxSize);
      expect(bytes, `${name}: max-size "${maxSize}" must be a size such as 10m`).toBeGreaterThan(0);
      expect(Number.isInteger(maxFile) && maxFile >= 1, `${name}: max-file must be a positive integer`).toBe(true);
      // The data disk is ~40 GB: logs of one container stay well under 1 GB.
      expect(bytes * maxFile, `${name}: total log size`).toBeLessThanOrEqual(1024 ** 3);
    }
  });
});
