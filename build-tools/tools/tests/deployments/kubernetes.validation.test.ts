#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import { extractKubernetesDeployments } from "../../deployments/contract.ts";
import {
  kubernetesAdmissionPolicyNodeFixture,
  kubernetesLanePolicyNodeFixture,
} from "./kubernetes.fixture.ts";

function serviceComponent(label: string): GraphNode {
  return { name: label, labels: ["kind:app"] };
}

function deploymentNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//test-workspace/deployments/api-prod:deploy",
    provider: "kubernetes",
    component: "//test-workspace/apps/api:image",
    component_kind: "service",
    publisher: "helm-release",
    publisher_config: "helm/values.yaml",
    provisioner: "cdktf-stack",
    provisioner_config: "cdktf/stack.json",
    protection_class: "shared_nonprod",
    lane_policy: "//test-workspace/deployments/pleomino-shared:lane",
    environment_stage: "staging",
    admission_policy: "//test-workspace/deployments/platform-shared:prod_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    provider_target: {
      cluster: "prod-us-west",
      namespace: "api-prod",
      release: "api",
    },
    ...overrides,
  };
}

function policyNodes(): GraphNode[] {
  return [kubernetesLanePolicyNodeFixture(), kubernetesAdmissionPolicyNodeFixture()];
}

test("validation rejects unsupported kubernetes publisher and provisioner drift", () => {
  const { errors } = extractKubernetesDeployments([
    serviceComponent("//test-workspace/apps/api:image"),
    ...policyNodes(),
    deploymentNode({ publisher: "other", provisioner: "custom" }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("unsupported kubernetes publisher")));
  assert.ok(errors.some((entry) => entry.includes("unsupported kubernetes provisioner")));
});

test("validation rejects unsupported component kinds for kubernetes", () => {
  const { errors } = extractKubernetesDeployments([
    serviceComponent("//test-workspace/apps/api:image"),
    ...policyNodes(),
    deploymentNode({ component_kind: "static-webapp" }),
  ]);
  assert.ok(
    errors.some((entry) => entry.includes('does not support component_kind "static-webapp"')),
  );
});

test("validation rejects protected multi-component kubernetes deployments without rollout_policy", () => {
  const { errors } = extractKubernetesDeployments([
    serviceComponent("//test-workspace/apps/api:image"),
    serviceComponent("//test-workspace/observability/otel-sidecar:image"),
    ...policyNodes(),
    deploymentNode({
      components: [
        { id: "api", kind: "service", target: "//test-workspace/apps/api:image" },
        {
          id: "otel-sidecar",
          kind: "third-party-service",
          target: "//test-workspace/observability/otel-sidecar:image",
        },
      ],
      protection_class: "production_facing",
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("must set rollout_policy")));
});

test("validation rejects rollout steps that omit a kubernetes component", () => {
  const { errors } = extractKubernetesDeployments([
    serviceComponent("//test-workspace/apps/api:image"),
    serviceComponent("//test-workspace/observability/otel-sidecar:image"),
    ...policyNodes(),
    deploymentNode({
      components: [
        { id: "api", kind: "service", target: "//test-workspace/apps/api:image" },
        {
          id: "otel-sidecar",
          kind: "third-party-service",
          target: "//test-workspace/observability/otel-sidecar:image",
        },
      ],
      rollout_policy: {
        mode: "ordered_best_effort",
        abort: "stop_on_first_failure",
        smoke: "final_only",
      },
      rollout_steps: ["api"],
    }),
  ]);
  assert.ok(
    errors.some((entry) => entry.includes("steps must list every component id exactly once")),
  );
});
