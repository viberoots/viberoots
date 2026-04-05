#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import {
  deriveNixosSharedHostProviderTarget,
  extractNixosSharedHostDeployments,
} from "../../deployments/contract.ts";
import {
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture.ts";

function staticWebappComponent(label: string): GraphNode {
  return {
    name: label,
    labels: ["kind:app", "webapp:static"],
  };
}

test("deriveNixosSharedHostProviderTarget normalizes hostname, container name, and shared identity", () => {
  const target = deriveNixosSharedHostProviderTarget({ appName: "demoapp" });
  assert.deepEqual(target, {
    host: "nixos-shared-host",
    appName: "demoapp",
    appNames: ["demoapp"],
    targetGroup: "default",
    deploymentTargetIdentity: "nixos-shared-host:default:demoapp",
    hostname: "demoapp.apps.kilty.io",
    containerName: "demoapp",
    sharedDevTargetIdentity: "nixos-shared-host:default:demoapp",
  });
});

test("extractNixosSharedHostDeployments defaults protection_class to shared_nonprod", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/demoapp:app"),
    nixosSharedHostLanePolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture(),
    {
      name: "//projects/deployments/demoapp-dev:deploy",
      provider: "nixos-shared-host",
      component: "//projects/apps/demoapp:app",
      component_kind: "static-webapp",
      publisher: "nixos-shared-host-static-webapp",
      provisioner: "nixos-shared-host-manifest",
      protection_class: "",
      lane_policy: "//build-tools/deployments/lanes:pleomino",
      environment_stage: "dev",
      admission_policy: "//build-tools/deployments/policies:pleomino_dev_release",
      app_name: "demoapp",
      container_port: 3000,
      health_path: "/healthz",
      target_group: "",
    },
  ];

  const { deployments, errors } = extractNixosSharedHostDeployments(nodes);
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0]?.protectionClass, "shared_nonprod");
  assert.equal(deployments[0]?.lanePolicyRef, "//build-tools/deployments/lanes:pleomino");
  assert.equal(deployments[0]?.environmentStage, "dev");
  assert.equal(deployments[0]?.providerTarget.hostname, "demoapp.apps.kilty.io");
  assert.deepEqual(deployments[0]?.prerequisites, []);
});

test("extractNixosSharedHostDeployments preserves valid prerequisite metadata", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/demoapp:app"),
    nixosSharedHostLanePolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture({
      name: "//build-tools/deployments/policies:pleomino_staging_release",
      allowed_refs: ["env/pleomino/staging"],
      required_checks: ["deploy/pleomino-staging"],
      artifact_attestation_mode: "recorded_exact_artifact",
    }),
    {
      name: "//projects/deployments/demoapp-dev:deploy",
      provider: "nixos-shared-host",
      component: "//projects/apps/demoapp:app",
      component_kind: "static-webapp",
      publisher: "nixos-shared-host-static-webapp",
      provisioner: "nixos-shared-host-manifest",
      protection_class: "",
      lane_policy: "//build-tools/deployments/lanes:pleomino",
      environment_stage: "dev",
      admission_policy: "//build-tools/deployments/policies:pleomino_dev_release",
      app_name: "demoapp",
      container_port: 3000,
    },
    {
      name: "//projects/deployments/demoapp-staging:deploy",
      provider: "nixos-shared-host",
      component: "//projects/apps/demoapp:app",
      component_kind: "static-webapp",
      publisher: "nixos-shared-host-static-webapp",
      provisioner: "nixos-shared-host-manifest",
      protection_class: "",
      lane_policy: "//build-tools/deployments/lanes:pleomino",
      environment_stage: "staging",
      admission_policy: "//build-tools/deployments/policies:pleomino_staging_release",
      app_name: "demoapp-staging",
      container_port: 3001,
      prerequisites: [{ deployment_id: "demoapp-dev", mode: "ordering_only" }],
    },
  ];

  const { deployments, errors } = extractNixosSharedHostDeployments(nodes);
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, 2);
  assert.deepEqual(deployments[1]?.prerequisites, [
    { deploymentId: "demoapp-dev", mode: "ordering_only" },
  ]);
});
