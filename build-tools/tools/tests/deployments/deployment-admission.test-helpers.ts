#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator.ts";
import { providerTargetIdentityFor } from "../../deployments/contract.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

type ReviewedDeployment = ReturnType<typeof nixosSharedHostDeploymentFixture>;
type AdmissionArgs = Parameters<typeof evaluateDeploymentAdmission>[0];

export function admittedContextFixture(
  deployment: ReviewedDeployment,
  overrides: Partial<{
    sourceRevision: string;
    artifactIdentity: string;
    sourceRunId: string;
  }> = {},
) {
  return {
    source: {
      sourceRevision: overrides.sourceRevision || "rev-source-123",
      artifactIdentity: overrides.artifactIdentity || "artifact-123",
      ...(overrides.sourceRunId ? { sourceRunId: overrides.sourceRunId } : {}),
    },
    targetEnvironment: {
      providerTargetIdentity: providerTargetIdentityFor(deployment),
    },
  };
}

export function deploymentRecordsRoot(workspaceRoot: string, provider: string): string {
  return path.join(workspaceRoot, ".local", "deployments", provider, "records");
}

export function admissionEvalBase(
  provider: string,
  args: Omit<AdmissionArgs, "workspaceRoot" | "recordsRoot">,
): AdmissionArgs {
  const workspaceRoot = process.cwd();
  return {
    workspaceRoot,
    recordsRoot: deploymentRecordsRoot(workspaceRoot, provider),
    ...args,
  };
}
