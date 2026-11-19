import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { COMPOSE_FILE } from "./compose";
import { ROOT, rootPath } from "./project";

/** Docker integration tests only run with DOCKER_TESTS=1 (they build the image). */
export const DOCKER_TESTS_ENABLED = process.env.DOCKER_TESTS === "1";

/** Platform to build for: PLATFORM when set, otherwise the host's (no arm64 emulation needed). */
export function hostPlatform(): string {
  return process.env.PLATFORM || (process.arch === "arm64" ? "linux/arm64" : "linux/amd64");
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): string {
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      env,
      stdio: "pipe",
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
    });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    throw new Error(`\`${command} ${args.join(" ")}\` failed:\n${stdout ?? ""}\n${stderr ?? ""}`);
  }
}

export function docker(args: string[], timeoutMs = 120_000): string {
  return run("docker", args, process.env, timeoutMs).trim();
}

/** A `docker compose` project bound to the repo's compose file, isolated by its name. */
export class ComposeProject {
  constructor(
    readonly name: string,
    readonly env: Record<string, string>,
  ) {}

  run(args: string[], timeoutMs = 120_000): string {
    return run(
      "docker",
      ["compose", "-p", this.name, "-f", rootPath(COMPOSE_FILE), "--project-directory", ROOT, ...args],
      { ...process.env, ...this.env },
      timeoutMs,
    ).trim();
  }

  /** Id of the running container of a service. */
  containerId(service: string): string {
    const id = this.run(["ps", "-q", service]);
    if (!id) throw new Error(`service "${service}" has no running container:\n${this.logs()}`);
    return id.split("\n")[0];
  }

  /** Ids of every container of the project, running or exited. */
  allContainerIds(): string[] {
    return this.run(["ps", "-a", "-q"]).split("\n").filter(Boolean);
  }

  logs(): string {
    try {
      return this.run(["logs", "--no-color", "--tail", "80"]);
    } catch (error) {
      return String(error);
    }
  }
}

export function inspect(containerOrImage: string, format: string): string {
  return docker(["inspect", "-f", format, containerOrImage]);
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Polls `url` until it answers 200, then returns the JSON body. */
export async function waitForHttpOk(url: string, timeoutMs: number, onTimeout: () => string): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let last = "no answer";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      const text = await response.text();
      if (response.status === 200) return JSON.parse(text);
      last = `HTTP ${response.status}: ${text}`;
    } catch (error) {
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${url} did not answer 200 within ${timeoutMs} ms (last: ${last})\n${onTimeout()}`);
}

/**
 * Script run inside a container (as its own user) with Node's built-in SQLite driver,
 * on the database at the container's DATABASE_PATH. Arguments: `write <key> <value>`
 * or `read <key>` on the `app_meta` table created by the initial migration.
 */
export const APP_META_SCRIPT = [
  "const { DatabaseSync } = require('node:sqlite');",
  "const db = new DatabaseSync(process.env.DATABASE_PATH);",
  "db.exec('PRAGMA busy_timeout = 5000');",
  "const [, mode, key, value] = process.argv;",
  "if (mode === 'write') db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run(key, value);",
  "else process.stdout.write(JSON.stringify(db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) ?? null));",
  "db.close();",
].join(" ");
