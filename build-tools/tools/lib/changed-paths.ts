import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import "../dev/zx-init.mjs";

export type ChangedPathsResult =
  | { ok: true; paths: string[] }
  | { ok: false; paths: []; reason: string };

function normalizePath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .trim();
}

export function requireChangedPaths(result: ChangedPathsResult): string[] {
  if (!result.ok) throw new Error(`changed-path discovery failed: ${result.reason}`);
  return result.paths;
}

function parseStatusPaths(statusText: string): string[] {
  const out: string[] = [];
  for (const raw of statusText.split(/\r?\n/)) {
    const body = raw.trimEnd().slice(3).trim();
    if (!body) continue;
    if (body.includes(" -> ")) out.push(...body.split(" -> ").map(normalizePath));
    else out.push(normalizePath(body));
  }
  return out.filter(Boolean);
}

type FailedChangedPaths = Extract<ChangedPathsResult, { ok: false }>;

function gitFailure(args: string[], out: unknown): FailedChangedPaths {
  const result = out as { stderr?: unknown; stdout?: unknown };
  const detail = String(result.stderr || result.stdout || "unknown git error").trim();
  return { ok: false, paths: [], reason: `git ${args.join(" ")} failed: ${detail}` };
}

async function gitLines(root: string, args: string[]): Promise<ChangedPathsResult> {
  const out = await $({ cwd: root, stdio: "pipe" })`git ${args}`.nothrow().quiet();
  if ((out as any).exitCode !== 0) return gitFailure(args, out);
  return {
    ok: true,
    paths: String((out as any).stdout || "")
      .split(/\r?\n/)
      .map(normalizePath)
      .filter(Boolean),
  };
}

async function gitRefExists(
  root: string,
  ref: string,
): Promise<{ ok: true; exists: boolean } | { ok: false; reason: string }> {
  const args = ["rev-parse", "--verify", "--quiet", ref];
  const out = await $({ cwd: root, stdio: "pipe" })`git rev-parse --verify --quiet ${ref}`
    .nothrow()
    .quiet();
  const exitCode = Number((out as any).exitCode);
  if (exitCode === 0) return { ok: true, exists: true };
  if (exitCode === 1) return { ok: true, exists: false };
  return { ok: false, reason: gitFailure(args, out).reason };
}

async function mergeBaseChangedPaths(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<ChangedPathsResult> {
  const baseRefs: string[] = [];
  const baseBranch = String(env.GITHUB_BASE_REF || "").trim();
  if (baseBranch) baseRefs.push(`origin/${baseBranch}`, `github/${baseBranch}`, baseBranch);
  baseRefs.push("github/main", "origin/main", "main");

  let mergeBase = "";
  for (const ref of baseRefs) {
    const refResult = await gitRefExists(root, ref);
    if (!refResult.ok) return { ok: false, paths: [], reason: refResult.reason };
    if (!refResult.exists) continue;
    const out = await $({ cwd: root, stdio: "pipe" })`git merge-base ${ref} HEAD`.nothrow().quiet();
    if ((out as any).exitCode !== 0) return gitFailure(["merge-base", ref, "HEAD"], out);
    mergeBase = String((out as any).stdout || "").trim();
    if (mergeBase) break;
  }
  if (!mergeBase) {
    const previous = await gitRefExists(root, "HEAD~1");
    if (!previous.ok) return { ok: false, paths: [], reason: previous.reason };
    if (!previous.exists) return { ok: true, paths: [] };
    return await gitLines(root, ["diff", "--name-only", "--no-renames", "HEAD~1...HEAD"]);
  }
  return await gitLines(root, ["diff", "--name-only", "--no-renames", `${mergeBase}...HEAD`]);
}

async function collectGitChangedPaths(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<ChangedPathsResult> {
  const committed = await mergeBaseChangedPaths(root, env);
  if (!committed.ok) return committed;
  const statusArgs = ["status", "--porcelain=v1"];
  const status = await $({ cwd: root, stdio: "pipe" })`git status --porcelain=v1`.nothrow().quiet();
  if ((status as any).exitCode !== 0) return gitFailure(statusArgs, status);
  return {
    ok: true,
    paths: Array.from(
      new Set([...committed.paths, ...parseStatusPaths(String((status as any).stdout || ""))]),
    ).sort(),
  };
}

async function collectNestedPaths(
  root: string,
  env: NodeJS.ProcessEnv,
  rootPaths: string[],
): Promise<ChangedPathsResult> {
  if (!rootPaths.some((value) => value === "viberoots" || value.startsWith("viberoots/")))
    return { ok: true, paths: [] };
  const currentTarget = await fsp
    .readlink(path.join(root, ".viberoots", "current"))
    .catch(() => "");
  if (currentTarget !== "../viberoots") return { ok: true, paths: [] };
  const nestedRoot = path.join(root, "viberoots");
  const stat = await fsp.lstat(nestedRoot).catch(() => null);
  if (!stat || stat.isSymbolicLink()) return { ok: true, paths: [] };
  const hasGit = await fsp
    .access(path.join(nestedRoot, ".git"))
    .then(() => true)
    .catch(() => false);
  if (!hasGit) return { ok: true, paths: [] };
  const nested = await collectGitChangedPaths(nestedRoot, env);
  if (!nested.ok) return { ok: false, paths: [], reason: `nested viberoots: ${nested.reason}` };
  return {
    ok: true,
    paths: nested.paths.map((value) => normalizePath(path.posix.join("viberoots", value))),
  };
}

export async function collectChangedPaths(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ChangedPathsResult> {
  const rootPaths = await collectGitChangedPaths(root, env);
  if (!rootPaths.ok) return rootPaths;
  const nestedPaths = await collectNestedPaths(root, env, rootPaths.paths);
  if (!nestedPaths.ok) return nestedPaths;
  return {
    ok: true,
    paths: Array.from(
      new Set([...rootPaths.paths, ...nestedPaths.paths].map(normalizePath)),
    ).sort(),
  };
}
