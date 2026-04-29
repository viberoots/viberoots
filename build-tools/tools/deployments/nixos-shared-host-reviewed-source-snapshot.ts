#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shSingleQuote } from "../lib/shell-quote.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";

const GITHUB_KNOWN_HOSTS = [
  "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
  "github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=",
  "github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=",
].join("\n");

export type NixosSharedHostReviewedSourceSnapshot = {
  reviewedRef: string;
  snapshotRef: string;
  sourceRevision: string;
  remoteName: string;
  repository: string;
  snapshottedAt: string;
};

type ReviewedSourceCarrier =
  | NixosSharedHostReviewedSourceSnapshot
  | {
      reviewedSourceSnapshot?: NixosSharedHostReviewedSourceSnapshot;
      admittedContext?: {
        targetEnvironment?: {
          reviewedSourceSnapshot?: NixosSharedHostReviewedSourceSnapshot;
        };
      };
      targetEnvironment?: {
        reviewedSourceSnapshot?: NixosSharedHostReviewedSourceSnapshot;
      };
    };

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function gitStdout(
  workspaceRoot: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe", env })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0) {
    throw new Error(String((out as any).stderr || "").trim() || `git ${args.join(" ")} failed`);
  }
  return String((out as any).stdout || "").trim();
}

function repositorySlug(remoteUrl: string): string {
  return trim(remoteUrl)
    .replace(/\.git$/i, "")
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/^ssh:\/\/[^@]+@[^/]+\//i, "")
    .replace(/^[^@]+@[^:]+:/, "");
}

async function resolveReviewedRemoteName(
  workspaceRoot: string,
  deployment: NixosSharedHostDeployment,
): Promise<string> {
  const remotes = (
    await gitStdout(workspaceRoot, ["remote"])
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
      `control-plane repo is missing a git remote for reviewed source ${requiredDeploymentStageBranch(deployment)}`,
    );
  }
  const expectedRepository = trim(deployment.lanePolicy.governance.repository);
  if (expectedRepository) {
    for (const remoteName of remotes) {
      const remoteUrl = await gitStdout(workspaceRoot, ["remote", "get-url", remoteName]).catch(
        () => "",
      );
      if (repositorySlug(remoteUrl) === expectedRepository) {
        return remoteName;
      }
    }
  }
  if (remotes.includes("origin")) return "origin";
  if (remotes.includes("github")) return "github";
  if (remotes.length === 1) return remotes[0] || "";
  throw new Error(
    `could not resolve a reviewed git remote for ${expectedRepository || "<unknown repository>"}; available remotes: ${remotes.join(", ")}`,
  );
}

function snapshotRefFor(submissionId: string, reviewedRef: string): string {
  return `refs/bnx/reviewed-source/${submissionId}/${reviewedRef}`;
}

function isGithubSshRemote(remoteUrl: string): boolean {
  return (
    /^git@github\.com:/i.test(remoteUrl) ||
    /^ssh:\/\/(?:[^@]+@)?github\.com(?::\d+)?\//i.test(remoteUrl)
  );
}

async function gitFetchEnvForReviewedRemote(
  workspaceRoot: string,
  remoteName: string,
): Promise<{ env?: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  if (String(process.env.GIT_SSH_COMMAND || "").trim()) {
    return { cleanup: async () => {} };
  }
  const remoteUrl = await gitStdout(workspaceRoot, ["remote", "get-url", remoteName]).catch(
    () => "",
  );
  if (!isGithubSshRemote(remoteUrl)) return { cleanup: async () => {} };
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "bnx-github-known-hosts-"));
  const knownHostsFile = path.join(tmpDir, "known_hosts");
  await fsp.writeFile(knownHostsFile, `${GITHUB_KNOWN_HOSTS}\n`, "utf8");
  return {
    env: {
      ...process.env,
      GIT_SSH_COMMAND: [
        "ssh",
        "-o BatchMode=yes",
        "-o StrictHostKeyChecking=yes",
        `-o UserKnownHostsFile=${shSingleQuote(knownHostsFile)}`,
      ].join(" "),
    },
    cleanup: async () => {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

export async function snapshotReviewedSourceForSubmission(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  submissionId: string;
  expectedSourceRevision?: string;
}): Promise<NixosSharedHostReviewedSourceSnapshot> {
  const reviewedRef = requiredDeploymentStageBranch(opts.deployment);
  const remoteName = await resolveReviewedRemoteName(opts.workspaceRoot, opts.deployment);
  const snapshotRef = snapshotRefFor(opts.submissionId, reviewedRef);
  const fetchEnv = await gitFetchEnvForReviewedRemote(opts.workspaceRoot, remoteName);
  try {
    await gitStdout(
      opts.workspaceRoot,
      ["fetch", "--no-tags", "--no-write-fetch-head", remoteName, `${reviewedRef}:${snapshotRef}`],
      fetchEnv.env,
    );
  } finally {
    await fetchEnv.cleanup();
  }
  const sourceRevision = await gitStdout(opts.workspaceRoot, [
    "rev-parse",
    `${snapshotRef}^{commit}`,
  ]);
  const expectedSourceRevision = trim(opts.expectedSourceRevision);
  if (expectedSourceRevision && expectedSourceRevision !== sourceRevision) {
    await $({ cwd: opts.workspaceRoot, stdio: "pipe" })`git update-ref -d ${snapshotRef}`.nothrow();
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      [
        `protected/shared reviewed source mismatch for ${reviewedRef}`,
        `clientExpectedSourceRevision=${expectedSourceRevision}`,
        `serviceReviewedSourceRevision=${sourceRevision}`,
        `serviceRemote=${remoteName}`,
        "Make sure the deployment branch is up to date and pushed before retrying.",
        `Sync the service-side reviewed ref or rerun with --mark-check-for-commit ${sourceRevision} if ${sourceRevision} is intentionally the reviewed commit to deploy.`,
      ].join("\n"),
    );
  }
  return {
    reviewedRef,
    snapshotRef,
    sourceRevision,
    remoteName,
    repository: trim(opts.deployment.lanePolicy.governance.repository),
    snapshottedAt: new Date().toISOString(),
  };
}

export function reviewedSourceSnapshotFrom(
  value: ReviewedSourceCarrier | undefined,
): NixosSharedHostReviewedSourceSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("snapshotRef" in value && trim((value as { snapshotRef?: unknown }).snapshotRef)) {
    return value as NixosSharedHostReviewedSourceSnapshot;
  }
  return (
    value.reviewedSourceSnapshot ||
    value.targetEnvironment?.reviewedSourceSnapshot ||
    value.admittedContext?.targetEnvironment?.reviewedSourceSnapshot
  );
}

export async function cleanupReviewedSourceSnapshot(
  workspaceRoot: string,
  value: ReviewedSourceCarrier | undefined,
): Promise<void> {
  const snapshot = reviewedSourceSnapshotFrom(value);
  const snapshotRef = trim(snapshot?.snapshotRef);
  if (!snapshotRef) return;
  await $({ cwd: workspaceRoot, stdio: "pipe" })`git update-ref -d ${snapshotRef}`.nothrow();
}
