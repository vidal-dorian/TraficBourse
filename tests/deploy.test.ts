// US #8 — story notes and design guidance around the Docker setup (static checks).
//
// Contract:
// - `DEPLOY.md` at the repo root mentions moving Docker's `data-root` (in
//   /etc/docker/daemon.json) to the data disk, the `/mnt/data/bourse` folder,
//   `docker compose up -d` and rollback through `IMAGE_TAG`.
// - `.dockerignore` excludes node_modules, .next, .env and .git.
// - `web` and `jobs` come back after a reboot (`restart: unless-stopped` or `always`).
// - Jobs entrypoint `src/jobs/index.ts` uses node-cron (runtime dependency) with the
//   Europe/Paris timezone set explicitly.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeService } from "./helpers/compose";
import { readPackageJson, rootPath } from "./helpers/project";

function readRootFile(name: string): string {
  const path = rootPath(name);
  if (!existsSync(path)) throw new Error(`${name} is missing at the repo root`);
  return readFileSync(path, "utf8");
}

describe("US #8 notes — DEPLOY.md", () => {
  it("given DEPLOY.md, when Dorian prepares the Pi, then it tells him to move Docker's data-root to the 40 GB data disk", () => {
    const deploy = readRootFile("DEPLOY.md");

    expect(deploy).toMatch(/data-root/);
    expect(deploy).toMatch(/\/etc\/docker\/daemon\.json/);
    expect(deploy).toMatch(/\/mnt\/data/);
  });

  it("given DEPLOY.md, when Dorian deploys, then it explains the data folder, starting the stack and rolling back with IMAGE_TAG", () => {
    const deploy = readRootFile("DEPLOY.md");

    expect(deploy).toMatch(/\/mnt\/data\/bourse/);
    expect(deploy).toMatch(/BOURSE_DATA_DIR/);
    expect(deploy).toMatch(/docker compose up -d/);
    expect(deploy).toMatch(/IMAGE_TAG/);
  });
});

describe("US #8 notes — image build context", () => {
  it("given .dockerignore, when the image is built, then local artefacts and secrets stay out of the build context", () => {
    const entries = readRootFile(".dockerignore")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\/+|\/+$/g, ""))
      .filter((line) => line && !line.startsWith("#"));

    for (const required of ["node_modules", ".next", ".env", ".git"]) {
      expect(entries, `.dockerignore must exclude ${required}`).toContain(required);
    }
  });
});

describe("US #8 notes — services survive a reboot of the Pi", () => {
  it("given the Pi reboots, when Docker starts again, then web and jobs restart on their own", () => {
    for (const name of ["web", "jobs"]) {
      expect(composeService(name).restart, name).toMatch(/^(unless-stopped|always)$/);
    }
  });
});

describe("US #8 notes — jobs entrypoint", () => {
  it("given the jobs container, when it starts, then its cron entrypoint uses node-cron with the Europe/Paris timezone", () => {
    const pkg = readPackageJson();
    expect(pkg.dependencies?.["node-cron"], "node-cron must be a runtime dependency").toBeDefined();

    const path = rootPath("src", "jobs", "index.ts");
    expect(existsSync(path), "src/jobs/index.ts must exist").toBe(true);
    const source = readFileSync(path, "utf8");
    expect(source).toMatch(/node-cron/);
    expect(source).toMatch(/Europe\/Paris/);
  });
});
