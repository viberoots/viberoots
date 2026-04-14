#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import {
  deriveKubernetesProviderTarget,
  extractKubernetesDeployments,
} from "../../deployments/contract.ts";
import {
  kubernetesAdmissionPolicyNodeFixture,
  kubernetesLanePolicyNodeFixture,
} from "./kubernetes.fixture.ts";
import {
  nixosSharedHostLaneGovernanceFixture,
  nixosSharedHostLaneGovernanceNodeFixture,
} from "./deployment-lane-governance.fixture.ts";

function serviceComponent(label: string): GraphNode {
  return { name: label, labels: ["kind:app"] };
}

test("deriveKubernetesProviderTarget normalizes canonical target identity", () => {
  assert.deepEqual(
    deriveKubernetesProviderTarget({
      cluster: "prod-us-west",
      namespace: "shared-observability",
      release: "otel-collector",
    }),
    {
      cluster: "prod-us-west",
      namespace: "shared-observability",
      release: "otel-collector",
      id: "prod-us-west/shared-observability/otel-collector",
      providerTargetIdentity: "kubernetes:prod-us-west/shared-observability/otel-collector",
    },
  );
});

test("extractKubernetesDeployments reads shared-platform provider target and rollout", () => {
  const nodes: GraphNode[] = [
    serviceComponent("//test-workspace/observability/otel-collector:image"),
    serviceComponent("//test-workspace/observability/metrics-agent:image"),
    kubernetesLanePolicyNodeFixture(),
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
            requiredChecks: ["deploy/pleomino-staging"],
            fastForwardOnly: true,
            normalAdvancePrincipals: ["app:deploy-bot"],
            emergencyDirectPushPrincipals: ["team:sre-break-glass"],
          },
          {
            stage: "prod",
            branch: "env/pleomino/prod",
            requiredChecks: ["deploy/shared-observability-prod"],
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
    kubernetesAdmissionPolicyNodeFixture(),
    {
      name: "//test-workspace/deployments/shared-observability-prod:deploy",
      provider: "kubernetes",
      components: [
        {
          id: "otel-collector",
          kind: "third-party-service",
          target: "//test-workspace/observability/otel-collector:image",
        },
        {
          id: "metrics-agent",
          kind: "third-party-service",
          target: "//test-workspace/observability/metrics-agent:image",
        },
      ],
      publisher: "helm-release",
      publisher_config: "helm/values.yaml",
      provisioner: "terraform-stack",
      provisioner_config: "terraform/main.tf.json",
      protection_class: "production_facing",
      lane_policy: "//test-workspace/deployments/pleomino-shared:lane",
      environment_stage: "prod",
      admission_policy: "//test-workspace/deployments/platform-shared:prod_release",
      secret_requirements: [],
      runtime_config_requirements: [],
      rollout_policy: {
        mode: "ordered_best_effort",
        abort: "stop_on_first_failure",
        smoke: "final_only",
      },
      rollout_steps: ["otel-collector", "metrics-agent"],
      provider_target: {
        cluster: "prod-us-west",
        namespace: "shared-observability",
        release: "shared-observability",
      },
    },
  ];

  const { deployments, errors } = extractKubernetesDeployments(nodes);
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0]?.publisher.type, "helm-release");
  assert.equal(deployments[0]?.provisioner?.type, "terraform-stack");
  assert.equal(
    deployments[0]?.providerTarget.providerTargetIdentity,
    "kubernetes:prod-us-west/shared-observability/shared-observability",
  );
  assert.deepEqual(deployments[0]?.rolloutPolicy?.steps, ["otel-collector", "metrics-agent"]);
});
