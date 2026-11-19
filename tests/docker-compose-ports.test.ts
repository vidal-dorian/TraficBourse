// Security guard for the Compose stack (US #8): the only inbound flows go through Cloudflare
// (CLAUDE.md §3). Docker's port rules bypass the host firewall, so every published port must
// be bound to loopback by default; Caddy on the host reverse-proxies to 127.0.0.1.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeServices, interpolate } from "./helpers/compose";
import { rootPath } from "./helpers/project";

type PortEntry = string | number | { host_ip?: string; published?: string | number; target?: number };

/** Host address of a port entry, after variable interpolation; undefined means every interface. */
function hostIpOf(entry: PortEntry, env: Record<string, string | undefined>): string | undefined {
  if (typeof entry === "number") return undefined;
  if (typeof entry === "object") return entry.host_ip ? interpolate(entry.host_ip, env) : undefined;
  const parts = interpolate(entry, env).split(":");
  // "ip:host:container" has three parts; "host:container" or "container" publish on 0.0.0.0.
  return parts.length >= 3 ? parts.slice(0, -2).join(":") : undefined;
}

function publishedPorts(): { service: string; entry: PortEntry }[] {
  return Object.entries(composeServices()).flatMap(([service, definition]) =>
    ((definition.ports as PortEntry[] | undefined) ?? []).map((entry) => ({ service, entry })),
  );
}

describe("Compose published ports", () => {
  it("web publishes port 3000", () => {
    expect(publishedPorts().some(({ service }) => service === "web")).toBe(true);
  });

  it("every published port is bound to 127.0.0.1 by default", () => {
    for (const { service, entry } of publishedPorts()) {
      expect(hostIpOf(entry, {}), `${service}: ${JSON.stringify(entry)}`).toBe("127.0.0.1");
    }
  });

  it("WEB_BIND overrides the bind address and WEB_PORT the host port", () => {
    const web = publishedPorts().filter(({ service }) => service === "web");
    const env = { WEB_BIND: "192.0.2.10", WEB_PORT: "8080" };
    for (const { entry } of web) {
      expect(hostIpOf(entry, env)).toBe("192.0.2.10");
      expect(typeof entry === "string" ? interpolate(entry, env) : entry).toBe("192.0.2.10:8080:3000");
    }
  });

  it(".env.example documents WEB_BIND", () => {
    expect(readFileSync(rootPath(".env.example"), "utf8")).toMatch(/^#?\s*WEB_BIND=127\.0\.0\.1$/m);
  });
});
