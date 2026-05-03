#!/usr/bin/env zx-wrapper
import {
  deriveVercelProviderTarget,
  SSR_WEBAPP_COMPONENT,
  VERCEL_PROVIDER,
  type VercelDeployment,
} from "../../deployments/contract.ts";
import type { GraphNode } from "../../lib/graph.ts";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture.ts";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture.ts";

export function vercelDeploymentFixture(
  overrides: Partial<VercelDeployment> = {},
): VercelDeployment {
  const lanePolicy = overrides.lanePolicy || nixosSharedHostLanePolicyFixture();
  const admissionPolicy = overrides.admissionPolicy || nixosSharedHostAdmissionPolicyFixture();
  return {
    deploymentId: overrides.deploymentId || "console-staging",
    label: overrides.label || "//projects/deployments/console-staging:deploy",
    name: overrides.name || "deploy",
    provider: VERCEL_PROVIDER,
    protectionClass: overrides.protectionClass || "shared_nonprod",
    lanePolicyRef: overrides.lanePolicyRef || lanePolicy.ref,
    lanePolicy,
    environmentStage: overrides.environmentStage || "staging",
    admissionPolicyRef: overrides.admissionPolicyRef || admissionPolicy.ref,
    admissionPolicy,
    prerequisites: overrides.prerequisites || [],
    secretRequirements: overrides.secretRequirements || [],
    runtimeConfigRequirements: overrides.runtimeConfigRequirements || [],
    releaseActions: overrides.releaseActions || [],
    targetExceptions: overrides.targetExceptions || [],
    component: {
      kind: SSR_WEBAPP_COMPONENT,
      target: overrides.component?.target || "//projects/apps/console:app",
    },
    components: overrides.components || [
      {
        id: "default",
        kind: SSR_WEBAPP_COMPONENT,
        target: overrides.component?.target || "//projects/apps/console:app",
      },
    ],
    publisher: overrides.publisher || {
      type: "vercel-prebuilt",
      config: "vercel-prebuilt.jsonc",
    },
    providerTarget:
      overrides.providerTarget ||
      deriveVercelProviderTarget({
        team: "web-platform",
        project: "console-staging",
        environment: "staging",
      }),
  };
}

export function vercelPolicyNodes(): GraphNode[] {
  return [
    nixosSharedHostLaneGovernanceNodeFixture(),
    nixosSharedHostLanePolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture({
      name: "//projects/deployments/pleomino-shared:staging_release",
      allowed_refs: ["env/pleomino/staging"],
      required_checks: ["deploy/pleomino-staging"],
    }),
  ];
}
