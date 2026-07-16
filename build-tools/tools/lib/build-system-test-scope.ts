import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { collectChangedPaths, type ChangedPathsResult } from "./changed-paths";
import { resolveNonBuildSystemBuckTargets } from "./non-build-system-scope";

export { collectChangedPaths, requireChangedPaths } from "./changed-paths";
export type { ChangedPathsResult } from "./changed-paths";

export type BuildSystemTestMode = "auto" | "always" | "never";

type ScopeDecision = {
  targets: string[];
  mode: BuildSystemTestMode;
  hasBuildSystemChanges: boolean;
  changeAuthorityFailure?: string;
};

const ROOT_AUTO_TARGETS = ["//..."];
const VIBEROOTS_AUTO_TARGET = "viberoots//...";
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

function hasNestedViberootsBuildSystemChanges(paths: string[]): boolean {
  return paths.some(
    (p) =>
      normalizePath(p).startsWith("viberoots/") &&
      isBuildSystemPath(p) &&
      !isIgnoredBuildSystemScopePath(p),
  );
}

async function hasLocalViberootsCell(root: string): Promise<boolean> {
  const currentTarget = await fsp
    .readlink(path.join(root, ".viberoots", "current"))
    .catch(() => "");
  if (currentTarget !== "../viberoots") {
    return false;
  }
  return fsp
    .access(path.join(root, "viberoots", "TARGETS"))
    .then(() => true)
    .catch(() => false);
}

async function autoTargetsForChangedPaths(root: string, changedPaths: string[]): Promise<string[]> {
  const targets = [...ROOT_AUTO_TARGETS];
  if (hasNestedViberootsBuildSystemChanges(changedPaths) && (await hasLocalViberootsCell(root))) {
    targets.push(VIBEROOTS_AUTO_TARGET);
  }
  return targets;
}

export async function resolveBuildSystemBuckTestScope(opts: {
  root: string;
  requestedTargets: string[];
  env?: NodeJS.ProcessEnv;
  changedPathsResult?: ChangedPathsResult;
}): Promise<ScopeDecision> {
  const env = opts.env || process.env;
  const mode = parseBuildSystemTestMode(env.VBR_BUILD_SYSTEM_TESTS);
  if (!shouldAutoScopeTargets(opts.requestedTargets)) {
    return { targets: opts.requestedTargets, mode, hasBuildSystemChanges: false };
  }

  if (mode === "always") {
    return {
      targets: (await hasLocalViberootsCell(opts.root))
        ? [...ROOT_AUTO_TARGETS, VIBEROOTS_AUTO_TARGET]
        : ROOT_AUTO_TARGETS,
      mode,
      hasBuildSystemChanges: false,
    };
  }
  if (mode === "never") {
    return {
      targets: await resolveNonBuildSystemBuckTargets(opts.root),
      mode,
      hasBuildSystemChanges: false,
    };
  }

  const changedPathsResult = opts.changedPathsResult || (await collectChangedPaths(opts.root, env));
  if (!changedPathsResult.ok) {
    return {
      targets: (await hasLocalViberootsCell(opts.root))
        ? [...ROOT_AUTO_TARGETS, VIBEROOTS_AUTO_TARGET]
        : ROOT_AUTO_TARGETS,
      mode,
      hasBuildSystemChanges: true,
      changeAuthorityFailure: changedPathsResult.reason,
    };
  }
  const changed = hasRelevantBuildSystemChanges(changedPathsResult.paths);
  return {
    targets: changed
      ? await autoTargetsForChangedPaths(opts.root, changedPathsResult.paths)
      : await resolveNonBuildSystemBuckTargets(opts.root),
    mode,
    hasBuildSystemChanges: changed,
  };
}
