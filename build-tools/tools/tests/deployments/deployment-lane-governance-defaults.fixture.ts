#!/usr/bin/env zx-wrapper
import type {
  DeploymentApprovalBoundary,
  DeploymentSourceRefPolicy,
} from "../../deployments/deployment-lane-governance";

export function defaultSourceRefPolicies(): DeploymentSourceRefPolicy[] {
  return [
    { stage: "dev", allowedRefs: ["main"], requiredChecks: ["deploy/sample-webapp-dev"] },
    {
      stage: "staging",
      allowedRefs: ["main", "refs/tags/release/*"],
      requiredChecks: ["deploy/sample-webapp-staging"],
    },
    {
      stage: "prod",
      allowedRefs: ["main", "refs/tags/release/*"],
      requiredChecks: ["deploy/sample-webapp-prod"],
    },
  ];
}

export function defaultApprovalBoundaries(): DeploymentApprovalBoundary[] {
  return [{ stage: "prod", requiredApprovals: ["release-owner"] }];
}
