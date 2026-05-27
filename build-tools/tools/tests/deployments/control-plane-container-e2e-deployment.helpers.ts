#!/usr/bin/env zx-wrapper
import { deriveS3StaticProviderTarget } from "../../deployments/contract";
import { nixosSharedHostLaneGovernanceFixture } from "./deployment-lane-governance.fixture";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";
import { s3StaticDeploymentFixture } from "./s3-static.fixture";

export const E2E_DEPLOYMENT_ID = "cloud-control-fixture-staging-s3";

export function containerE2eDeploymentFixture() {
  const governance = nixosSharedHostLaneGovernanceFixture({
    ref: "//projects/deployments/cloud-control-fixture/shared:lane_governance",
    sourceRefPolicies: [
      { stage: "dev", allowedRefs: ["main"], requiredChecks: [] },
      { stage: "staging", allowedRefs: ["main", "refs/tags/release/*"], requiredChecks: [] },
      { stage: "prod", allowedRefs: ["refs/tags/release/*"], requiredChecks: [] },
    ],
    fingerprint: "sha256:lane-governance-cloud-control-fixture",
  });
  const lanePolicy = nixosSharedHostLanePolicyFixture({
    ref: "//projects/deployments/cloud-control-fixture/shared:lane",
    governanceRef: governance.ref,
    governance,
    fingerprint: "sha256:lane-cloud-control-fixture",
  });
  const admissionPolicy = nixosSharedHostAdmissionPolicyFixture({
    ref: "//projects/deployments/cloud-control-fixture/shared:staging_release",
    name: "staging_release",
    requiredChecks: [],
    fingerprint: "sha256:admission-cloud-control-fixture-staging",
  });
  return s3StaticDeploymentFixture({
    deploymentId: E2E_DEPLOYMENT_ID,
    label: "//projects/deployments/cloud-control-fixture/staging-s3:deploy",
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    lanePolicyRef: lanePolicy.ref,
    lanePolicy,
    component: {
      kind: "static-webapp",
      target: "//projects/apps/cloud-control-fixture:app",
    },
    providerTarget: deriveS3StaticProviderTarget({
      account: "cloud-control-fixture",
      bucket: "cloud-control-fixture-staging-site",
      region: "us-west-2",
      distribution: "cloud-control-fixture.example.test",
    }),
    smoke: {
      exception: {
        owner: "platform",
        reason: "deterministic container fixture",
        scope: "omit container e2e smoke",
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
    },
  });
}
