// US #7 — C35: `npm test` and `npm run lint` both pass (Vitest and ESLint configured),
// plus the stack listed in the story notes.
//
// Contract:
// - package.json: `test` runs Vitest, `lint` runs ESLint (directly or via `next lint`).
// - An ESLint config file exists at the repo root.
// - Story notes: TypeScript strict, Tailwind, Drizzle + better-sqlite3, `.env.example`
//   documenting DATABASE_PATH.
// The real check of C35 is running `npm test` and `npm run lint` on the finished branch.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { declaredVersion, firstExisting, readPackageJson, rootPath } from "./helpers/project";

const ESLINT_CONFIGS = [
  "eslint.config.mjs",
  "eslint.config.js",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  ".eslintrc.json",
  ".eslintrc.js",
  ".eslintrc.cjs",
];

describe("C35 — Vitest and ESLint configured", () => {
  it("C35 — given the repo, when I run `npm test` and `npm run lint`, then Vitest and ESLint run with a config from the repo", () => {
    const pkg = readPackageJson();

    expect(pkg.scripts?.test).toMatch(/\bvitest\b/);
    expect(declaredVersion(pkg, "vitest")).toBeDefined();
    expect(pkg.scripts?.lint).toMatch(/\b(eslint|next lint)\b/);
    expect(declaredVersion(pkg, "eslint")).toBeDefined();
    expect(firstExisting(ESLINT_CONFIGS), "an ESLint config file must exist").toBeDefined();
  });
});

describe("US #7 notes — common base of the repo", () => {
  it("given the repo, when tsconfig.json is read, then TypeScript runs in strict mode", () => {
    const raw = readFileSync(rootPath("tsconfig.json"), "utf8");
    const tsconfig = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));

    expect(tsconfig.compilerOptions?.strict).toBe(true);
    expect(declaredVersion(readPackageJson(), "typescript")).toBeDefined();
  });

  it("given the repo, when the dependencies are read, then Tailwind, Drizzle and better-sqlite3 are installed", () => {
    const pkg = readPackageJson();

    expect(declaredVersion(pkg, "tailwindcss")).toBeDefined();
    expect(declaredVersion(pkg, "drizzle-orm")).toBeDefined();
    expect(declaredVersion(pkg, "drizzle-kit")).toBeDefined();
    expect(declaredVersion(pkg, "better-sqlite3")).toBeDefined();
  });

  it("given the repo, when .env.example is read, then it documents DATABASE_PATH", () => {
    const envExample = readFileSync(rootPath(".env.example"), "utf8");

    expect(envExample).toMatch(/^\s*DATABASE_PATH=/m);
  });
});
