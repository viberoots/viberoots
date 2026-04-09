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
    serviceComponent("//projects/observability/otel-collector:image"),
    serviceComponent("//projects/observability/metrics-agent:image"),
    kubernetesLanePolicyNodeFixture(),
    kubernetesAdmissionPolicyNodeFixture(),
    {
      name: "//projects/deployments/shared-observability-prod:deploy",
      provider: "kubernetes",
      components: [
        {
          id: "otel-collector",
          kind: "third-party-service",
          target: "//projects/observability/otel-collector:image",
        },
        {
          id: "metrics-agent",
          kind: "third-party-service",
          target: "//projects/observability/metrics-agent:image",
        },
      ],
      publisher: "helm-release",
      publisher_config: "helm/values.yaml",
      provisioner: "terraform-stack",
      provisioner_config: "terraform/main.tf.json",
      protection_class: "production_facing",
      lane_policy: "//projects/deployments/pleomino-shared:lane",
      environment_stage: "prod",
      admission_policy: "//projects/deployments/platform-shared:prod_release",
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
