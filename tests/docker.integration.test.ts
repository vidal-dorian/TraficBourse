// US #8 — Docker Compose stack, end to end. Gated: runs only with DOCKER_TESTS=1.
//
//   DOCKER_TESTS=1 npx vitest run tests/docker.integration.test.ts
//   (PLATFORM defaults to the host platform, e.g. linux/amd64 on an x86 machine)
//
// Contract:
// - `docker compose up -d --build` with IMAGE_TAG, PLATFORM, BOURSE_DATA_DIR and WEB_PORT set
//   builds the image and starts `web` and `jobs`; migrations are applied automatically
//   before the app serves (the `app_meta` table exists).
// - `web` publishes port 3000 on `${WEB_PORT}` and answers GET /api/health with 200
//   `{ status: "ok", db: { status: "ok", journalMode: "wal" } }`.
// - `web` and `jobs` run from the same image id, as a non-root user.
// - The database file (basename of DATABASE_PATH) is created in BOURSE_DATA_DIR on the host.
// - `node` in the image can open DATABASE_PATH (used here to write and read a row).
// - Every container logs with json-file, max-size and max-file.
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeService, environmentOf } from "./helpers/compose";
import {
  APP_META_SCRIPT,
  ComposeProject,
  DOCKER_TESTS_ENABLED,
  freePort,
  hostPlatform,
  inspect,
  waitForHttpOk,
} from "./helpers/docker";
import { makeTempDir } from "./helpers/sqlite";

const IMAGE_REPOSITORY = "ghcr.io/vidal-dorian/traficbourse";
const BUILD_TIMEOUT_MS = 20 * 60_000;
const HEALTH_TIMEOUT_MS = 120_000;

describe.skipIf(!DOCKER_TESTS_ENABLED)("US #8 — Docker Compose stack (DOCKER_TESTS=1)", () => {
  const unique = `${process.pid}-${Date.now().toString(36)}`;
  const platform = hostPlatform();
  const imageTag = `test-us8-${unique}`;
  let dataDir: string;
  let healthUrl: string;
  let project: ComposeProject;

  async function waitForHealth(): Promise<unknown> {
    return waitForHttpOk(healthUrl, HEALTH_TIMEOUT_MS, () => project.logs());
  }

  function appMeta(mode: "write" | "read", key: string, value?: string): string {
    const args = ["exec", "-T", "web", "node", "--no-warnings", "-e", APP_META_SCRIPT, mode, key];
    return project.run(value === undefined ? args : [...args, value]);
  }

  function expectRunning(service: string): void {
    expect(inspect(project.containerId(service), "{{.State.Status}}"), `${service} state`).toBe("running");
  }

  beforeAll(async () => {
    dataDir = makeTempDir("bourse-docker-data-");
    // The container runs as a non-root uid: let it write the bind-mounted folder.
    chmodSync(dataDir, 0o777);
    const port = await freePort();
    healthUrl = `http://127.0.0.1:${port}/api/health`;
    project = new ComposeProject(`bourse-us8-${unique}`, {
      IMAGE_TAG: imageTag,
      PLATFORM: platform,
      BOURSE_DATA_DIR: dataDir,
      WEB_PORT: String(port),
    });

    project.run(["up", "-d", "--build"], BUILD_TIMEOUT_MS);
    await waitForHealth();
  }, BUILD_TIMEOUT_MS + HEALTH_TIMEOUT_MS);

  afterAll(() => {
    if (project) {
      try {
        project.run(["down", "--volumes", "--remove-orphans", "--rmi", "all"], 300_000);
      } catch (error) {
        console.error(error);
      }
    }
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  }, 300_000);

  it("C37 — given the Pi, when I run `docker compose up -d`, then the web and jobs containers start from the same image", async () => {
    // jobs must stay up, not crash-loop: give it a few seconds after web is healthy.
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    expectRunning("web");
    expectRunning("jobs");

    const webId = project.containerId("web");
    const jobsId = project.containerId("jobs");
    expect(inspect(jobsId, "{{.RestartCount}}"), "jobs restarts").toBe("0");

    const imageId = inspect(webId, "{{.Image}}");
    expect(inspect(jobsId, "{{.Image}}")).toBe(imageId);
    expect(inspect(webId, "{{.Config.Image}}")).toBe(`${IMAGE_REPOSITORY}:${imageTag}`);
    expect(inspect(imageId, "{{.Os}}/{{.Architecture}}")).toBe(platform);

    for (const service of ["web", "jobs"]) {
      expect(project.run(["exec", "-T", service, "id", "-u"]), `${service} runs as non-root`).not.toBe("0");
    }
  });

  it("C38 — given the compose file, when the stack runs, then the database file is created in BOURSE_DATA_DIR on the host", async () => {
    const body = await waitForHealth();
    expect(body).toMatchObject({ status: "ok", db: { status: "ok", journalMode: "wal" } });

    const databasePath = environmentOf(composeService("web")).DATABASE_PATH ?? "";
    expect(databasePath).toBeTruthy();
    expect(existsSync(join(dataDir, basename(databasePath))), `database expected in ${dataDir}`).toBe(true);
  });

  it("C39 — given data in the database, when I restart the containers, then it is kept", async () => {
    const key = `c39-restart-${randomUUID()}`;
    appMeta("write", key, "kept");

    project.run(["restart"], 300_000);
    await waitForHealth();
    expectRunning("web");
    expectRunning("jobs");

    expect(JSON.parse(appMeta("read", key))).toEqual({ value: "kept" });
  });

  it("C39 — given data in the database, when the containers are recreated (down then up), then it is kept", async () => {
    const key = `c39-recreate-${randomUUID()}`;
    appMeta("write", key, "kept");

    project.run(["down"], 300_000);
    project.run(["up", "-d"], 300_000);
    await waitForHealth();

    expect(JSON.parse(appMeta("read", key))).toEqual({ value: "kept" });
  });

  it("C40 — given the containers running, when they run for several days, then their logs are size-limited (json-file rotation)", () => {
    const ids = project.allContainerIds();
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (const id of ids) {
      const name = inspect(id, "{{.Name}}");
      const logConfig = JSON.parse(inspect(id, "{{json .HostConfig.LogConfig}}")) as {
        Type: string;
        Config: Record<string, string>;
      };
      expect(logConfig.Type, name).toBe("json-file");
      expect(logConfig.Config["max-size"], `${name} max-size`).toBeTruthy();
      expect(logConfig.Config["max-file"], `${name} max-file`).toBeTruthy();
    }
  });
});
