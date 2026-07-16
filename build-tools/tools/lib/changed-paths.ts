import * as fsp from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { parseDiffNameStatusZ, parsePorcelainStatusZ } from "./git-changed-path-records";

export type ChangedPathsResult =
  | { ok: true; paths: string[] }
  | { ok: false; paths: []; reason: string };

function normalizePath(value: string): string {
  return String(value || "");
}

export function requireChangedPaths(result: ChangedPathsResult): string[] {
  if (!result.ok) throw new Error(`changed-path discovery failed: ${result.reason}`);
  return result.paths;
}

type FailedChangedPaths = Extract<ChangedPathsResult, { ok: false }>;

type GitResult = { exitCode: number; stdout: Buffer; stderr: Buffer };

async function runGit(root: string, args: string[]): Promise<GitResult> {
  return await new Promise((resolve) => {
    const child = spawn("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: -1, stdout: Buffer.concat(stdout), stderr: Buffer.from(String(error)) });
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}

function gitFailure(args: string[], result: GitResult): FailedChangedPaths {
  const detail =
    String(result.stderr.length ? result.stderr : result.stdout).trim() || "unknown git error";
  return { ok: false, paths: [], reason: `git ${args.join(" ")} failed: ${detail}` };
}

async function gitPathRecords(
  root: string,
  args: string[],
  parse: (stdout: Uint8Array) => string[],
): Promise<ChangedPathsResult> {
  const result = await runGit(root, args);
  if (result.exitCode !== 0) return gitFailure(args, result);
  try {
    return { ok: true, paths: parse(result.stdout) };
  } catch (error) {
    return {
      ok: false,
      paths: [],
      reason: `git ${args.join(" ")} returned malformed records: ${String(error)}`,
    };
  }
}

async function gitRefExists(
  root: string,
  ref: string,
): Promise<{ ok: true; exists: boolean } | { ok: false; reason: string }> {
  const args = ["rev-parse", "--verify", "--quiet", ref];
  const out = await runGit(root, args);
  const exitCode = out.exitCode;
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
    const args = ["merge-base", ref, "HEAD"];
    const out = await runGit(root, args);
    if (out.exitCode !== 0) return gitFailure(args, out);
    mergeBase = String(out.stdout).trim();
    if (mergeBase) break;
  }
  if (!mergeBase) {
    const previous = await gitRefExists(root, "HEAD~1");
    if (!previous.ok) return { ok: false, paths: [], reason: previous.reason };
    if (!previous.exists) return { ok: true, paths: [] };
    return await gitPathRecords(
      root,
      ["diff", "--name-status", "-z", "--find-renames", "HEAD~1...HEAD"],
      parseDiffNameStatusZ,
    );
  }
  return await gitPathRecords(
    root,
    ["diff", "--name-status", "-z", "--find-renames", `${mergeBase}...HEAD`],
    parseDiffNameStatusZ,
  );
}

async function collectGitChangedPaths(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<ChangedPathsResult> {
  const committed = await mergeBaseChangedPaths(root, env);
  if (!committed.ok) return committed;
  const status = await gitPathRecords(
    root,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    parsePorcelainStatusZ,
  );
  if (!status.ok) return status;
  return {
    ok: true,
    paths: Array.from(new Set([...committed.paths, ...status.paths])).sort(),
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
