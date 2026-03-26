#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import {
  deriveNixosSharedHostProviderTarget,
  extractNixosSharedHostDeployments,
} from "../../deployments/contract.ts";

function staticWebappComponent(label: string): GraphNode {
  return {
    name: label,
    labels: ["kind:app", "webapp:static"],
  };
}

test("deriveNixosSharedHostProviderTarget normalizes hostname, container name, and shared identity", () => {
  const target = deriveNixosSharedHostProviderTarget({ appName: "pleomino" });
  assert.deepEqual(target, {
    host: "nixos-shared-host",
    appName: "pleomino",
    targetGroup: "default",
    hostname: "pleomino.apps.kilty.io",
    containerName: "pleomino",
    sharedDevTargetIdentity: "nixos-shared-host:default:pleomino",
  });
});

test("extractNixosSharedHostDeployments defaults protection_class to shared_nonprod", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/pleomino:app"),
    {
      name: "//projects/deployments/pleomino-dev:deploy",
      provider: "nixos-shared-host",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "nixos-shared-host-static-webapp",
      provisioner: "nixos-shared-host-manifest",
      protection_class: "",
      app_name: "pleomino",
      container_port: 3000,
      health_path: "/healthz",
      target_group: "",
    },
  ];

  const { deployments, errors } = extractNixosSharedHostDeployments(nodes);
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0]?.protectionClass, "shared_nonprod");
  assert.equal(deployments[0]?.providerTarget.hostname, "pleomino.apps.kilty.io");
});
