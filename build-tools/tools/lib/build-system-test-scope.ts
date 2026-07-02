import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import "../dev/zx-init.mjs";
import { resolveNonBuildSystemBuckTargets } from "./non-build-system-scope";

export type BuildSystemTestMode = "auto" | "always" | "never";

type ScopeDecision = {
  targets: string[];
  mode: BuildSystemTestMode;
  hasBuildSystemChanges: boolean;
};

const AUTO_TARGETS = ["//..."];
const AUTO_SCOPE_IGNORED_BUILD_SYSTEM_PATHS = new Set([
  ".buckconfig",
  ".buckroot",
  ".envrc",
  ".gitignore",
  "README.md",
  "projects",
  "projects/",
  "projects/.metadata_never_index",
  "projects/AGENTS.md",
  "projects/README.md",
  "projects/config/README.md",
  "projects/config/shared.json",
  "build-tools/tools/nix/node-modules.hashes.json",
  "viberoots/build-tools/tools/nix/node-modules.hashes.json",
  ".viberoots/workspace/node/workspace-map.json",
]);

function normalizePath(relPath: string): string {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
}

export function isBuildSystemPath(relPath: string): boolean {
  const p = normalizePath(relPath);
  const sourcePath = p.startsWith("viberoots/") ? p.slice("viberoots/".length) : p;
  if (!p) {
    return false;
  }
  if (p.endsWith(".md") || p.endsWith(".rst")) {
    return false;
  }
  if (sourcePath.startsWith("build-tools/docs/")) {
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
  if (sourcePath.startsWith("build-tools/")) {
    return true;
  }
  if (sourcePath.startsWith("toolchains/")) {
    return true;
  }
  if (sourcePath.startsWith("third_party/providers/")) {
    return true;
  }
  if (p.startsWith(".viberoots/workspace/buck/")) {
    return true;
  }
  if (p.startsWith(".viberoots/workspace/providers/")) {
    return true;
  }
  if (p === "prelude" || p.startsWith("prelude/")) {
    return true;
  }
  return false;
}

export function isIgnoredBuildSystemScopePath(relPath: string): boolean {
  const p = normalizePath(relPath);
  if (!p) {
    return false;
  }
  if (AUTO_SCOPE_IGNORED_BUILD_SYSTEM_PATHS.has(p)) {
    return true;
  }
  if (p === "node_modules" || p.startsWith("node_modules/")) {
    return true;
  }
  if (p.includes("/node_modules/") || p.endsWith("/node_modules")) {
    return true;
  }
  if (p.includes("/.vite-cache/") || p.endsWith("/.vite-cache")) {
    return true;
  }
  if (p.startsWith(".direnv/") || p === ".direnv") {
    return true;
  }
  if (p.startsWith(".nix-zsh/") || p === ".nix-zsh") {
    return true;
  }
  return false;
}

export function hasRelevantBuildSystemChanges(paths: string[]): boolean {
  for (const relPath of paths.map((p) => normalizePath(p)).filter(Boolean)) {
    if (!isBuildSystemPath(relPath)) {
      continue;
    }
    if (isIgnoredBuildSystemScopePath(relPath)) {
      continue;
    }
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
  const out = await $({ cwd: root, stdio: "pipe" })`git ${args}`.nothrow().quiet();
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
  })`git rev-parse --verify --quiet ${ref}`
    .nothrow()
    .quiet();
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
    const mb = await $({ cwd: root, stdio: "pipe" })`git merge-base ${ref} HEAD`.nothrow().quiet();
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
  const rootChangedPaths = await collectGitChangedPaths(root, env);
  const nestedViberootsChangedPaths = await collectNestedViberootsChangedPaths(
    root,
    env,
    rootChangedPaths,
  );
  return Array.from(
    new Set<string>(
      [...rootChangedPaths, ...nestedViberootsChangedPaths].map((p) => normalizePath(p)),
    ),
  ).sort();
}

async function collectGitChangedPaths(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const committed = await mergeBaseChangedPaths(root, env);
  const statusRaw = await $({
    cwd: root,
    stdio: "pipe",
  })`git status --porcelain=v1`
    .nothrow()
    .quiet();
  const statusPaths =
    (statusRaw as any).exitCode === 0
      ? parseStatusPaths(String((statusRaw as any).stdout || ""))
      : [];
  return Array.from(
    new Set<string>([...committed, ...statusPaths].map((p) => normalizePath(p))),
  ).sort();
}

async function collectNestedViberootsChangedPaths(
  root: string,
  env: NodeJS.ProcessEnv,
  rootChangedPaths: string[],
): Promise<string[]> {
  if (!rootChangedPaths.some((p) => p === "viberoots" || p.startsWith("viberoots/"))) {
    return [];
  }
  const currentTarget = await fsp
    .readlink(path.join(root, ".viberoots", "current"))
    .catch(() => "");
  if (currentTarget !== "../viberoots") {
    return [];
  }
  const viberootsRoot = path.join(root, "viberoots");
  let viberootsStat: Awaited<ReturnType<typeof fsp.lstat>> | null = null;
  try {
    viberootsStat = await fsp.lstat(viberootsRoot);
  } catch {}
  if (!viberootsStat || viberootsStat.isSymbolicLink()) {
    return [];
  }
  const hasNestedGit = await fsp
    .access(path.join(viberootsRoot, ".git"))
    .then(() => true)
    .catch(() => false);
  if (!hasNestedGit) {
    return [];
  }
  const nestedPaths = await collectGitChangedPaths(viberootsRoot, env);
  return nestedPaths.map((p) => normalizePath(path.posix.join("viberoots", p))).filter(Boolean);
}

async function hasBuildSystemChanges(root: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const changed = await collectChangedPaths(root, env);
  return hasRelevantBuildSystemChanges(changed);
}

export async function resolveBuildSystemBuckTestScope(opts: {
  root: string;
  requestedTargets: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<ScopeDecision> {
  const env = opts.env || process.env;
  const mode = parseBuildSystemTestMode(env.VBR_BUILD_SYSTEM_TESTS);
  if (!shouldAutoScopeTargets(opts.requestedTargets)) {
    return { targets: opts.requestedTargets, mode, hasBuildSystemChanges: false };
  }

  if (mode === "always") {
    return { targets: AUTO_TARGETS, mode, hasBuildSystemChanges: false };
  }
  if (mode === "never") {
    return {
      targets: await resolveNonBuildSystemBuckTargets(opts.root),
      mode,
      hasBuildSystemChanges: false,
    };
  }

  const changed = await hasBuildSystemChanges(opts.root, env);
  return {
    targets: changed ? AUTO_TARGETS : await resolveNonBuildSystemBuckTargets(opts.root),
    mode,
    hasBuildSystemChanges: changed,
  };
}
