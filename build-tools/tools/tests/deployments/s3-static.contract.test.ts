#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import {
  deriveS3StaticProviderTarget,
  extractS3StaticDeployments,
} from "../../deployments/contract.ts";
import {
  s3StaticAdmissionPolicyNodeFixture,
  s3StaticLanePolicyNodeFixture,
} from "./s3-static.fixture.ts";
import {
  nixosSharedHostLaneGovernanceFixture,
  nixosSharedHostLaneGovernanceNodeFixture,
} from "./deployment-lane-governance.fixture.ts";

function staticWebappComponent(label: string): GraphNode {
  return { name: label, labels: ["kind:app", "webapp:static"] };
}

test("deriveS3StaticProviderTarget normalizes canonical url and identity", () => {
  const target = deriveS3StaticProviderTarget({
    account: "web-platform-staging",
    bucket: "pleomino-staging-site",
    region: "us-west-2",
    distribution: "staging.example.test",
  });
  assert.deepEqual(target, {
    account: "web-platform-staging",
    bucket: "pleomino-staging-site",
    region: "us-west-2",
    distribution: "staging.example.test",
    canonicalUrl: "https://staging.example.test/",
    providerTargetIdentity:
      "s3-static:web-platform-staging/pleomino-staging-site#distribution:staging.example.test",
  });
});

test("extractS3StaticDeployments reads provider target, publisher, and provisioner", () => {
  const { deployments, errors } = extractS3StaticDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    s3StaticLanePolicyNodeFixture(),
    nixosSharedHostLaneGovernanceNodeFixture({
      branch_protections: nixosSharedHostLaneGovernanceFixture({
        branchProtections: [
          {
            stage: "dev",
            branch: "env/pleomino/dev",
            requiredChecks: ["deploy/pleomino-dev"],
            fastForwardOnly: true,
            normalAdvancePrincipals: ["app:deploy-bot"],
            emergencyDirectPushPrincipals: ["team:sre-break-glass"],
          },
          {
            stage: "staging",
            branch: "env/pleomino/staging",
            requiredChecks: ["deploy/pleomino-staging-s3"],
            fastForwardOnly: true,
            normalAdvancePrincipals: ["app:deploy-bot"],
            emergencyDirectPushPrincipals: ["team:sre-break-glass"],
          },
          {
            stage: "prod",
            branch: "env/pleomino/prod",
            requiredChecks: ["deploy/pleomino-prod"],
            fastForwardOnly: true,
            normalAdvancePrincipals: ["app:deploy-bot"],
            emergencyDirectPushPrincipals: ["team:sre-break-glass"],
          },
        ],
      }).branchProtections.map((entry) => ({
        stage: entry.stage,
        branch: entry.branch,
        required_checks: entry.requiredChecks.join(","),
        fast_forward_only: "true",
        normal_advance_principals: entry.normalAdvancePrincipals.join(","),
        emergency_direct_push_principals: entry.emergencyDirectPushPrincipals.join(","),
      })),
    }),
    s3StaticAdmissionPolicyNodeFixture(),
    {
      name: "//projects/deployments/pleomino-staging-s3:deploy",
      provider: "s3-static",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "aws-s3-sync",
      publisher_config: "aws-s3-sync.jsonc",
      provisioner: "terraform-stack",
      protection_class: "shared_nonprod",
      lane_policy: "//projects/deployments/pleomino-shared:lane",
      environment_stage: "staging",
      admission_policy: "//projects/deployments/pleomino-shared:staging_release",
      secret_requirements: [],
      runtime_config_requirements: [],
      provider_target: {
        account: "web-platform-staging",
        bucket: "pleomino-staging-site",
        region: "us-west-2",
        distribution: "staging.example.test",
      },
    },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0]?.publisher.type, "aws-s3-sync");
  assert.equal(deployments[0]?.provisioner?.type, "terraform-stack");
  assert.equal(deployments[0]?.providerTarget.bucket, "pleomino-staging-site");
});
