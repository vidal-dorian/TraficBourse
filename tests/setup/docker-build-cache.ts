// Vitest globalSetup: warms the Docker build cache before the gated Docker tests run.
//
// The integration tests call `docker compose up -d --build` synchronously from a worker.
// On a cold build cache that blocks the worker for over a minute, and Vitest then fails
// the run on a worker RPC timeout even though every test passes. Building once here, in
// the main process and asynchronously, makes the tests' own build a cache hit.
import { spawn } from "node:child_process";
import { COMPOSE_FILE } from "../helpers/compose";
import { DOCKER_TESTS_ENABLED, hostPlatform } from "../helpers/docker";
import { ROOT, rootPath } from "../helpers/project";

const IMAGE_REPOSITORY = "ghcr.io/vidal-dorian/traficbourse";
const BUILD_TIMEOUT_MS = 20 * 60_000;

function docker(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), BUILD_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`\`docker ${args.join(" ")}\` failed (${signal ?? `exit ${code}`}):\n${output}`));
    });
  });
}

export default async function setup(): Promise<(() => Promise<void>) | void> {
  if (!DOCKER_TESTS_ENABLED) return;

  const imageTag = `warmup-us8-${process.pid}-${Date.now().toString(36)}`;
  const env = { ...process.env, IMAGE_TAG: imageTag, PLATFORM: hostPlatform() };
  const compose = ["compose", "-p", `bourse-us8-warmup-${process.pid}`, "-f", rootPath(COMPOSE_FILE)];
  await docker([...compose, "--project-directory", ROOT, "build"], env);

  // Only the tag goes away: the build cache it filled stays for the tests.
  return async () => {
    await docker(["image", "rm", `${IMAGE_REPOSITORY}:${imageTag}`], process.env);
  };
}
