#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import { deriveMiniProviderTarget, extractMiniDeployments } from "../../deployments/contract.ts";

function staticWebappComponent(label: string): GraphNode {
  return {
    name: label,
    labels: ["kind:app", "webapp:static"],
  };
}

test("deriveMiniProviderTarget normalizes hostname, container name, and shared identity", () => {
  const target = deriveMiniProviderTarget({ appName: "pleomino" });
  assert.deepEqual(target, {
    host: "mini",
    appName: "pleomino",
    targetGroup: "default",
    hostname: "pleomino.apps.kilty.io",
    containerName: "pleomino",
    sharedDevTargetIdentity: "mini-dev-container:default:pleomino",
  });
});

test("extractMiniDeployments defaults protection_class to shared_nonprod", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/pleomino:app"),
    {
      name: "//projects/deployments/pleomino-dev:deploy",
      provider: "mini-dev-container",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "mini-dev-container-static-webapp",
      provisioner: "mini-dev-container-host-manifest",
      protection_class: "",
      app_name: "pleomino",
      container_port: 3000,
      health_path: "/healthz",
      target_group: "",
    },
  ];

  const { deployments, errors } = extractMiniDeployments(nodes);
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0]?.protectionClass, "shared_nonprod");
  assert.equal(deployments[0]?.providerTarget.hostname, "pleomino.apps.kilty.io");
});
