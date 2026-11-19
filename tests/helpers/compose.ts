import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parse } from "yaml";
import { rootPath } from "./project";

/** Compose file at the repo root (CLAUDE.md §9). */
export const COMPOSE_FILE = "docker-compose.yml";

export type Env = Record<string, string | undefined>;

export type ComposeService = {
  image?: string;
  build?: unknown;
  platform?: string;
  command?: string | string[];
  entrypoint?: string | string[];
  environment?: Record<string, string | number | boolean | null> | string[];
  volumes?: (string | { type?: string; source?: string; target?: string })[];
  logging?: { driver?: string; options?: Record<string, string | number> };
  restart?: string;
  [key: string]: unknown;
};

export type ComposeFile = {
  services?: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Parses docker-compose.yml, resolving YAML anchors, aliases and `<<` merge keys. */
export function readComposeFile(): ComposeFile {
  const path = rootPath(COMPOSE_FILE);
  if (!existsSync(path)) throw new Error(`${COMPOSE_FILE} is missing at the repo root`);
  return parse(readFileSync(path, "utf8"), { merge: true }) as ComposeFile;
}

export function composeServices(): Record<string, ComposeService> {
  const services = readComposeFile().services;
  if (!services) throw new Error(`${COMPOSE_FILE} declares no services`);
  return services;
}

/** The service with that name; fails with a readable message when it is missing. */
export function composeService(name: string): ComposeService {
  const service = composeServices()[name];
  if (!service) throw new Error(`${COMPOSE_FILE} has no "${name}" service`);
  return service;
}

/**
 * Same variable interpolation as Docker Compose, for the forms used in compose files:
 * `${VAR}`, `${VAR:-default}`, `${VAR-default}`, `$VAR` and `$$` (literal dollar).
 */
export function interpolate(value: string, env: Env = {}): string {
  return value.replace(
    /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?)-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (match, braced: string | undefined, colon: string | undefined, fallback: string | undefined, bare: string | undefined) => {
      if (match === "$$") return "$";
      const name = braced ?? bare ?? "";
      const current = env[name];
      if (fallback !== undefined) {
        const missing = colon === ":" ? current === undefined || current === "" : current === undefined;
        return missing ? interpolate(fallback, env) : (current as string);
      }
      return current ?? "";
    },
  );
}

/** A service's `command` (or entrypoint + command), as one comparable string. */
export function commandOf(service: ComposeService): string {
  const part = (value: string | string[] | undefined) =>
    value === undefined ? "" : Array.isArray(value) ? value.join(" ") : value;
  return `${part(service.entrypoint)}|${part(service.command)}`;
}

/** A service's environment as a map, whatever the syntax used (map or `KEY=value` list). */
export function environmentOf(service: ComposeService, env: Env = {}): Record<string, string> {
  const result: Record<string, string> = {};
  const raw = service.environment;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const index = entry.indexOf("=");
      if (index > 0) result[entry.slice(0, index)] = interpolate(entry.slice(index + 1), env);
    }
  } else if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      if (value !== null && value !== undefined) result[key] = interpolate(String(value), env);
    }
  }
  return result;
}

export type Mount = { type: "bind" | "volume"; source: string; target: string };

/** A service's mounts, short or long syntax, with variables interpolated. */
export function mountsOf(service: ComposeService, env: Env = {}): Mount[] {
  return (service.volumes ?? []).map((entry) => {
    if (typeof entry === "string") {
      const resolved = interpolate(entry, env);
      const [source, target] = resolved.split(":");
      if (target === undefined) return { type: "volume", source: "", target: source };
      const bind = isAbsolute(source) || source.startsWith(".") || source.startsWith("~");
      return { type: bind ? "bind" : "volume", source, target };
    }
    const source = interpolate(entry.source ?? "", env);
    const target = interpolate(entry.target ?? "", env);
    return { type: entry.type === "bind" ? "bind" : "volume", source, target };
  });
}

/** The mount that holds `path` inside the container (longest matching target). */
export function mountHolding(service: ComposeService, path: string, env: Env = {}): Mount | undefined {
  return mountsOf(service, env)
    .filter((mount) => mount.target && (path === mount.target || path.startsWith(`${mount.target.replace(/\/$/, "")}/`)))
    .sort((a, b) => b.target.length - a.target.length)[0];
}
