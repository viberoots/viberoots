#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import { extractNixosSharedHostDeployments } from "../../deployments/contract.ts";
import {
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture.ts";

function staticWebappComponent(label: string): GraphNode {
  return {
    name: label,
    labels: ["kind:app", "webapp:pwa"],
  };
}

function deploymentNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/demoapp-dev:deploy",
    provider: "nixos-shared-host",
    component: "//projects/apps/demoapp:app",
    component_kind: "static-webapp",
    publisher: "nixos-shared-host-static-webapp",
    provisioner: "nixos-shared-host-manifest",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "dev",
    admission_policy: "//projects/deployments/pleomino-shared:dev_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    app_name: "demoapp",
    container_port: 3000,
    health_path: "/healthz",
    target_group: "",
    ...overrides,
  };
}

function policyNodes(): GraphNode[] {
  return [nixosSharedHostLanePolicyNodeFixture(), nixosSharedHostAdmissionPolicyNodeFixture()];
}

test("validation rejects duplicate app_name collisions", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/demoapp:app"),
    staticWebappComponent("//projects/apps/other:app"),
    ...policyNodes(),
    deploymentNode(),
    deploymentNode({
      name: "//projects/deployments/other-dev:deploy",
      component: "//projects/apps/other:app",
    }),
  ];
  const { errors } = extractNixosSharedHostDeployments(nodes);
  assert.ok(errors.some((entry) => entry.includes('duplicate app_name "demoapp"')));
});

test("validation rejects missing container_port", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    ...policyNodes(),
    deploymentNode({ container_port: 0 }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("container_port must be an integer")));
});

test("validation rejects invalid target_group", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    ...policyNodes(),
    deploymentNode({ target_group: "group.a" }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("target_group must be lowercase")));
});

test("validation rejects unsupported component kinds for nixos-shared-host", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    ...policyNodes(),
    deploymentNode({ component_kind: "http-service" }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("unsupported nixos-shared-host component_kind")));
});

test("validation rejects protected multi-component shared-host deployments without rollout_policy", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    staticWebappComponent("//projects/apps/demoapi:app"),
    ...policyNodes(),
    deploymentNode({
      components: [
        {
          id: "frontend",
          kind: "static-webapp",
          target: "//projects/apps/demoapp:app",
          app_name: "demoapp",
          container_port: "3000",
        },
        {
          id: "api",
          kind: "static-webapp",
          target: "//projects/apps/demoapi:app",
          app_name: "demoapi",
          container_port: "3001",
        },
      ],
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("must set rollout_policy")));
});

test("validation rejects multi-component shared-host rollout steps that omit a component", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    staticWebappComponent("//projects/apps/demoapi:app"),
    ...policyNodes(),
    deploymentNode({
      components: [
        {
          id: "frontend",
          kind: "static-webapp",
          target: "//projects/apps/demoapp:app",
          app_name: "demoapp",
          container_port: "3000",
        },
        {
          id: "api",
          kind: "static-webapp",
          target: "//projects/apps/demoapi:app",
          app_name: "demoapi",
          container_port: "3001",
        },
      ],
      rollout_policy: {
        mode: "ordered_best_effort",
        abort: "stop_on_first_failure",
        smoke: "final_only",
      },
      rollout_steps: ["frontend"],
    }),
  ]);
  assert.ok(
    errors.some((entry) => entry.includes("steps must list every component id exactly once")),
  );
});

test("validation rejects malformed bootstrap policy", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    ...policyNodes(),
    deploymentNode({
      bootstrap: {
        scope: "ordinary_deploy",
      },
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("unsupported bootstrap.scope")));
  assert.ok(
    errors.some((entry) =>
      entry.includes("bootstrap policy must enable allow_first_install or allow_offline_recovery"),
    ),
  );
});
