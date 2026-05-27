#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeploymentTarget } from "./contract";
import { scrubControlPlaneChildEnv } from "./control-plane-process-env";
import {
  explicitReviewedCommitSha,
  isStaleEnvironmentBranchRef,
  isSourceRefPolicyPattern,
  sourceRefAllowed,
  sourceRefMatchesAllowedRef,
  sourceRefPolicyKind,
} from "./deployment-source-ref-policy";

const execFileAsync = promisify(execFile);

export type DeploymentReviewedSourceRef = {
  ref: string;
  kind: ReturnType<typeof sourceRefPolicyKind>;
};

export function requiredDeploymentReviewedSourceRef(deployment: DeploymentTarget) {
  const ref = deployment.lanePolicy.sourceRefPolicy[deployment.environmentStage];
  if (!ref) {
    throw new Error(
      `lane policy ${deployment.lanePolicy.ref} does not define source ref for ${deployment.environmentStage}`,
    );
  }
  if (isStaleEnvironmentBranchRef(ref)) {
    throw new Error(`source_ref_policy must not use environment branch ${ref}`);
  }
  if (!sourceRefAllowed(ref, deployment.admissionPolicy.allowedRefs)) {
    throw new Error(
      `deployment admission policy ${deployment.admissionPolicyRef} does not allow source ref ${ref}`,
    );
  }
  return { ref, kind: sourceRefPolicyKind(ref) };
}

export function requestedDeploymentReviewedSourceRef(opts: {
  deployment: DeploymentTarget;
  requestedSourceRef?: string;
}): DeploymentReviewedSourceRef {
  const policySource = requiredDeploymentReviewedSourceRef(opts.deployment);
  const requestedSourceRef = opts.requestedSourceRef?.trim();
  if (!requestedSourceRef) {
    if (isSourceRefPolicyPattern(policySource.ref)) {
      throw new Error(
        `source_ref_policy ${policySource.ref} is a reviewed source class and requires an explicit reviewed source ref selected by the request`,
      );
    }
    return policySource;
  }
  if (isStaleEnvironmentBranchRef(requestedSourceRef)) {
    throw new Error(
      `requested reviewed source ref must not use environment branch ${requestedSourceRef}`,
    );
  }
  if (!sourceRefAllowed(requestedSourceRef, opts.deployment.admissionPolicy.allowedRefs)) {
    throw new Error(
      `deployment admission policy ${opts.deployment.admissionPolicyRef} does not allow requested source ref ${requestedSourceRef}`,
    );
  }
  if (
    isSourceRefPolicyPattern(policySource.ref) &&
    !sourceRefMatchesAllowedRef(requestedSourceRef, policySource.ref)
  ) {
    throw new Error(
      `requested reviewed source ref ${requestedSourceRef} does not match source_ref_policy ${policySource.ref}`,
    );
  }
  return { ref: requestedSourceRef, kind: sourceRefPolicyKind(requestedSourceRef) };
}

export async function resolveReviewedSourceRevision(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  resolveGitRevision: (workspaceRoot: string, revision: string) => Promise<string>;
  requestedSourceRef?: string;
  requestedSourceRevision?: string;
}): Promise<{ ref: string; kind: DeploymentReviewedSourceRef["kind"]; sha: string }> {
  const source = requestedDeploymentReviewedSourceRef(opts);
  const explicitSha = explicitReviewedCommitSha(source.ref);
  return {
    ...source,
    sha:
      explicitSha ||
      opts.requestedSourceRevision?.trim() ||
      (await opts.resolveGitRevision(opts.workspaceRoot, source.ref)),
  };
}

export async function localGitRevision(workspaceRoot: string, revision: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", revision], {
    cwd: workspaceRoot,
    env: scrubControlPlaneChildEnv(),
  });
  const resolved = String(stdout || "").trim();
  if (!resolved) throw new Error(`empty git revision for ${revision}`);
  return resolved;
}
