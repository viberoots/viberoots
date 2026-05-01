#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { DeploymentControlPlaneServiceInstance } from "./deployment-control-plane-contract.ts";
import { CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "./cloudflare-pages-control-plane-api-contract.ts";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "./nixos-shared-host-control-plane-api-contract.ts";
import { requiredDeploymentStageBranch, type DeploymentTarget } from "./contract.ts";

const execFileAsync = promisify(execFile);

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function gitStdout(workspaceRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: workspaceRoot });
  const resolved = trim(stdout);
  if (!resolved) throw new Error(`git ${args.join(" ")} returned empty output`);
  return resolved;
}

function repositorySlug(remoteUrl: string): string {
  return trim(remoteUrl)
    .replace(/\.git$/i, "")
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/^ssh:\/\/[^@]+@[^/]+\//i, "")
    .replace(/^[^@]+@[^:]+:/, "");
}

async function listGitRemotes(workspaceRoot: string): Promise<string[]> {
  try {
    return (await gitStdout(workspaceRoot, ["remote"]))
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function remoteUrlFor(
  workspaceRoot: string,
  remoteName: string,
): Promise<string | undefined> {
  try {
    return await gitStdout(workspaceRoot, ["remote", "get-url", remoteName]);
  } catch {
    return undefined;
  }
}

async function resolveReviewedRemote(
  workspaceRoot: string,
  deployment: DeploymentTarget,
): Promise<{
  reviewedRef: string;
  reviewedRepository: string;
  reviewedRemoteName?: string;
  reviewedRemoteUrl?: string;
}> {
  const reviewedRef = requiredDeploymentStageBranch(deployment);
  const reviewedRepository = trim((deployment as any)?.lanePolicy?.governance?.repository);
  const remotes = await listGitRemotes(workspaceRoot);
  if (remotes.length === 0) {
    return { reviewedRef, reviewedRepository };
  }
  if (reviewedRepository) {
    for (const remoteName of remotes) {
      const remoteUrl = await remoteUrlFor(workspaceRoot, remoteName);
      if (remoteUrl && repositorySlug(remoteUrl) === reviewedRepository) {
        return {
          reviewedRef,
          reviewedRepository,
          reviewedRemoteName: remoteName,
          reviewedRemoteUrl: remoteUrl,
        };
      }
    }
  }
  const fallbackRemoteName = remotes.includes("origin")
    ? "origin"
    : remotes.includes("github")
      ? "github"
      : remotes[0];
  return {
    reviewedRef,
    reviewedRepository,
    ...(fallbackRemoteName ? { reviewedRemoteName: fallbackRemoteName } : {}),
    ...(fallbackRemoteName
      ? { reviewedRemoteUrl: await remoteUrlFor(workspaceRoot, fallbackRemoteName) }
      : {}),
  };
}

export async function resolveControlPlaneServiceInstance(opts: {
  workspaceRoot: string;
  deployment?: DeploymentTarget;
}): Promise<DeploymentControlPlaneServiceInstance> {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const instance: DeploymentControlPlaneServiceInstance = {
    hostname: os.hostname(),
    workspaceRoot,
  };
  try {
    const gitHead = await gitStdout(workspaceRoot, ["rev-parse", "HEAD"]);
    if (gitHead) instance.gitHead = gitHead;
  } catch {}
  if (!opts.deployment) return instance;
  const reviewed = await resolveReviewedRemote(workspaceRoot, opts.deployment);
  return {
    ...instance,
    ...(reviewed.reviewedRef ? { reviewedRef: reviewed.reviewedRef } : {}),
    ...(reviewed.reviewedRepository ? { reviewedRepository: reviewed.reviewedRepository } : {}),
    ...(reviewed.reviewedRemoteName ? { reviewedRemoteName: reviewed.reviewedRemoteName } : {}),
    ...(reviewed.reviewedRemoteUrl ? { reviewedRemoteUrl: reviewed.reviewedRemoteUrl } : {}),
  };
}

export async function resolveReviewedControlPlaneServiceInstance(opts: {
  schemaVersion: string;
  workspaceRoot: string;
  deployment: DeploymentTarget;
}): Promise<DeploymentControlPlaneServiceInstance | undefined> {
  return opts.schemaVersion === NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA ||
    opts.schemaVersion === CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA
    ? await resolveControlPlaneServiceInstance({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
      })
    : undefined;
}
