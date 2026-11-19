import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Absolute path of the repository root. */
export const ROOT = resolve(__dirname, "..", "..");

export function rootPath(...segments: string[]): string {
  return join(ROOT, ...segments);
}

export type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(rootPath("package.json"), "utf8")) as PackageJson;
}

/** Version range of a package, whether declared as a dependency or a devDependency. */
export function declaredVersion(pkg: PackageJson, name: string): string | undefined {
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
}

export function firstExisting(candidates: string[]): string | undefined {
  return candidates.find((candidate) => existsSync(rootPath(candidate)));
}
