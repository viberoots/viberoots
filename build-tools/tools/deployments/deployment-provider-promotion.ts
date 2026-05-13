#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { requiredDeploymentStageBranch } from "./contract";
import {
  exactArtifactPromotionErrors,
  promotionCompatibilityErrors,
  sourcePromotionRevision,
} from "./deployment-promotion-compatibility";
import { resolveDeploymentGitCommit } from "./deployment-git-ref";
import { sourceRefAllowed } from "./deployment-source-ref-policy";

export async function assertCrossDeploymentExactPromotionEligible(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  source: {
    record: { deployRunId: string };
    replaySnapshot: {
      admittedContext: { source: { sourceRevision: string } };
      deployment: DeploymentTarget;
    };
  };
}) {
  const targetRef = requiredDeploymentStageBranch(opts.deployment);
  const errors = [...promotionCompatibilityErrors(opts.deployment, opts.source)];
  if (!sourceRefAllowed(targetRef, opts.deployment.admissionPolicy.allowedRefs)) {
    errors.push(
      `deployment admission policy ${opts.deployment.admissionPolicyRef} does not allow source ref ${targetRef}`,
    );
  }
  const targetRevision = await resolveDeploymentGitCommit({
    workspaceRoot: opts.workspaceRoot,
    revision: targetRef,
    purpose: "promotion target ref",
  });
  if (targetRevision !== sourcePromotionRevision(opts.source)) {
    errors.push(
      `source run no longer matches current promotable target state: ${opts.source.record.deployRunId}`,
    );
  }
  errors.push(...exactArtifactPromotionErrors(opts.deployment));
  if (errors.length > 0) {
    throw new Error(`promotion source run is not eligible: ${opts.source.record.deployRunId}
${errors.join("\n")}`);
  }
}
