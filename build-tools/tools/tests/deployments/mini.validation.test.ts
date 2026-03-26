#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import { extractMiniDeployments } from "../../deployments/contract.ts";

function staticWebappComponent(label: string): GraphNode {
  return {
    name: label,
    labels: ["kind:app", "webapp:pwa"],
  };
}

function deploymentNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/pleomino-dev:deploy",
    provider: "mini-dev-container",
    component: "//projects/apps/pleomino:app",
    component_kind: "static-webapp",
    publisher: "mini-dev-container-static-webapp",
    provisioner: "mini-dev-container-host-manifest",
    protection_class: "shared_nonprod",
    app_name: "pleomino",
    container_port: 3000,
    health_path: "/healthz",
    target_group: "",
    ...overrides,
  };
}

test("validation rejects duplicate app_name collisions", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/pleomino:app"),
    staticWebappComponent("//projects/apps/other:app"),
    deploymentNode(),
    deploymentNode({
      name: "//projects/deployments/other-dev:deploy",
      component: "//projects/apps/other:app",
    }),
  ];
  const { errors } = extractMiniDeployments(nodes);
  assert.ok(errors.some((entry) => entry.includes('duplicate app_name "pleomino"')));
});

test("validation rejects missing container_port", () => {
  const { errors } = extractMiniDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    deploymentNode({ container_port: 0 }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("container_port must be an integer")));
});

test("validation rejects invalid target_group", () => {
  const { errors } = extractMiniDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    deploymentNode({ target_group: "group.a" }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("target_group must be lowercase")));
});

test("validation rejects unsupported component kinds for mini-dev-container", () => {
  const { errors } = extractMiniDeployments([
    staticWebappComponent("//projects/apps/pleomino:app"),
    deploymentNode({ component_kind: "http-service" }),
  ]);
  assert.ok(
    errors.some((entry) => entry.includes("unsupported mini-dev-container component_kind")),
  );
});
