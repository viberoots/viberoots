#!/usr/bin/env zx-wrapper
import type { DeploymentLaneGovernanceSnapshot } from "./deployment-admission-governance";
import type { DeploymentLanePolicy } from "./deployment-policy";

export async function fetchGithubLaneGovernanceSnapshot(opts: {
  lanePolicy: DeploymentLanePolicy;
  env?: NodeJS.ProcessEnv;
}): Promise<DeploymentLaneGovernanceSnapshot> {
  const governance = opts.lanePolicy.governance;
  return {
    scmBackend: "github",
    repository: governance.repository,
    sourceRefPolicies: governance.sourceRefPolicies,
    trustedReporterIdentities: governance.trustedReporterIdentities,
    requiredApprovalBoundaries: governance.requiredApprovalBoundaries,
  };
}
