#!/usr/bin/env zx-wrapper
import { gitFetchEnvForReviewedRemote } from "./nixos-shared-host-reviewed-source-snapshot";

export type DeploymentGitFetchMode = "never" | "if_missing" | "before_resolve";

export async function deploymentGitStdout(
  workspaceRoot: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe", env })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0) {
    const stderr = String((out as any).stderr || "").trim();
    throw new Error(
      `git ${args.join(" ")} failed in ${workspaceRoot}${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return String((out as any).stdout || "").trim();
}

export async function deploymentGitSucceeds(
  workspaceRoot: string,
  args: string[],
): Promise<boolean> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe" })`git ${args}`.nothrow();
  return (out as any).exitCode === 0;
}

async function deploymentGitRemotes(workspaceRoot: string): Promise<string[]> {
  return (await deploymentGitStdout(workspaceRoot, ["remote"]))
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function preferredDeploymentGitRemote(
  workspaceRoot: string,
  requestedRemote?: string,
): Promise<string | undefined> {
  const remotes = await deploymentGitRemotes(workspaceRoot);
  if (requestedRemote && remotes.includes(requestedRemote)) return requestedRemote;
  return (
    remotes.find((name) => name === "github") ||
    remotes.find((name) => name === "origin") ||
    remotes[0]
  );
}

async function fetchDeploymentGitRemoteRefs(opts: {
  workspaceRoot: string;
  remoteName?: string;
}): Promise<string | undefined> {
  const remoteName = await preferredDeploymentGitRemote(opts.workspaceRoot, opts.remoteName);
  if (!remoteName) return undefined;
  const fetchEnv = await gitFetchEnvForReviewedRemote(opts.workspaceRoot, remoteName);
  try {
    await deploymentGitStdout(
      opts.workspaceRoot,
      [
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        remoteName,
        `+refs/heads/*:refs/remotes/${remoteName}/*`,
      ],
      fetchEnv.env,
    );
  } finally {
    await fetchEnv.cleanup();
  }
  return remoteName;
}

async function resolveCommitCandidate(
  workspaceRoot: string,
  candidate: string,
): Promise<string | undefined> {
  const out = await $({
    cwd: workspaceRoot,
    stdio: "pipe",
  })`git rev-parse --verify ${`${candidate}^{commit}`}`.nothrow();
  if ((out as any).exitCode !== 0) return undefined;
  const resolved = String((out as any).stdout || "").trim();
  return resolved || undefined;
}

function remoteTrackingCandidate(
  remoteName: string | undefined,
  revision: string,
): string | undefined {
  if (!remoteName || revision.startsWith("refs/") || /^[0-9a-f]{7,40}$/i.test(revision)) {
    return undefined;
  }
  return `${remoteName}/${revision}`;
}

export async function resolveDeploymentGitCommit(opts: {
  workspaceRoot: string;
  revision: string;
  purpose?: string;
  fetchMode?: DeploymentGitFetchMode;
  remoteName?: string;
}): Promise<string> {
  const revision = opts.revision.trim();
  if (!revision) {
    throw new Error(`${opts.purpose || "deployment git revision"} requires a non-empty revision`);
  }
  const fetchMode = opts.fetchMode || "if_missing";
  let fetchedRemote: string | undefined;
  if (fetchMode === "before_resolve") {
    fetchedRemote = await fetchDeploymentGitRemoteRefs({
      workspaceRoot: opts.workspaceRoot,
      remoteName: opts.remoteName,
    });
  }

  const resolved = await resolveCommitCandidate(opts.workspaceRoot, revision);
  if (resolved) return resolved;

  if (fetchMode === "never") {
    throw new Error(`${opts.purpose || "deployment git revision"} ${revision} is not available`);
  }

  try {
    fetchedRemote =
      fetchedRemote ||
      (await fetchDeploymentGitRemoteRefs({
        workspaceRoot: opts.workspaceRoot,
        remoteName: opts.remoteName,
      }));
  } catch (error) {
    throw new Error(
      `${opts.purpose || "deployment git revision"} ${revision} is not available in ${
        opts.workspaceRoot
      }, and git fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const retryResolved = await resolveCommitCandidate(opts.workspaceRoot, revision);
  if (retryResolved) return retryResolved;
  const remoteCandidate = remoteTrackingCandidate(fetchedRemote, revision);
  if (remoteCandidate) {
    const remoteResolved = await resolveCommitCandidate(opts.workspaceRoot, remoteCandidate);
    if (remoteResolved) return remoteResolved;
  }

  throw new Error(
    `${opts.purpose || "deployment git revision"} ${revision} is not available in ${
      opts.workspaceRoot
    }${
      fetchedRemote ? ` after fetching ${fetchedRemote}` : " and no git remote is configured"
    }; push the commit or update the service checkout's fetch access, then retry the deploy`,
  );
}

export async function deploymentGitIsAncestor(opts: {
  workspaceRoot: string;
  ancestorRevision: string;
  descendantRevision: string;
  purpose?: string;
}): Promise<boolean> {
  const ancestor = await resolveDeploymentGitCommit({
    workspaceRoot: opts.workspaceRoot,
    revision: opts.ancestorRevision,
    purpose: opts.purpose || "deployment ancestor revision",
  });
  const descendant = await resolveDeploymentGitCommit({
    workspaceRoot: opts.workspaceRoot,
    revision: opts.descendantRevision,
    purpose: opts.purpose || "deployment descendant revision",
  });
  const out = await $({
    cwd: opts.workspaceRoot,
    stdio: "pipe",
  })`git merge-base --is-ancestor ${ancestor} ${descendant}`.nothrow();
  return (out as any).exitCode === 0;
}
