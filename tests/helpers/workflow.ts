import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { rootPath } from "./project";

/** The CI workflow of the repo (US #9). */
export const WORKFLOW_FILE = ".github/workflows/ci.yml";

/** Fake commit SHA used to resolve `${{ github.sha }}` and metadata-action's sha tags. */
export const FAKE_SHA = "0123456789abcdef0123456789abcdef01234567";

export type Step = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  if?: string | boolean;
  "continue-on-error"?: boolean | string;
  [key: string]: unknown;
};

export type Job = {
  name?: string;
  "runs-on"?: unknown;
  needs?: string | string[];
  if?: string | boolean;
  permissions?: string | Record<string, string>;
  env?: Record<string, unknown>;
  steps?: Step[];
  "continue-on-error"?: boolean | string;
  [key: string]: unknown;
};

export type Workflow = {
  on?: unknown;
  permissions?: string | Record<string, string>;
  env?: Record<string, unknown>;
  concurrency?: string | { group?: string; "cancel-in-progress"?: boolean | string };
  jobs?: Record<string, Job>;
  [key: string]: unknown;
};

/** Parses the CI workflow; fails with a readable message when it is missing. */
export function readWorkflow(): Workflow {
  const path = rootPath(WORKFLOW_FILE);
  if (!existsSync(path)) throw new Error(`${WORKFLOW_FILE} is missing`);
  // YAML 1.2 (the yaml package's default) keeps `on:` as the string key "on".
  return parse(readFileSync(path, "utf8"), { merge: true }) as Workflow;
}

export function workflowJobs(workflow: Workflow): Record<string, Job> {
  if (!workflow.jobs || Object.keys(workflow.jobs).length === 0) throw new Error(`${WORKFLOW_FILE} declares no jobs`);
  return workflow.jobs;
}

export function needsOf(job: Job): string[] {
  if (job.needs === undefined) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

/** Every job `jobId` waits for, directly or through other jobs. */
export function transitiveNeeds(workflow: Workflow, jobId: string): Set<string> {
  const jobs = workflowJobs(workflow);
  const seen = new Set<string>();
  const visit = (id: string) => {
    for (const need of needsOf(jobs[id] ?? {})) {
      if (!seen.has(need)) {
        seen.add(need);
        visit(need);
      }
    }
  };
  visit(jobId);
  return seen;
}

/** Name of an action without its ref: `docker/build-push-action@abc` -> `docker/build-push-action`. */
export function actionName(step: Step): string | undefined {
  return step.uses?.split("@")[0].toLowerCase();
}

export function stepsUsing(job: Job, action: string): Step[] {
  return (job.steps ?? []).filter((step) => actionName(step) === action.toLowerCase());
}

export function runText(step: Step): string {
  return typeof step.run === "string" ? step.run : "";
}

export const NPM_TEST = /\bnpm\s+(run\s+)?test\b/;
export const NPM_LINT = /\bnpm\s+run\s+lint\b/;

/** Steps whose shell command runs `pattern`. */
export function stepsRunning(job: Job, pattern: RegExp): Step[] {
  return (job.steps ?? []).filter((step) => pattern.test(runText(step)));
}

// ---------------------------------------------------------------------------
// Simulated runs
// ---------------------------------------------------------------------------

export type RunContext = {
  label: string;
  event_name: string;
  ref: string;
  ref_name: string;
  /** Target branch of a pull request. */
  base_ref?: string;
  head_ref?: string;
};

export const PUSH_MAIN: RunContext = { label: "push on main", event_name: "push", ref: "refs/heads/main", ref_name: "main" };
export const PUSH_OTHER_BRANCH: RunContext = {
  label: "push on another branch",
  event_name: "push",
  ref: "refs/heads/us/9-feature",
  ref_name: "us/9-feature",
};
export const PULL_REQUEST_TO_MAIN: RunContext = {
  label: "pull request into main",
  event_name: "pull_request",
  ref: "refs/pull/34/merge",
  ref_name: "34/merge",
  base_ref: "main",
  head_ref: "us/9-feature",
};
/** A stacked PR: its base is another story branch, not main. */
export const STACKED_PULL_REQUEST: RunContext = {
  label: "stacked pull request",
  event_name: "pull_request",
  ref: "refs/pull/35/merge",
  ref_name: "35/merge",
  base_ref: "us/8-feature",
  head_ref: "us/9-feature",
};
export const PULL_REQUESTS = [PULL_REQUEST_TO_MAIN, STACKED_PULL_REQUEST];

/** The `on:` section as a map of event name -> filter config (null when none). */
export function triggers(workflow: Workflow): Record<string, Record<string, unknown> | null> {
  const on = workflow.on;
  if (typeof on === "string") return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((event: string) => [event, null]));
  if (on && typeof on === "object") {
    return Object.fromEntries(
      Object.entries(on as Record<string, unknown>).map(([event, config]) => [
        event,
        config && typeof config === "object" ? (config as Record<string, unknown>) : null,
      ]),
    );
  }
  return {};
}

function asList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/** GitHub's filter patterns: `*` matches anything but `/`, `**` matches anything. */
function globMatches(pattern: string, value: string): boolean {
  const regex = pattern
    .split("**")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`^${regex}$`).test(value);
}

function branchFilterAllows(config: Record<string, unknown> | null, branch: string): boolean {
  if (!config) return true;
  const branches = asList(config.branches);
  const ignored = asList(config["branches-ignore"]);
  const hasTagFilter = config.tags !== undefined || config["tags-ignore"] !== undefined;
  if (branches.length === 0 && ignored.length === 0) return !hasTagFilter;
  if (branches.length > 0) {
    let allowed = false;
    for (const pattern of branches) {
      if (pattern.startsWith("!")) {
        if (globMatches(pattern.slice(1), branch)) allowed = false;
      } else if (globMatches(pattern, branch)) allowed = true;
    }
    return allowed;
  }
  return !ignored.some((pattern) => globMatches(pattern, branch));
}

/** Whether the workflow starts at all for that run (ignoring path filters). */
export function workflowTriggered(workflow: Workflow, ctx: RunContext): boolean {
  const all = triggers(workflow);
  if (!(ctx.event_name in all)) return false;
  const config = all[ctx.event_name];
  if (ctx.event_name === "push") return branchFilterAllows(config, ctx.ref_name);
  if (ctx.event_name === "pull_request" || ctx.event_name === "pull_request_target") {
    return branchFilterAllows(config, ctx.base_ref ?? "");
  }
  return true;
}

/**
 * Whether a job runs for that run. `failed` lists jobs that ran and failed (e.g. a failing
 * test): their dependents see `success()` as false, as on GitHub.
 */
export function jobRuns(workflow: Workflow, jobId: string, ctx: RunContext, failed: Set<string> = new Set()): boolean {
  if (!workflowTriggered(workflow, ctx)) return false;
  const jobs = workflowJobs(workflow);
  const job = jobs[jobId];
  if (!job) throw new Error(`${WORKFLOW_FILE} has no "${jobId}" job`);
  const needsOk = needsOf(job).every((need) => jobRuns(workflow, need, ctx, failed) && !failed.has(need));
  return evaluateCondition(job.if, expressionContext(workflow, job, ctx, needsOk));
}

/** Whether a step of a running job runs, assuming the previous steps succeeded. */
export function stepRuns(workflow: Workflow, job: Job, step: Step, ctx: RunContext): boolean {
  return evaluateCondition(step.if, expressionContext(workflow, job, ctx, true, step));
}

// ---------------------------------------------------------------------------
// GitHub Actions expressions (the subset used in workflows)
// ---------------------------------------------------------------------------

type Value = string | number | boolean | null | Value[] | { [key: string]: Value };

export type ExpressionContext = {
  contexts: Record<string, Value>;
  /** What `success()` returns (needs succeeded for a job, previous steps for a step). */
  success: boolean;
};

export function expressionContext(
  workflow: Workflow,
  job: Job,
  ctx: RunContext,
  success: boolean,
  step?: Step,
): ExpressionContext {
  const github: Value = {
    event_name: ctx.event_name,
    ref: ctx.ref,
    ref_name: ctx.ref_name,
    ref_type: "branch",
    base_ref: ctx.base_ref ?? "",
    head_ref: ctx.head_ref ?? "",
    sha: FAKE_SHA,
    actor: "vidal-dorian",
    repository: "vidal-dorian/TraficBourse",
    repository_owner: "vidal-dorian",
    server_url: "https://github.com",
    workflow: "CI",
    run_id: "1",
    run_number: "1",
    event: {
      repository: { default_branch: "main" },
      ...(ctx.event_name === "pull_request"
        ? { pull_request: { base: { ref: ctx.base_ref ?? "" }, head: { ref: ctx.head_ref ?? "" } } }
        : {}),
    },
  };
  const base: ExpressionContext = { contexts: { github, secrets: { GITHUB_TOKEN: "***" }, env: {} }, success };
  const env: Record<string, Value> = {};
  for (const scope of [workflow.env, job.env, step?.env]) {
    for (const [key, value] of Object.entries(scope ?? {})) {
      env[key] = typeof value === "string" ? interpolateExpressions(value, { ...base, contexts: { ...base.contexts, env } }) : (value as Value);
    }
  }
  return { ...base, contexts: { ...base.contexts, env } };
}

const STATUS_FUNCTION = /\b(success|failure|always|cancelled)\s*\(/;

function stripWrapper(expression: string): string {
  const trimmed = expression.trim();
  const match = /^\$\{\{([\s\S]*)\}\}$/.exec(trimmed);
  return match && !match[1].includes("}}") ? match[1] : trimmed;
}

/** An `if:` condition, with GitHub's implicit `success() &&` when no status function is used. */
export function evaluateCondition(condition: string | boolean | undefined, ctx: ExpressionContext): boolean {
  if (condition === undefined || condition === null) return ctx.success;
  if (typeof condition === "boolean") return ctx.success && condition;
  const expression = stripWrapper(String(condition));
  const result = truthy(evaluateExpression(expression, ctx));
  return STATUS_FUNCTION.test(expression) ? result : ctx.success && result;
}

/** Replaces every `${{ … }}` in a string with its value. */
export function interpolateExpressions(value: string, ctx: ExpressionContext): string {
  return value.replace(/\$\{\{([\s\S]*?)\}\}/g, (_match, expression: string) => toText(evaluateExpression(expression, ctx)));
}

/** A `with:` input: booleans as is, strings with their expressions resolved. */
export function resolveInput(value: unknown, ctx: ExpressionContext): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return String(value);
  const whole = /^\s*\$\{\{((?:(?!\}\})[\s\S])*)\}\}\s*$/.exec(value);
  if (whole) return toText(evaluateExpression(whole[1], ctx));
  return interpolateExpressions(value, ctx);
}

function toText(value: Value): string {
  if (value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function truthy(value: Value): boolean {
  return !(value === false || value === null || value === 0 || value === "" || Number.isNaN(value));
}

function looseEquals(a: Value, b: Value): boolean {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  if (typeof a === typeof b) return a === b;
  const num = (v: Value) => (v === null ? 0 : typeof v === "boolean" ? Number(v) : typeof v === "string" ? (v.trim() === "" ? 0 : Number(v)) : Number.NaN);
  return num(a) === num(b);
}

type Token = { type: "op" | "string" | "number" | "ident" | "punct"; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) {
      i += 1;
    } else if (char === "'") {
      let text = "";
      i += 1;
      while (i < source.length) {
        if (source[i] === "'" && source[i + 1] === "'") {
          text += "'";
          i += 2;
        } else if (source[i] === "'") break;
        else text += source[i++];
      }
      if (source[i] !== "'") throw new Error(`Unterminated string in expression: ${source}`);
      i += 1;
      tokens.push({ type: "string", value: text });
    } else if (/[0-9]/.test(char)) {
      const match = /^[0-9]+(\.[0-9]+)?/.exec(source.slice(i));
      tokens.push({ type: "number", value: match![0] });
      i += match![0].length;
    } else if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(i));
      tokens.push({ type: "ident", value: match![0] });
      i += match![0].length;
    } else {
      const two = source.slice(i, i + 2);
      if (["==", "!=", "&&", "||", "<=", ">="].includes(two)) {
        tokens.push({ type: "op", value: two });
        i += 2;
      } else if ("!<>".includes(char)) {
        tokens.push({ type: "op", value: char });
        i += 1;
      } else if ("().,[]".includes(char)) {
        tokens.push({ type: "punct", value: char });
        i += 1;
      } else {
        throw new Error(`Unsupported character "${char}" in expression: ${source}`);
      }
    }
  }
  return tokens;
}

/** Evaluates a GitHub Actions expression (without its `${{ }}` wrapper). */
export function evaluateExpression(source: string, ctx: ExpressionContext): Value {
  const tokens = tokenize(stripWrapper(source));
  let pos = 0;
  const peek = () => tokens[pos];
  const accept = (value: string) => {
    if (peek()?.value === value && peek()?.type !== "string") {
      pos += 1;
      return true;
    }
    return false;
  };
  const expect = (value: string) => {
    if (!accept(value)) throw new Error(`Expected "${value}" in expression: ${source}`);
  };

  const callFunction = (name: string, args: Value[]): Value => {
    const text = (v: Value) => toText(v).toLowerCase();
    switch (name.toLowerCase()) {
      case "success":
        return ctx.success;
      case "failure":
        return !ctx.success;
      case "always":
        return true;
      case "cancelled":
        return false;
      case "contains":
        return Array.isArray(args[0]) ? args[0].some((item) => looseEquals(item, args[1])) : text(args[0]).includes(text(args[1]));
      case "startswith":
        return text(args[0]).startsWith(text(args[1]));
      case "endswith":
        return text(args[0]).endsWith(text(args[1]));
      case "format":
        return toText(args[0]).replace(/\{(\d+)\}/g, (_m, index: string) => toText(args[Number(index) + 1] ?? null));
      default:
        throw new Error(`Unsupported function ${name}() in expression: ${source}`);
    }
  };

  const primary = (): Value => {
    const token = peek();
    if (!token) throw new Error(`Unexpected end of expression: ${source}`);
    pos += 1;
    if (token.type === "string") return token.value;
    if (token.type === "number") return Number(token.value);
    if (token.value === "(") {
      const value = or();
      expect(")");
      return value;
    }
    if (token.type === "ident") {
      if (token.value === "true") return true;
      if (token.value === "false") return false;
      if (token.value === "null") return null;
      if (accept("(")) {
        const args: Value[] = [];
        if (!accept(")")) {
          do args.push(or());
          while (accept(","));
          expect(")");
        }
        return callFunction(token.value, args);
      }
      let value: Value = ctx.contexts[token.value] ?? null;
      if (!(token.value in ctx.contexts)) throw new Error(`Unsupported context "${token.value}" in expression: ${source}`);
      for (;;) {
        if (accept(".")) {
          const key = peek();
          if (!key || key.type !== "ident") throw new Error(`Expected a property name in expression: ${source}`);
          pos += 1;
          value = value && typeof value === "object" && !Array.isArray(value) ? (value[key.value] ?? null) : null;
        } else if (accept("[")) {
          const key = toText(or());
          expect("]");
          value = value && typeof value === "object" && !Array.isArray(value) ? (value[key] ?? null) : null;
        } else break;
      }
      return value;
    }
    throw new Error(`Unexpected "${token.value}" in expression: ${source}`);
  };

  const unary = (): Value => (accept("!") ? !truthy(unary()) : primary());

  const comparison = (): Value => {
    let left = unary();
    for (;;) {
      const op = peek();
      if (op?.type !== "op" || !["==", "!=", "<", ">", "<=", ">="].includes(op.value)) return left;
      pos += 1;
      const right = unary();
      if (op.value === "==") left = looseEquals(left, right);
      else if (op.value === "!=") left = !looseEquals(left, right);
      else {
        const [a, b] = [Number(left), Number(right)];
        left = op.value === "<" ? a < b : op.value === ">" ? a > b : op.value === "<=" ? a <= b : a >= b;
      }
    }
  };

  const and = (): Value => {
    let left = comparison();
    while (accept("&&")) {
      const right = comparison();
      left = truthy(left) ? right : left;
    }
    return left;
  };

  function or(): Value {
    let left = and();
    while (accept("||")) {
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  }

  const result = or();
  if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos].value}" in expression: ${source}`);
  return result;
}

// ---------------------------------------------------------------------------
// Image publication
// ---------------------------------------------------------------------------

export const BUILD_PUSH_ACTION = "docker/build-push-action";
export const METADATA_ACTION = "docker/metadata-action";
export const LOGIN_ACTION = "docker/login-action";

const SHELL_PUSH = /\bdocker\s+(image\s+)?push\b|\bdocker\s+buildx\s+build\b[^\n]*--push\b|\bdocker\s+buildx\s+imagetools\s+create\b/;

/** Whether a step pushes an image for that run (build-push-action with `push`, or a shell push). */
export function stepPushes(workflow: Workflow, job: Job, step: Step, ctx: RunContext): boolean {
  if (!stepRuns(workflow, job, step, ctx)) return false;
  if (SHELL_PUSH.test(runText(step))) return true;
  if (actionName(step) !== BUILD_PUSH_ACTION) return false;
  const exprCtx = expressionContext(workflow, job, ctx, true, step);
  return resolveInput(step.with?.push, exprCtx).trim().toLowerCase() === "true";
}

/** Steps that can push an image in some run (any push-like step, whatever its condition). */
export function pushCapableSteps(job: Job): Step[] {
  return (job.steps ?? []).filter(
    (step) => SHELL_PUSH.test(runText(step)) || (actionName(step) === BUILD_PUSH_ACTION && step.with?.push !== undefined && step.with?.push !== false && step.with?.push !== "false"),
  );
}

/** Ids of the jobs that contain a step able to push an image. */
export function publishingJobIds(workflow: Workflow): string[] {
  return Object.entries(workflowJobs(workflow))
    .filter(([, job]) => pushCapableSteps(job).length > 0)
    .map(([id]) => id);
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Simulates docker/metadata-action's `tags` output for a push on main. */
function metadataTags(step: Step, ctx: ExpressionContext): string[] {
  const images = splitList(resolveInput(step.with?.images, ctx)).map((image) => image.split(",")[0].replace(/^name=/, "").toLowerCase());
  const github = ctx.contexts.github as Record<string, Value>;
  const shortSha = FAKE_SHA.slice(0, 7);
  const isDefaultBranch = github.ref === "refs/heads/main";
  const template = (text: string) =>
    text
      .replace(/\{\{\s*sha\s*\}\}/g, shortSha)
      .replace(/\{\{\s*branch\s*\}\}/g, String(github.ref_name))
      .replace(/\{\{\s*is_default_branch\s*\}\}/g, String(isDefaultBranch));

  const tags: string[] = [];
  for (const line of resolveInput(step.with?.tags, ctx).split("\n").map((entry) => entry.trim()).filter(Boolean)) {
    const attributes: Record<string, string> = {};
    for (const part of line.split(",")) {
      const index = part.indexOf("=");
      if (index > 0) attributes[part.slice(0, index).trim()] = template(part.slice(index + 1).trim());
      else attributes.value = template(part.trim());
    }
    if (attributes.enable !== undefined && attributes.enable.toLowerCase() !== "true") continue;
    const prefix = attributes.prefix ?? "";
    const suffix = attributes.suffix ?? "";
    switch (attributes.type) {
      case "raw":
        if (attributes.value) tags.push(`${prefix}${attributes.value}${suffix}`);
        break;
      case "sha":
        tags.push(`${attributes.prefix ?? "sha-"}${attributes.format === "long" ? FAKE_SHA : shortSha}${suffix}`);
        break;
      case "ref":
        if (attributes.event === "branch") tags.push(`${prefix}${String(github.ref_name).replace(/[^a-zA-Z0-9._-]+/g, "-")}${suffix}`);
        break;
      default:
        break;
    }
  }
  const flavor = resolveInput(step.with?.flavor, ctx);
  if (/^\s*latest\s*=\s*true\s*$/m.test(flavor) && !tags.includes("latest")) tags.push("latest");
  return images.flatMap((image) => tags.map((tag) => `${image}:${tag}`));
}

/**
 * The image references a build-push-action step pushes on a push on main, with its `tags`
 * input resolved — including tags computed by a docker/metadata-action step it refers to.
 */
export function resolvedImageTags(workflow: Workflow, job: Job, step: Step, ctx: RunContext = PUSH_MAIN): string[] {
  const exprCtx = expressionContext(workflow, job, ctx, true, step);
  const raw = typeof step.with?.tags === "string" ? step.with.tags : "";
  const fromMetadata = /steps\.([A-Za-z0-9_-]+)\.outputs\.tags/.exec(raw);
  if (fromMetadata) {
    const meta = (job.steps ?? []).find((candidate) => candidate.id === fromMetadata[1]);
    if (!meta || actionName(meta) !== METADATA_ACTION) {
      throw new Error(`tags refer to step "${fromMetadata[1]}", which is not a ${METADATA_ACTION} step of the job`);
    }
    return metadataTags(meta, expressionContext(workflow, job, ctx, true, meta));
  }
  return splitList(resolveInput(raw, exprCtx));
}

/** The `with.labels` of a build step, plus the labels of the metadata-action step it refers to. */
export function imageLabelsSource(job: Job, step: Step): { literal: string; fromMetadata: boolean } {
  const raw = typeof step.with?.labels === "string" ? step.with.labels : "";
  const ref = /steps\.([A-Za-z0-9_-]+)\.outputs\.labels/.exec(raw);
  const meta = ref ? (job.steps ?? []).find((candidate) => candidate.id === ref[1]) : undefined;
  return { literal: raw, fromMetadata: Boolean(meta && actionName(meta) === METADATA_ACTION) };
}
