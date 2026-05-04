#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import { extractS3StaticDeployments } from "../../deployments/contract";
import { REVIEWED_NON_STATIC_COMPONENT_KINDS } from "../../deployments/deployment-provider-capabilities";
import {
  s3StaticAdmissionPolicyNodeFixture,
  s3StaticLanePolicyNodeFixture,
} from "./s3-static.fixture";

function staticWebappComponent(label: string): GraphNode {
  return { name: label, labels: ["kind:app", "webapp:pwa"] };
}

function deploymentNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
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
    ...overrides,
  };
}

function policyNodes(): GraphNode[] {
  return [s3StaticLanePolicyNodeFixture(), s3StaticAdmissionPolicyNodeFixture()];
}

test("validation rejects preview and unsupported rollout modes for s3-static", () => {
  const { errors } = extractS3StaticDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    ...policyNodes(),
    deploymentNode({
      preview: { target_derivation: "provider_managed_source_run" },
      rollout_policy: { mode: "canary", abort: "", smoke: "" },
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("does not support preview")));
  assert.ok(
    errors.some((entry) => entry.includes('does not support rollout_policy.mode "canary"')),
  );
});

test("validation rejects unsupported publisher and provisioner", () => {
  const { errors } = extractS3StaticDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    ...policyNodes(),
    deploymentNode({ publisher: "other", provisioner: "custom" }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("unsupported s3-static publisher")));
  assert.ok(errors.some((entry) => entry.includes("unsupported s3-static provisioner")));
});

test("validation rejects reviewed non-static kinds until s3-static declares support", () => {
  for (const kind of REVIEWED_NON_STATIC_COMPONENT_KINDS) {
    const { errors } = extractS3StaticDeployments([
      { name: "//projects/apps/pleomino:app", labels: ["kind:app", "webapp:ssr"] },
      ...policyNodes(),
      deploymentNode({ component_kind: kind }),
    ]);
    assert.ok(
      errors.some((entry) => entry.includes(`does not support component_kind "${kind}"`)),
      `expected s3-static to reject ${kind}, saw: ${errors.join("\n")}`,
    );
  }
});
