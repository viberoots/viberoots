#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import { extractKubernetesDeployments } from "../../deployments/contract";
import {
  kubernetesAdmissionPolicyNodeFixture,
  kubernetesLanePolicyNodeFixture,
} from "./kubernetes.fixture";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture";

function serviceComponent(label: string): GraphNode {
  return { name: label, labels: ["kind:app"] };
}

function deploymentNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/api-prod:deploy",
    provider: "kubernetes",
    component: "//projects/apps/api:image",
    component_kind: "service",
    publisher: "helm-release",
    publisher_config: "helm/values.yaml",
    provisioner: "cdktf-stack",
    provisioner_config: "cdktf/stack.json",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "staging",
    admission_policy: "//projects/deployments/platform-shared:prod_release",
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
  return [
    kubernetesLanePolicyNodeFixture(),
    nixosSharedHostLaneGovernanceNodeFixture(),
    kubernetesAdmissionPolicyNodeFixture({
      allowed_refs: ["main"],
      required_checks: ["deploy/pleomino-staging"],
    }),
  ];
}

test("validation rejects unsupported kubernetes publisher and provisioner drift", () => {
  const { errors } = extractKubernetesDeployments([
    serviceComponent("//projects/apps/api:image"),
    ...policyNodes(),
    deploymentNode({ publisher: "other", provisioner: "custom" }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("unsupported kubernetes publisher")));
  assert.ok(errors.some((entry) => entry.includes("unsupported kubernetes provisioner")));
});

test("validation accepts private worker ingress and rejects target identity drift", () => {
  const valid = extractKubernetesDeployments([
    serviceComponent("//projects/apps/api:image"),
    ...policyNodes(),
    deploymentNode({
      provider_target: {
        cluster: "prod-us-west",
        namespace: "workers",
        release: "jobs",
        service_kind: "worker",
        ingress_mode: "none",
      },
    }),
  ]);
  assert.deepEqual(valid.errors, []);
  const invalid = extractKubernetesDeployments([
    serviceComponent("//projects/apps/api:image"),
    ...policyNodes(),
    deploymentNode({
      provider_target: {
        cluster: "prod-us-west",
        namespace: "workers",
        release: "jobs",
        id: "prod-us-west/web/api",
      },
    }),
  ]);
  assert.ok(invalid.errors.some((entry) => entry.includes("does not match canonical target")));
});

test("validation rejects unsupported component kinds for kubernetes", () => {
  const { errors } = extractKubernetesDeployments([
    serviceComponent("//projects/apps/api:image"),
    ...policyNodes(),
    deploymentNode({ component_kind: "static-webapp" }),
  ]);
  assert.ok(
    errors.some((entry) => entry.includes('does not support component_kind "static-webapp"')),
  );
});

test("validation rejects protected multi-component kubernetes deployments without rollout_policy", () => {
  const { errors } = extractKubernetesDeployments([
    serviceComponent("//projects/apps/api:image"),
    serviceComponent("//projects/observability/otel-sidecar:image"),
    ...policyNodes(),
    deploymentNode({
      components: [
        { id: "api", kind: "service", target: "//projects/apps/api:image" },
        {
          id: "otel-sidecar",
          kind: "third-party-service",
          target: "//projects/observability/otel-sidecar:image",
        },
      ],
      protection_class: "production_facing",
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("must set rollout_policy")));
});

test("validation rejects rollout steps that omit a kubernetes component", () => {
  const { errors } = extractKubernetesDeployments([
    serviceComponent("//projects/apps/api:image"),
    serviceComponent("//projects/observability/otel-sidecar:image"),
    ...policyNodes(),
    deploymentNode({
      components: [
        { id: "api", kind: "service", target: "//projects/apps/api:image" },
        {
          id: "otel-sidecar",
          kind: "third-party-service",
          target: "//projects/observability/otel-sidecar:image",
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
