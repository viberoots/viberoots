#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import {
  deriveS3StaticProviderTarget,
  extractS3StaticDeployments,
} from "../../deployments/contract";
import {
  s3StaticAdmissionPolicyNodeFixture,
  s3StaticLanePolicyNodeFixture,
} from "./s3-static.fixture";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture";

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
      source_ref_policies: [
        { stage: "dev", allowed_refs: "main", required_checks: "deploy/pleomino-dev" },
        {
          stage: "staging",
          allowed_refs: "main,refs/tags/release/*",
          required_checks: "deploy/pleomino-staging-s3",
        },
        {
          stage: "prod",
          allowed_refs: "main,refs/tags/release/*",
          required_checks: "deploy/pleomino-prod",
        },
      ],
    }),
    s3StaticAdmissionPolicyNodeFixture(),
    {
      name: "//projects/deployments/pleomino/staging-s3:deploy",
      provider: "s3-static",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "aws-s3-sync",
      publisher_config: "aws-s3-sync.jsonc",
      provisioner: "terraform-stack",
      protection_class: "shared_nonprod",
      lane_policy: "//projects/deployments/pleomino/shared:lane",
      environment_stage: "staging",
      admission_policy: "//projects/deployments/pleomino/shared:staging_release",
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
