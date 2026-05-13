#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import {
  deriveKubernetesProviderTarget,
  extractKubernetesDeployments,
} from "../../deployments/contract";
import {
  kubernetesAdmissionPolicyNodeFixture,
  kubernetesLanePolicyNodeFixture,
} from "./kubernetes.fixture";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture";

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
    nixosSharedHostLaneGovernanceNodeFixture({
      source_ref_policies: [
        { stage: "dev", allowed_refs: "main", required_checks: "deploy/pleomino-dev" },
        { stage: "staging", allowed_refs: "main", required_checks: "deploy/pleomino-staging" },
        {
          stage: "prod",
          allowed_refs: "main,refs/tags/release/*",
          required_checks: "deploy/shared-observability-prod",
        },
      ],
    }),
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

test("extractKubernetesDeployments accepts first-class web service posture", () => {
  const { deployments, errors } = extractKubernetesDeployments([
    serviceComponent("//projects/apps/api:image"),
    kubernetesLanePolicyNodeFixture(),
    nixosSharedHostLaneGovernanceNodeFixture(),
    kubernetesAdmissionPolicyNodeFixture({ required_checks: ["deploy/pleomino-prod"] }),
    {
      name: "//projects/deployments/api-prod:deploy",
      provider: "kubernetes",
      component: "//projects/apps/api:image",
      component_kind: "service",
      publisher: "helm-release",
      publisher_config: "helm/values.yaml",
      protection_class: "production_facing",
      lane_policy: "//projects/deployments/pleomino-shared:lane",
      environment_stage: "prod",
      admission_policy: "//projects/deployments/platform-shared:prod_release",
      secret_requirements: [],
      runtime_config_requirements: [],
      provider_target: {
        cluster: "prod-us-west",
        namespace: "web",
        release: "api",
        service_kind: "web",
        ingress_mode: "public",
        health_path: "/healthz",
      },
    },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(deployments[0]?.providerTarget.serviceKind, "web");
  assert.equal(deployments[0]?.providerTarget.ingressMode, "public");
  assert.equal(deployments[0]?.providerTarget.healthPath, "/healthz");
});

test("extractKubernetesDeployments rejects worker public ingress and web without health", () => {
  const base = {
    provider: "kubernetes",
    component: "//projects/apps/api:image",
    component_kind: "service",
    publisher: "helm-release",
    publisher_config: "helm/values.yaml",
    protection_class: "production_facing",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "prod",
    admission_policy: "//projects/deployments/platform-shared:prod_release",
    secret_requirements: [],
    runtime_config_requirements: [],
  };
  const { errors } = extractKubernetesDeployments([
    serviceComponent("//projects/apps/api:image"),
    kubernetesLanePolicyNodeFixture(),
    nixosSharedHostLaneGovernanceNodeFixture(),
    kubernetesAdmissionPolicyNodeFixture(),
    {
      ...base,
      name: "//projects/deployments/api-prod:deploy",
      provider_target: {
        cluster: "prod-us-west",
        namespace: "web",
        release: "api",
        service_kind: "web",
        ingress_mode: "public",
      },
    },
    {
      ...base,
      name: "//projects/deployments/worker-prod:deploy",
      provider_target: {
        cluster: "prod-us-west",
        namespace: "worker",
        release: "jobs",
        service_kind: "worker",
        ingress_mode: "public",
      },
    },
  ]);
  assert.match(errors.join("\n"), /web service deployments must declare health_path/);
  assert.match(errors.join("\n"), /worker service deployments must not declare public ingress/);
});
