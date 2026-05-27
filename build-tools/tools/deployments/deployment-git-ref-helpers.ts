#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import { promisify } from "node:util";
import { scrubControlPlaneChildEnv } from "./control-plane-process-env";

const execFileAsync = promisify(execFile);

export type DeploymentGitRemoteSource = {
  scmBackend?: string;
  repository?: string;
  checkout?: boolean;
};

export function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function githubSshRemoteForRepository(repository: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`github governance repository must be owner/repo: ${repository}`);
  }
  return `git@github.com:${repository}.git`;
}

export async function execGitStdout(
  workspaceRoot: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: workspaceRoot,
      env: scrubControlPlaneChildEnv({}, env),
    });
    return String(stdout || "").trim();
  } catch (error) {
    const stderr = String((error as any)?.stderr || "").trim();
    throw new Error(
      `git ${args.join(" ")} failed in ${workspaceRoot}${stderr ? `: ${stderr}` : ""}`,
    );
  }
}

export async function execGitSucceeds(workspaceRoot: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync("git", args, { cwd: workspaceRoot, env: scrubControlPlaneChildEnv() });
    return true;
  } catch {
    return false;
  }
}

export async function execGit(workspaceRoot: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: workspaceRoot, env: scrubControlPlaneChildEnv() });
}

export async function ensureGithubRemoteRepo(
  opts: {
    workspaceRoot: string;
    remoteName?: string;
  } & DeploymentGitRemoteSource,
): Promise<void> {
  if (await execGitSucceeds(opts.workspaceRoot, ["rev-parse", "--git-dir"])) return;
  const scmBackend = trim(opts.scmBackend).toLowerCase();
  const repository = trim(opts.repository);
  if (scmBackend !== "github" || !repository) return;

  await fsp.mkdir(opts.workspaceRoot, { recursive: true });
  await execGit(opts.workspaceRoot, ["init"]);
  const remoteName = trim(opts.remoteName) || "origin";
  const remoteUrl = githubSshRemoteForRepository(repository);
  if (await execGitSucceeds(opts.workspaceRoot, ["remote", "get-url", remoteName])) {
    await execGit(opts.workspaceRoot, ["remote", "set-url", remoteName, remoteUrl]);
  } else {
    await execGit(opts.workspaceRoot, ["remote", "add", remoteName, remoteUrl]);
  }
}
