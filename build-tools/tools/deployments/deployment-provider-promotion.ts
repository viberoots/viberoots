#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";
import {
  exactArtifactPromotionErrors,
  promotionCompatibilityErrors,
  sourcePromotionRevision,
} from "./deployment-promotion-compatibility.ts";
import { resolveDeploymentGitCommit } from "./deployment-git-ref.ts";

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
  if (!opts.deployment.admissionPolicy.allowedRefs.includes(targetRef)) {
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
