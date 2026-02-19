import process from "node:process";
import "zx/globals";

export type BuildSystemTestMode = "auto" | "always" | "never";

type ScopeDecision = {
  targets: string[];
  mode: BuildSystemTestMode;
  hasBuildSystemChanges: boolean;
};

const AUTO_TARGETS = ["//..."];
const PROJECT_TARGETS = ["//projects/..."];

function normalizePath(relPath: string): string {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
}

export function isBuildSystemPath(relPath: string): boolean {
  const p = normalizePath(relPath);
  if (!p) {
    return false;
  }
  if (p.startsWith("build-tools/docs/")) {
    return false;
  }
  if (
    p === "flake.nix" ||
    p === "flake.lock" ||
    p === ".buckconfig" ||
    p === "BUCK" ||
    p === "TARGETS"
  ) {
    return true;
  }
  if (p.startsWith("build-tools/")) {
    return true;
  }
  if (p.startsWith("toolchains/")) {
    return true;
  }
  if (p.startsWith("third_party/providers/")) {
    return true;
  }
  if (p === "prelude" || p.startsWith("prelude/")) {
    return true;
  }
  return false;
}

export function parseBuildSystemTestMode(raw: string | undefined): BuildSystemTestMode {
  const v = String(raw || "auto")
    .trim()
    .toLowerCase();
  if (v === "1" || v === "true" || v === "always" || v === "on") {
    return "always";
  }
  if (v === "0" || v === "false" || v === "never" || v === "off") {
    return "never";
  }
  return "auto";
}

function shouldAutoScopeTargets(targets: string[]): boolean {
  return targets.length === 1 && targets[0] === "//...";
}

function parseStatusPaths(statusText: string): string[] {
  const out: string[] = [];
  for (const raw of statusText.split(/\r?\n/)) {
    const line = String(raw || "").trimEnd();
    if (!line) {
      continue;
    }
    const body = line.length > 3 ? line.slice(3).trim() : "";
    if (!body) {
      continue;
    }
    if (body.includes(" -> ")) {
      for (const side of body.split(" -> ")) {
        const p = normalizePath(side);
        if (p) {
          out.push(p);
        }
      }
      continue;
    }
    out.push(normalizePath(body));
  }
  return out.filter(Boolean);
}

async function gitLines(root: string, args: string[]): Promise<string[]> {
  const out = await $({ cwd: root, stdio: "pipe", reject: false })`git ${args}`;
  if ((out as any).exitCode !== 0) {
    return [];
  }
  return String((out as any).stdout || "")
    .split(/\r?\n/)
    .map((x) => normalizePath(x))
    .filter(Boolean);
}

async function gitRefExists(root: string, ref: string): Promise<boolean> {
  const out = await $({
    cwd: root,
    stdio: "pipe",
    reject: false,
  })`git rev-parse --verify --quiet ${ref}`;
  return (out as any).exitCode === 0;
}

async function mergeBaseChangedPaths(root: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const baseRefs: string[] = [];
  const baseBranch = String(env.GITHUB_BASE_REF || "").trim();
  if (baseBranch) {
    baseRefs.push(`origin/${baseBranch}`, `github/${baseBranch}`, baseBranch);
  }
  baseRefs.push("github/main", "origin/main", "main");

  let mergeBase = "";
  for (const ref of baseRefs) {
    if (!(await gitRefExists(root, ref))) {
      continue;
    }
    const mb = await $({ cwd: root, stdio: "pipe", reject: false })`git merge-base ${ref} HEAD`;
    if ((mb as any).exitCode === 0) {
      mergeBase = String((mb as any).stdout || "").trim();
      if (mergeBase) {
        break;
      }
    }
  }

  if (!mergeBase) {
    if (await gitRefExists(root, "HEAD~1")) {
      return await gitLines(root, ["diff", "--name-only", "HEAD~1...HEAD"]);
    }
    return [];
  }
  return await gitLines(root, ["diff", "--name-only", `${mergeBase}...HEAD`]);
}

export async function collectChangedPaths(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const committed = await mergeBaseChangedPaths(root, env);
  const statusRaw = await $({
    cwd: root,
    stdio: "pipe",
    reject: false,
  })`git status --porcelain=v1`;
  const statusPaths =
    (statusRaw as any).exitCode === 0
      ? parseStatusPaths(String((statusRaw as any).stdout || ""))
      : [];
  return Array.from(
    new Set<string>([...committed, ...statusPaths].map((p) => normalizePath(p))),
  ).sort();
}

async function hasBuildSystemChanges(root: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const changed = await collectChangedPaths(root, env);
  for (const p of changed) {
    if (isBuildSystemPath(p)) {
      return true;
    }
  }
  return false;
}

export async function resolveBuildSystemBuckTestScope(opts: {
  root: string;
  requestedTargets: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<ScopeDecision> {
  const env = opts.env || process.env;
  const mode = parseBuildSystemTestMode(env.BNX_BUILD_SYSTEM_TESTS);
  if (!shouldAutoScopeTargets(opts.requestedTargets)) {
    return { targets: opts.requestedTargets, mode, hasBuildSystemChanges: false };
  }

  if (mode === "always") {
    return { targets: AUTO_TARGETS, mode, hasBuildSystemChanges: false };
  }
  if (mode === "never") {
    return { targets: PROJECT_TARGETS, mode, hasBuildSystemChanges: false };
  }

  const changed = await hasBuildSystemChanges(opts.root, env);
  return {
    targets: changed ? AUTO_TARGETS : PROJECT_TARGETS,
    mode,
    hasBuildSystemChanges: changed,
  };
}
