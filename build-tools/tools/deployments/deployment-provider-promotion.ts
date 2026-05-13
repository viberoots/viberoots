#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { requiredDeploymentSourceRef } from "./contract";
import {
  exactArtifactPromotionErrors,
  promotionCompatibilityErrors,
} from "./deployment-promotion-compatibility";
import {
  promotionStageStateErrors,
  type DeploymentPromotionStageStateSource,
} from "./deployment-promotion-stage-state";
import { sourceRefAllowed } from "./deployment-source-ref-policy";

export async function assertCrossDeploymentExactPromotionEligible(opts: {
  workspaceRoot?: string;
  deployment: DeploymentTarget;
  recordsRoot: string;
  backendDatabaseUrl?: string;
  source: DeploymentPromotionStageStateSource & {
    record: DeploymentPromotionStageStateSource["record"] & {
      deploymentId: string;
      finalOutcome?: string;
      publishMode?: string;
    };
    replaySnapshot: DeploymentPromotionStageStateSource["replaySnapshot"] & {
      admittedContext: DeploymentPromotionStageStateSource["replaySnapshot"]["admittedContext"] & {
        lanePolicyFingerprint: string;
      };
    };
  };
}) {
  const targetRef = requiredDeploymentSourceRef(opts.deployment);
  const errors = [...promotionCompatibilityErrors(opts.deployment, opts.source)];
  if (!sourceRefAllowed(targetRef, opts.deployment.admissionPolicy.allowedRefs)) {
    errors.push(
      `deployment admission policy ${opts.deployment.admissionPolicyRef} does not allow source ref ${targetRef}`,
    );
  }
  errors.push(
    ...(await promotionStageStateErrors({
      deployment: opts.deployment,
      recordsRoot: opts.recordsRoot,
      backendDatabaseUrl: opts.backendDatabaseUrl,
      source: opts.source,
    })),
  );
  errors.push(...exactArtifactPromotionErrors(opts.deployment));
  if (errors.length > 0) {
    throw new Error(`promotion source run is not eligible: ${opts.source.record.deployRunId}
${errors.join("\n")}`);
  }
}
