#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { shSingleQuote } from "../lib/shell-quote";
import type { DeploymentTarget } from "./contract";
import { scrubControlPlaneChildEnv } from "./control-plane-process-env";
import { deploymentGitStdout } from "./deployment-git-stdout";
import { requestedDeploymentReviewedSourceRef } from "./deployment-reviewed-source-ref";

const GITHUB_KNOWN_HOSTS = [
  "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
  "github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=",
  "github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=",
].join("\n");

const REVIEWED_SOURCE_SSH_KEY_FILE_ENV = "VBR_DEPLOY_REVIEWED_SOURCE_SSH_KEY_FILE";
const REVIEWED_SOURCE_SSH_KNOWN_HOSTS_FILE_ENV = "VBR_DEPLOY_REVIEWED_SOURCE_SSH_KNOWN_HOSTS_FILE";
const execFileAsync = promisify(execFile);

export type ReviewedSourceCredentialFiles = {
  sshKeyFile: string;
  sshKnownHostsFile: string;
};

export function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function repositorySlug(remoteUrl: string): string {
  return trim(remoteUrl)
    .replace(/\.git$/i, "")
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/^ssh:\/\/[^@]+@[^/]+\//i, "")
    .replace(/^[^@]+@[^:]+:/, "");
}

export function githubSshRemoteForRepository(repository: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`github governance repository must be owner/repo: ${repository}`);
  }
  return `git@github.com:${repository}.git`;
}

export function reviewedFetchTargetFor(deployment: DeploymentTarget, remoteName: string): string {
  const scmBackend = trim(deployment.lanePolicy.governance.scmBackend).toLowerCase();
  const repository = trim(deployment.lanePolicy.governance.repository);
  if (scmBackend === "github" && repository) return githubSshRemoteForRepository(repository);
  return remoteName;
}

async function gitCommandSucceeds(workspaceRoot: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync("git", args, { cwd: workspaceRoot, env: scrubControlPlaneChildEnv() });
    return true;
  } catch {
    return false;
  }
}

export async function ensureReviewedSourceGitRepo(
  workspaceRoot: string,
  deployment: DeploymentTarget,
): Promise<void> {
  if (await gitCommandSucceeds(workspaceRoot, ["rev-parse", "--git-dir"])) return;
  const scmBackend = trim(deployment.lanePolicy.governance.scmBackend).toLowerCase();
  const repository = trim(deployment.lanePolicy.governance.repository);
  if (scmBackend !== "github" || !repository) return;

  await fsp.mkdir(workspaceRoot, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: workspaceRoot, env: scrubControlPlaneChildEnv() });
  const remoteUrl = githubSshRemoteForRepository(repository);
  if (await gitCommandSucceeds(workspaceRoot, ["remote", "get-url", "origin"])) {
    await execFileAsync("git", ["remote", "set-url", "origin", remoteUrl], {
      cwd: workspaceRoot,
      env: scrubControlPlaneChildEnv(),
    });
  } else {
    await execFileAsync("git", ["remote", "add", "origin", remoteUrl], {
      cwd: workspaceRoot,
      env: scrubControlPlaneChildEnv(),
    });
  }
}

export async function resolveReviewedRemoteName(
  workspaceRoot: string,
  deployment: DeploymentTarget,
): Promise<string> {
  const remotes = (
    await deploymentGitStdout(workspaceRoot, ["remote"])
      .then((value) =>
        value
          .split("\n")
          .map((entry) => entry.trim())
          .filter(Boolean),
      )
      .catch(() => [])
  ).filter(Boolean);
  if (remotes.length === 0) {
    throw new Error(
      `control-plane repo is missing a git remote for reviewed source ${requestedDeploymentReviewedSourceRef({ deployment }).ref}`,
    );
  }
  const expectedRepository = trim(deployment.lanePolicy.governance.repository);
  if (expectedRepository) {
    for (const remoteName of remotes) {
      const remoteUrl = await deploymentGitStdout(workspaceRoot, [
        "remote",
        "get-url",
        remoteName,
      ]).catch(() => "");
      if (repositorySlug(remoteUrl) === expectedRepository) return remoteName;
    }
  }
  if (remotes.includes("origin")) return "origin";
  if (remotes.includes("github")) return "github";
  if (remotes.length === 1) return remotes[0] || "";
  throw new Error(
    `could not resolve a reviewed git remote for ${expectedRepository || "<unknown repository>"}; available remotes: ${remotes.join(", ")}`,
  );
}

function isGithubSshRemote(remoteUrl: string): boolean {
  return (
    /^git@github\.com:/i.test(remoteUrl) ||
    /^ssh:\/\/(?:[^@]+@)?github\.com(?::\d+)?\//i.test(remoteUrl)
  );
}

function isRemoteUrl(value: string): boolean {
  return /^(?:https?|ssh):\/\//i.test(value) || /^[^@]+@[^:]+:/i.test(value);
}

export async function gitFetchEnvForReviewedRemote(
  workspaceRoot: string,
  fetchTarget: string,
  credentials?: ReviewedSourceCredentialFiles,
): Promise<{ env?: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  if (!credentials && String(process.env.GIT_SSH_COMMAND || "").trim()) {
    return { env: scrubControlPlaneChildEnv(), cleanup: async () => {} };
  }
  const remoteUrl = isRemoteUrl(fetchTarget)
    ? fetchTarget
    : await deploymentGitStdout(workspaceRoot, ["remote", "get-url", fetchTarget]).catch(() => "");
  if (!isGithubSshRemote(remoteUrl)) {
    return { env: scrubControlPlaneChildEnv(), cleanup: async () => {} };
  }
  const configuredKnownHostsFile =
    trim(credentials?.sshKnownHostsFile) ||
    trim(process.env[REVIEWED_SOURCE_SSH_KNOWN_HOSTS_FILE_ENV]);
  const tmpDir = configuredKnownHostsFile
    ? ""
    : await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-github-known-hosts-"));
  const knownHostsFile = configuredKnownHostsFile || path.join(tmpDir, "known_hosts");
  if (!configuredKnownHostsFile) await fsp.writeFile(knownHostsFile, `${GITHUB_KNOWN_HOSTS}\n`);
  const sshKeyFile =
    trim(credentials?.sshKeyFile) || trim(process.env[REVIEWED_SOURCE_SSH_KEY_FILE_ENV]);
  return {
    env: scrubControlPlaneChildEnv({
      GIT_SSH_COMMAND: [
        "ssh",
        "-o BatchMode=yes",
        ...(sshKeyFile ? [`-i ${shSingleQuote(sshKeyFile)}`, "-o IdentitiesOnly=yes"] : []),
        "-o StrictHostKeyChecking=yes",
        `-o UserKnownHostsFile=${shSingleQuote(knownHostsFile)}`,
      ].join(" "),
    }),
    cleanup: async () => {
      if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true });
    },
  };
}
