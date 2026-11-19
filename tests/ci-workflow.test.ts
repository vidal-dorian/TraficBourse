// US #9 — Every push on main produces an image ready for the Pi (static checks of the CI
// workflow, no GitHub needed). The runs are simulated: triggers, job `if:` conditions (with
// GitHub's implicit `success()`), `needs` and step inputs are evaluated for a push on main,
// a push on another branch, a PR into main and a stacked PR (base = another story branch).
//
// Contract:
// - One workflow `.github/workflows/ci.yml`, triggered by `push` (main included, no path
//   filter) and `pull_request` without any branch or path filter. No `pull_request_target`.
// - A job (e.g. `check`) runs `npm run lint` and `npm test` (plus `npm ci`, `npm run
//   typecheck`, `npm run build`, on Node 22 with the npm cache), on every push and PR, with no
//   `continue-on-error` and no `|| true` on lint and test.
// - Exactly one job (e.g. `publish`) can push an image. It `needs` the job(s) running lint and
//   tests, runs only for a push on main (skipped on PRs and other branches), and has
//   `permissions: packages: write`; the workflow-level `permissions` do not grant it.
// - That job logs into `ghcr.io` with `docker/login-action` (`${{ github.actor }}`,
//   `${{ secrets.GITHUB_TOKEN }}`), sets up QEMU and buildx, then pushes with
//   `docker/build-push-action`: `platforms: linux/arm64` exactly, `push: true`, tags
//   `ghcr.io/vidal-dorian/traficbourse:latest` and `ghcr.io/vidal-dorian/traficbourse:<full sha>`
//   (literal, or through `docker/metadata-action` via `steps.<id>.outputs.tags`), and the
//   `org.opencontainers.image.source` label (literal or `steps.<id>.outputs.labels`).
// - Story notes: workflow-level `concurrency` keyed on `github.ref`, cancelling PR runs only;
//   every remote action pinned to a full commit SHA with its version in a comment;
//   `.github/dependabot.yml` for github-actions, npm and docker (weekly); DEPLOY.md makes the
//   GHCR image the main path (docker login with a `read:packages` token or a public package,
//   minutes cost of the QEMU build).
// Gated check: with ACTIONLINT_BIN=/path/to/actionlint, the workflow passes actionlint.
// C41 and C42 are only proven live after a merge to main; C43 by the PR's own run.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { rootPath } from "./helpers/project";
import {
  BUILD_PUSH_ACTION,
  FAKE_SHA,
  LOGIN_ACTION,
  NPM_LINT,
  NPM_TEST,
  PULL_REQUESTS,
  PUSH_MAIN,
  PUSH_OTHER_BRANCH,
  WORKFLOW_FILE,
  expressionContext,
  imageLabelsSource,
  jobRuns,
  publishingJobIds,
  pushCapableSteps,
  readWorkflow,
  resolveInput,
  resolvedImageTags,
  stepPushes,
  stepRuns,
  stepsRunning,
  stepsUsing,
  transitiveNeeds,
  triggers,
  workflowJobs,
  workflowTriggered,
  type Job,
  type Step,
  type Workflow,
} from "./helpers/workflow";

const IMAGE_REPOSITORY = "ghcr.io/vidal-dorian/traficbourse";

/** The only job able to push an image; fails readably when there is none or several. */
function publishJob(workflow: Workflow): { id: string; job: Job } {
  const ids = publishingJobIds(workflow);
  expect(ids, "exactly one job must be able to push an image").toHaveLength(1);
  return { id: ids[0], job: workflowJobs(workflow)[ids[0]] };
}

/** The docker/build-push-action step of the publish job. */
function buildStep(job: Job): Step {
  const steps = stepsUsing(job, BUILD_PUSH_ACTION);
  expect(steps, `the publish job must build with ${BUILD_PUSH_ACTION}`).toHaveLength(1);
  return steps[0];
}

function stepIndex(job: Job, step: Step): number {
  return (job.steps ?? []).indexOf(step);
}

/** Ids of the jobs with a step running `pattern` (e.g. `npm test`). */
function jobsRunning(workflow: Workflow, pattern: RegExp): string[] {
  return Object.entries(workflowJobs(workflow))
    .filter(([, job]) => stepsRunning(job, pattern).length > 0)
    .map(([id]) => id);
}

function grantsPackagesWrite(permissions: Record<string, string> | string | undefined): boolean {
  if (permissions === undefined) return false;
  if (typeof permissions === "string") return permissions === "write-all";
  return permissions.packages === "write";
}

describe("C41 — a push on main publishes the linux/arm64 image on GHCR", () => {
  it("C41 — given a push on main, when GitHub receives it, then the CI workflow runs for every such push (no path filter)", () => {
    const workflow = readWorkflow();
    const push = triggers(workflow).push;

    expect(workflowTriggered(workflow, PUSH_MAIN), "the workflow must be triggered by a push on main").toBe(true);
    expect(push?.paths, "on.push must not filter on paths").toBeUndefined();
    expect(push?.["paths-ignore"], "on.push must not filter on paths").toBeUndefined();
  });

  it("C41 — given a push on main with passing tests, when the CI finishes, then the single publish job runs after the tests", () => {
    const workflow = readWorkflow();
    const { id } = publishJob(workflow);
    const testJobs = jobsRunning(workflow, NPM_TEST);

    expect(jobRuns(workflow, id, PUSH_MAIN), `job "${id}" must run on a push on main`).toBe(true);
    expect(testJobs.some((testJob) => transitiveNeeds(workflow, id).has(testJob)), `job "${id}" must need the job running npm test`).toBe(true);
  });

  it("C41 — given a push on main with passing tests, when the publish job runs, then it builds with buildx for linux/arm64 only and pushes", () => {
    const workflow = readWorkflow();
    const { job } = publishJob(workflow);
    const build = buildStep(job);
    const ctx = expressionContext(workflow, job, PUSH_MAIN, true, build);
    const qemu = stepsUsing(job, "docker/setup-qemu-action")[0];
    const buildx = stepsUsing(job, "docker/setup-buildx-action")[0];

    expect(resolveInput(build.with?.platforms, ctx).replace(/\s/g, "")).toBe("linux/arm64");
    expect(stepPushes(workflow, job, build, PUSH_MAIN), "the build step must push on a push on main").toBe(true);
    expect(qemu, "the publish job must set up QEMU (docker/setup-qemu-action)").toBeDefined();
    expect(buildx, "the publish job must set up buildx (docker/setup-buildx-action)").toBeDefined();
    expect(stepIndex(job, qemu)).toBeLessThan(stepIndex(job, build));
    expect(stepIndex(job, buildx)).toBeLessThan(stepIndex(job, build));
  });

  it("C41 — given a push on main with passing tests, when the image is pushed, then it is tagged latest and the full commit SHA on ghcr.io/vidal-dorian/traficbourse", () => {
    const workflow = readWorkflow();
    const { job } = publishJob(workflow);
    const tags = resolvedImageTags(workflow, job, buildStep(job), PUSH_MAIN);

    expect(tags).toContain(`${IMAGE_REPOSITORY}:latest`);
    expect(tags).toContain(`${IMAGE_REPOSITORY}:${FAKE_SHA}`);
    for (const tag of tags) expect(tag.startsWith(`${IMAGE_REPOSITORY}:`), tag).toBe(true);
  });

  it("C41 — given a push on main with passing tests, when the publish job runs, then it logs into ghcr.io with the workflow's GITHUB_TOKEN before pushing", () => {
    const workflow = readWorkflow();
    const { job } = publishJob(workflow);
    const login = stepsUsing(job, LOGIN_ACTION).find((step) => String(step.with?.registry ?? "").trim() === "ghcr.io");

    expect(login, `the publish job must log in with ${LOGIN_ACTION} and registry: ghcr.io`).toBeDefined();
    expect(String(login?.with?.username ?? "")).toMatch(/^\$\{\{\s*github\.actor\s*\}\}$/);
    expect(String(login?.with?.password ?? "")).toMatch(/^\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}$/);
    expect(stepRuns(workflow, job, login!, PUSH_MAIN), "the login step must run on a push on main").toBe(true);
    expect(stepIndex(job, login!)).toBeLessThan(stepIndex(job, buildStep(job)));
  });

  it("C41 — given the CI token, when the workflow runs, then only the publish job may write packages", () => {
    const workflow = readWorkflow();
    const { id, job } = publishJob(workflow);
    const top = workflow.permissions;

    expect(top, "the workflow must set top-level permissions (contents: read)").toBeDefined();
    expect(grantsPackagesWrite(top), "top-level permissions must not grant packages: write").toBe(false);
    expect(typeof top === "object" ? top.contents : top).toBe("read");
    expect(grantsPackagesWrite(job.permissions), `job "${id}" must have permissions packages: write`).toBe(true);
    for (const [otherId, other] of Object.entries(workflowJobs(workflow))) {
      if (otherId !== id) expect(grantsPackagesWrite(other.permissions), `job "${otherId}" must not write packages`).toBe(false);
    }
  });

  it("C41 — given a push on another branch than main, when the CI runs, then no image is published", () => {
    const workflow = readWorkflow();

    for (const [id, job] of Object.entries(workflowJobs(workflow))) {
      if (!jobRuns(workflow, id, PUSH_OTHER_BRANCH)) continue;
      for (const step of job.steps ?? []) {
        expect(stepPushes(workflow, job, step, PUSH_OTHER_BRANCH), `job "${id}" pushes an image on ${PUSH_OTHER_BRANCH.label}`).toBe(false);
      }
    }
  });
});

describe("C42 — a failing test publishes no image", () => {
  it("C42 — given the CI, when it runs, then the publish job needs the job that runs npm test and npm run lint", () => {
    const workflow = readWorkflow();
    const { id } = publishJob(workflow);
    const needed = transitiveNeeds(workflow, id);

    expect(jobsRunning(workflow, NPM_TEST).filter((job) => needed.has(job)), "publish must need a job running npm test").not.toHaveLength(0);
    expect(jobsRunning(workflow, NPM_LINT).filter((job) => needed.has(job)), "publish must need a job running npm run lint").not.toHaveLength(0);
  });

  it("C42 — given a failing test on a push on main, when the CI runs, then the publish job is skipped", () => {
    const workflow = readWorkflow();
    const { id } = publishJob(workflow);
    const needed = [...transitiveNeeds(workflow, id)];

    expect(needed, `job "${id}" must need at least one job`).not.toHaveLength(0);
    for (const failing of [...jobsRunning(workflow, NPM_TEST), ...jobsRunning(workflow, NPM_LINT), ...needed]) {
      expect(jobRuns(workflow, id, PUSH_MAIN, new Set([failing])), `job "${id}" runs although "${failing}" failed`).toBe(false);
    }
  });

  it("C42 — given a failing test, when the test or lint step fails, then nothing lets its job succeed anyway", () => {
    const workflow = readWorkflow();

    for (const pattern of [NPM_TEST, NPM_LINT]) {
      const ids = jobsRunning(workflow, pattern);
      expect(ids, `a job must run ${pattern}`).not.toHaveLength(0);
      for (const id of ids) {
        const job = workflowJobs(workflow)[id];
        expect(job["continue-on-error"] ?? false, `job "${id}" must not continue on error`).toBe(false);
        for (const step of stepsRunning(job, pattern)) {
          expect(step["continue-on-error"] ?? false, `step "${step.name ?? step.run}" must not continue on error`).toBe(false);
          expect(String(step.run), "the command must not swallow its exit code").not.toMatch(/\|\|\s*(true|:|exit 0)\b/);
          expect(stepRuns(workflow, job, step, PUSH_MAIN), `step "${step.name ?? step.run}" must run on a push on main`).toBe(true);
        }
      }
    }
  });

  it("C42 — given a failing test, when the CI runs, then no job pushes an image without waiting for the tests", () => {
    const workflow = readWorkflow();
    const testJobs = jobsRunning(workflow, NPM_TEST);
    const publishers = publishingJobIds(workflow);

    expect(publishers, "exactly one job must be able to push an image").toHaveLength(1);
    for (const id of publishers) {
      expect(testJobs.some((testJob) => transitiveNeeds(workflow, id).has(testJob)), `job "${id}" pushes without needing the tests`).toBe(true);
    }
  });
});

describe("C43 — a PR runs lint and tests without publishing", () => {
  it("C43 — given a PR against any base branch (stacked PRs included), when it is opened or updated, then the CI runs", () => {
    const workflow = readWorkflow();
    const all = triggers(workflow);
    const pullRequest = all.pull_request;

    expect("pull_request" in all, "the workflow must be triggered by pull_request").toBe(true);
    for (const filter of ["branches", "branches-ignore", "paths", "paths-ignore"]) {
      expect(pullRequest?.[filter], `on.pull_request must not set ${filter}`).toBeUndefined();
    }
    expect("pull_request_target" in all, "pull_request_target would run PR code with a write token").toBe(false);
    for (const ctx of PULL_REQUESTS) expect(workflowTriggered(workflow, ctx), ctx.label).toBe(true);
  });

  it("C43 — given a PR, when the CI runs, then lint and tests run", () => {
    const workflow = readWorkflow();

    for (const ctx of PULL_REQUESTS) {
      for (const pattern of [NPM_LINT, NPM_TEST]) {
        const running = Object.entries(workflowJobs(workflow)).some(
          ([id, job]) => jobRuns(workflow, id, ctx) && stepsRunning(job, pattern).some((step) => stepRuns(workflow, job, step, ctx)),
        );
        expect(running, `${pattern} must run on a ${ctx.label}`).toBe(true);
      }
    }
  });

  it("C43 — given a PR, when the CI runs, then the publish job is skipped", () => {
    const workflow = readWorkflow();
    const { id } = publishJob(workflow);

    for (const ctx of PULL_REQUESTS) expect(jobRuns(workflow, id, ctx), `job "${id}" must not run on a ${ctx.label}`).toBe(false);
  });

  it("C43 — given a PR, when the CI runs, then no step of any running job pushes an image", () => {
    const workflow = readWorkflow();
    publishJob(workflow);

    for (const ctx of PULL_REQUESTS) {
      for (const [id, job] of Object.entries(workflowJobs(workflow))) {
        if (!jobRuns(workflow, id, ctx)) continue;
        for (const step of job.steps ?? []) {
          expect(stepPushes(workflow, job, step, ctx), `job "${id}" pushes an image on a ${ctx.label}`).toBe(false);
        }
        expect(pushCapableSteps(job), `job "${id}" runs on a ${ctx.label} and can push an image`).toHaveLength(0);
      }
    }
  });
});

describe("US #9 notes — check job", () => {
  it("given the check job, when it runs, then it installs with npm ci on Node 22 (npm cache) and also typechecks and builds, without the Docker tests", () => {
    const workflow = readWorkflow();
    const ids = jobsRunning(workflow, NPM_TEST);
    expect(ids, "a job must run npm test").not.toHaveLength(0);

    for (const id of ids) {
      const job = workflowJobs(workflow)[id];
      const setupNode = stepsUsing(job, "actions/setup-node")[0];
      expect(setupNode, `job "${id}" must use actions/setup-node`).toBeDefined();
      expect(String(setupNode?.with?.["node-version"] ?? "")).toMatch(/^22(\.|$|\.x)/);
      expect(setupNode?.with?.cache).toBe("npm");
      expect(stepsUsing(job, "actions/checkout"), `job "${id}" must check out the repo`).not.toHaveLength(0);
      expect(stepsRunning(job, /\bnpm\s+ci\b/), `job "${id}" must run npm ci`).not.toHaveLength(0);
      expect(stepsRunning(job, /\bnpm\s+run\s+typecheck\b/), `job "${id}" must run npm run typecheck`).not.toHaveLength(0);
      expect(stepsRunning(job, /\bnpm\s+run\s+build\b/), `job "${id}" must run npm run build`).not.toHaveLength(0);

      const env = { ...workflow.env, ...job.env, ...Object.assign({}, ...stepsRunning(job, NPM_TEST).map((step) => step.env ?? {})) };
      expect(env.DOCKER_TESTS, "the Docker integration tests stay skipped in CI").toBeUndefined();
    }
  });
});

describe("US #9 notes — GHCR package linked to the repo", () => {
  it("given the pushed image, when GHCR receives it, then it carries the org.opencontainers.image.source label of the repo", () => {
    const workflow = readWorkflow();
    const { job } = publishJob(workflow);
    const build = buildStep(job);
    const { literal, fromMetadata } = imageLabelsSource(job, build);

    // docker/metadata-action always generates org.opencontainers.image.source from the repo.
    if (fromMetadata) return;
    const labels = resolveInput(literal, expressionContext(workflow, job, PUSH_MAIN, true, build));
    expect(labels.toLowerCase(), "with.labels must set org.opencontainers.image.source").toContain(
      "org.opencontainers.image.source=https://github.com/vidal-dorian/traficbourse",
    );
  });
});

describe("US #9 notes — concurrency", () => {
  it("given two runs on the same ref, when the second starts, then a PR run is cancelled but a main publish never is", () => {
    const workflow = readWorkflow();
    const concurrency = workflow.concurrency;

    expect(concurrency && typeof concurrency === "object", "workflow-level concurrency must be a map with group and cancel-in-progress").toBe(true);
    const { group, "cancel-in-progress": cancel } = concurrency as { group?: string; "cancel-in-progress"?: unknown };
    expect(String(group ?? "")).toMatch(/github\.ref\b/);

    const cancels = (ctx: typeof PUSH_MAIN) => resolveInput(cancel, expressionContext(workflow, {}, ctx, true)).trim().toLowerCase() === "true";
    expect(cancels(PUSH_MAIN), "a main run must never be cancelled midway").toBe(false);
    for (const ctx of PULL_REQUESTS) expect(cancels(ctx), `a newer ${ctx.label} run must cancel the older one`).toBe(true);
  });
});

describe("US #9 notes — supply chain", () => {
  it("given the workflow, when it uses an action, then the action is pinned to a full commit SHA with its version in a comment", () => {
    const path = rootPath(WORKFLOW_FILE);
    expect(existsSync(path), `${WORKFLOW_FILE} must exist`).toBe(true);
    const lines = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^\s*(-\s*)?uses:/.test(line));

    expect(lines, "the workflow must use actions").not.toHaveLength(0);
    for (const line of lines) {
      const match = /uses:\s*["']?([^\s"'#]+)["']?\s*(#.*)?$/.exec(line);
      const ref = match?.[1] ?? "";
      if (ref.startsWith("./")) continue;
      expect(ref, line.trim()).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      expect(match?.[2] ?? "", `${line.trim()} needs its version in a comment`).toMatch(/#\s*v?\d/);
    }
  });

  it("given the repo, when Dependabot runs, then it bumps the GitHub Actions, npm and Docker dependencies weekly", () => {
    const path = rootPath(".github", "dependabot.yml");
    expect(existsSync(path), ".github/dependabot.yml must exist").toBe(true);
    const config = parse(readFileSync(path, "utf8")) as {
      version?: number;
      updates?: { "package-ecosystem"?: string; directory?: string; schedule?: { interval?: string } }[];
    };

    expect(config.version).toBe(2);
    for (const ecosystem of ["github-actions", "npm", "docker"]) {
      const update = config.updates?.find((entry) => entry["package-ecosystem"] === ecosystem);
      expect(update, `dependabot must watch ${ecosystem}`).toBeDefined();
      expect(update?.directory, ecosystem).toBe("/");
      expect(update?.schedule?.interval, ecosystem).toBe("weekly");
    }
  });

  it("given the pinned stack (Next.js 15, Node 22), when Dependabot runs, then it never proposes major npm or Docker upgrades", () => {
    const config = parse(readFileSync(rootPath(".github", "dependabot.yml"), "utf8")) as {
      updates?: {
        "package-ecosystem"?: string;
        ignore?: { "dependency-name"?: string; "update-types"?: string[] }[];
      }[];
    };

    for (const ecosystem of ["npm", "docker"]) {
      const update = config.updates?.find((entry) => entry["package-ecosystem"] === ecosystem);
      const ignoresMajors = (update?.ignore ?? []).some(
        (rule) => rule["dependency-name"] === "*" && (rule["update-types"] ?? []).includes("version-update:semver-major"),
      );
      expect(ignoresMajors, `${ecosystem} must ignore semver-major updates for every dependency`).toBe(true);
    }
  });
});

describe("US #9 notes — deployment docs", () => {
  const read = (name: string) => {
    const path = rootPath(name);
    if (!existsSync(path)) throw new Error(`${name} is missing at the repo root`);
    return readFileSync(path, "utf8");
  };

  it("given DEPLOY.md, when Dorian deploys, then pulling the CI image from GHCR is the main path, before any local build", () => {
    const deploy = read("DEPLOY.md");
    const pull = deploy.indexOf("docker compose pull");
    const build = deploy.search(/docker compose (build|up -d --build)/);

    expect(pull, "DEPLOY.md must tell to run docker compose pull").toBeGreaterThanOrEqual(0);
    if (build >= 0) expect(pull, "docker compose pull must come before the local build").toBeLessThan(build);
    expect(/no CI workflow yet/i.exec(deploy)?.[0], "DEPLOY.md still says there is no CI").toBeUndefined();
    expect(/Do not run `docker compose pull` yet/i.exec(deploy)?.[0], "DEPLOY.md still forbids docker compose pull").toBeUndefined();
    expect(/:latest|IMAGE_TAG/.test(deploy)).toBe(true);
  });

  it("given the private GHCR package, when the Pi pulls, then DEPLOY.md explains docker login with a read:packages token, or making the package public", () => {
    const deploy = read("DEPLOY.md");

    expect(/docker login ghcr\.io/.test(deploy), "DEPLOY.md must explain docker login ghcr.io").toBe(true);
    expect(/read:packages/.test(deploy), "DEPLOY.md must name the read:packages scope").toBe(true);
    expect(/\bpublic\b/i.test(deploy), "DEPLOY.md must give the public package alternative").toBe(true);
  });

  it("given the arm64 build under QEMU, when the docs are read, then they mention its cost in Actions minutes", () => {
    const docs = `${read("DEPLOY.md")}\n${read("README.md")}`;

    expect(/QEMU/.test(docs), "DEPLOY.md or README.md must mention the QEMU build").toBe(true);
    expect(/minutes/i.test(docs), "DEPLOY.md or README.md must mention the Actions minutes cost").toBe(true);
  });

  it("given the README, when it describes Docker, then it no longer says the image is always built locally", () => {
    expect(/no CI image on GHCR yet/i.exec(read("README.md"))?.[0], "README.md still says there is no CI image").toBeUndefined();
  });
});

describe.skipIf(!process.env.ACTIONLINT_BIN)("US #9 notes — actionlint (ACTIONLINT_BIN=/path/to/actionlint)", () => {
  it("given the workflow, when actionlint checks it, then it reports nothing", () => {
    const path = rootPath(WORKFLOW_FILE);
    expect(existsSync(path), `${WORKFLOW_FILE} must exist`).toBe(true);
    let output = "";
    try {
      output = execFileSync(process.env.ACTIONLINT_BIN as string, ["-no-color", path], { cwd: rootPath(), encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      const { stdout, stderr } = error as { stdout?: string; stderr?: string };
      throw new Error(`actionlint failed:\n${stdout ?? ""}\n${stderr ?? ""}`);
    }
    expect(output.trim()).toBe("");
  });
});
