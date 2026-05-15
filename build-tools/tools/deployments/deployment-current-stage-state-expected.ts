#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { readBackendCurrentStageState } from "./deployment-current-stage-state";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db";

export type ReviewedCurrentStageExpectation = {
  expectedCurrentRunId: string | null;
};

export async function reviewedCurrentStageExpectation(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  deployment: DeploymentTarget;
}): Promise<ReviewedCurrentStageExpectation> {
  const state = await readBackendCurrentStageState(opts.backend, {
    deploymentId: opts.deployment.deploymentId,
    environmentStage: opts.deployment.environmentStage,
  });
  return { expectedCurrentRunId: state?.currentRunId || null };
}
