#!/usr/bin/env zx-wrapper
import { gitFetchEnvForReviewedRemote } from "./nixos-shared-host-reviewed-source-snapshot";
import type { DeploymentGitRemoteSource } from "./deployment-git-ref-helpers";
import {
  ensureGithubRemoteRepo,
  execGit,
  execGitStdout,
  execGitSucceeds,
} from "./deployment-git-ref-helpers";

export type DeploymentGitFetchMode = "never" | "if_missing" | "before_resolve";

export async function deploymentGitStdout(
  workspaceRoot: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return execGitStdout(workspaceRoot, args, env);
}

export async function deploymentGitSucceeds(
  workspaceRoot: string,
  args: string[],
): Promise<boolean> {
  return execGitSucceeds(workspaceRoot, args);
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

async function ensureDeploymentGitRepo(
  opts: {
    workspaceRoot: string;
    remoteName?: string;
  } & DeploymentGitRemoteSource,
): Promise<void> {
  await ensureGithubRemoteRepo(opts);
}

async function fetchDeploymentGitRemoteRefs(
  opts: {
    workspaceRoot: string;
    remoteName?: string;
  } & DeploymentGitRemoteSource,
): Promise<string | undefined> {
  await ensureDeploymentGitRepo(opts);
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
  try {
    const stdout = await execGitStdout(workspaceRoot, [
      "rev-parse",
      "--verify",
      `${candidate}^{commit}`,
    ]);
    const resolved = String(stdout || "").trim();
    return resolved || undefined;
  } catch {
    return undefined;
  }
}

async function checkoutDeploymentGitCommit(workspaceRoot: string, revision: string): Promise<void> {
  await execGit(workspaceRoot, ["checkout", "--quiet", "--detach", revision]);
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

export async function resolveDeploymentGitCommit(
  opts: {
    workspaceRoot: string;
    revision: string;
    purpose?: string;
    fetchMode?: DeploymentGitFetchMode;
    remoteName?: string;
  } & DeploymentGitRemoteSource,
): Promise<string> {
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
      scmBackend: opts.scmBackend,
      repository: opts.repository,
    });
  }

  const resolved = await resolveCommitCandidate(opts.workspaceRoot, revision);
  if (resolved) {
    if (opts.checkout) await checkoutDeploymentGitCommit(opts.workspaceRoot, resolved);
    return resolved;
  }

  if (fetchMode === "never") {
    throw new Error(`${opts.purpose || "deployment git revision"} ${revision} is not available`);
  }

  try {
    fetchedRemote =
      fetchedRemote ||
      (await fetchDeploymentGitRemoteRefs({
        workspaceRoot: opts.workspaceRoot,
        remoteName: opts.remoteName,
        scmBackend: opts.scmBackend,
        repository: opts.repository,
      }));
  } catch (error) {
    throw new Error(
      `${opts.purpose || "deployment git revision"} ${revision} is not available in ${
        opts.workspaceRoot
      }, and git fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const retryResolved = await resolveCommitCandidate(opts.workspaceRoot, revision);
  if (retryResolved) {
    if (opts.checkout) await checkoutDeploymentGitCommit(opts.workspaceRoot, retryResolved);
    return retryResolved;
  }
  const remoteCandidate = remoteTrackingCandidate(fetchedRemote, revision);
  if (remoteCandidate) {
    const remoteResolved = await resolveCommitCandidate(opts.workspaceRoot, remoteCandidate);
    if (remoteResolved) {
      if (opts.checkout) await checkoutDeploymentGitCommit(opts.workspaceRoot, remoteResolved);
      return remoteResolved;
    }
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
  try {
    await execGit(opts.workspaceRoot, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}
