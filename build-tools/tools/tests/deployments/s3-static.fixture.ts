#!/usr/bin/env zx-wrapper
import {
  S3_STATIC_PROVIDER,
  STATIC_WEBAPP_COMPONENT,
  deriveS3StaticProviderTarget,
  type S3StaticDeployment,
} from "../../deployments/contract";
import type { GraphNode } from "../../lib/graph";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture";
export { installS3StaticTargets } from "./deployment-targets.install.helpers";

export function s3StaticDeploymentFixture(
  overrides: Partial<S3StaticDeployment> = {},
): S3StaticDeployment {
  const lanePolicy = overrides.lanePolicy || nixosSharedHostLanePolicyFixture();
  const admissionPolicy =
    overrides.admissionPolicy ||
    nixosSharedHostAdmissionPolicyFixture({
      ref: "//projects/deployments/sample-webapp/shared:staging_release",
      name: "staging_release",
      allowedRefs: ["main"],
      requiredChecks: [],
      fingerprint: "sha256:admission-sample-webapp-s3-staging",
    });
  const providerTarget = {
    ...deriveS3StaticProviderTarget({
      account: "web-platform-staging",
      bucket: "sample-webapp-staging-site",
      region: "us-west-2",
      distribution: "staging.example.test",
    }),
    ...(overrides.providerTarget || {}),
  };
  return {
    deploymentId: overrides.deploymentId || "sample-webapp-staging-s3",
    label: overrides.label || "//projects/deployments/sample-webapp/staging-s3:deploy",
    name: overrides.name || "deploy",
    provider: S3_STATIC_PROVIDER,
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
    ...(overrides.smoke ? { smoke: overrides.smoke } : {}),
    ...(overrides.rolloutPolicy ? { rolloutPolicy: overrides.rolloutPolicy } : {}),
    component: {
      kind: STATIC_WEBAPP_COMPONENT,
      target: overrides.component?.target || "//projects/apps/sample-webapp:app",
    },
    components: overrides.components || [
      {
        id: "default",
        kind: STATIC_WEBAPP_COMPONENT,
        target: overrides.component?.target || "//projects/apps/sample-webapp:app",
      },
    ],
    publisher: overrides.publisher || { type: "aws-s3-sync", config: "aws-s3-sync.jsonc" },
    ...(overrides.provisioner ? { provisioner: overrides.provisioner } : {}),
    providerTarget,
  };
}

export function s3StaticAdmissionPolicyNodeFixture(overrides: Partial<GraphNode> = {}): GraphNode {
  return nixosSharedHostAdmissionPolicyNodeFixture({
    name: "//projects/deployments/sample-webapp/shared:staging_release",
    allowed_refs: ["main"],
    required_checks: ["deploy/sample-webapp-staging-s3"],
    ...overrides,
  });
}

export function s3StaticLanePolicyNodeFixture(overrides: Partial<GraphNode> = {}): GraphNode {
  return nixosSharedHostLanePolicyNodeFixture(overrides);
}
