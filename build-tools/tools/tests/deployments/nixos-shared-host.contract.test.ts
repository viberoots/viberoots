#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import {
  deriveNixosSharedHostProviderTarget,
  extractNixosSharedHostDeployments,
} from "../../deployments/contract";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture";
import {
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture";

function staticWebappComponent(label: string): GraphNode {
  return {
    name: label,
    labels: ["kind:app", "webapp:static"],
  };
}

const sourceAccessSecretRequirement = {
  name: "source_access_hmac_key",
  step: "publish",
  contract_id: "secret://deployments/source-access/hmac_key/dev",
  required: "true",
  source: "secret_runtime",
};

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

test("extractNixosSharedHostDeployments enforces declared external requirement profiles", () => {
  const baseNodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/demoapp:app"),
    nixosSharedHostLaneGovernanceNodeFixture(),
    nixosSharedHostLanePolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture(),
  ];
  const deployment = {
    name: "//projects/deployments/demoapp-dev:deploy",
    provider: "nixos-shared-host",
    component: "//projects/apps/demoapp:app",
    component_kind: "static-webapp",
    publisher: "nixos-shared-host-static-webapp",
    provisioner: "nixos-shared-host-manifest",
    protection_class: "",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "dev",
    admission_policy: "//projects/deployments/pleomino-shared:dev_release",
    runtime_config_requirements: [],
    app_name: "demoapp",
    container_port: 3000,
    external_requirement_profiles: ["source_access"],
  };

  const admitted = extractNixosSharedHostDeployments([
    ...baseNodes,
    {
      ...deployment,
      secret_requirements: [sourceAccessSecretRequirement],
    },
  ]);
  assert.deepEqual(admitted.errors, []);
  assert.deepEqual(admitted.deployments[0]?.externalRequirementProfiles, ["source_access"]);

  const rejected = extractNixosSharedHostDeployments([
    ...baseNodes,
    {
      ...deployment,
      secret_requirements: [
        {
          ...sourceAccessSecretRequirement,
          contract_id: "secret://unreviewed/source-access/hmac_key/dev",
        },
      ],
    },
  ]).errors;
  assert.ok(
    rejected.some((entry) =>
      entry.includes("source_access source_access_hmac_key has wrong contract scope"),
    ),
  );
});

test("extractNixosSharedHostDeployments defaults protection_class to shared_nonprod", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/demoapp:app"),
    nixosSharedHostLaneGovernanceNodeFixture(),
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
      lane_policy: "//projects/deployments/pleomino-shared:lane",
      environment_stage: "dev",
      admission_policy: "//projects/deployments/pleomino-shared:dev_release",
      secret_requirements: [],
      runtime_config_requirements: [],
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
  assert.equal(deployments[0]?.lanePolicyRef, "//projects/deployments/pleomino-shared:lane");
  assert.equal(deployments[0]?.environmentStage, "dev");
  assert.equal(deployments[0]?.providerTarget.hostname, "demoapp.apps.kilty.io");
  assert.deepEqual(deployments[0]?.prerequisites, []);
});

test("extractNixosSharedHostDeployments preserves valid prerequisite metadata", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/demoapp:app"),
    nixosSharedHostLaneGovernanceNodeFixture(),
    nixosSharedHostLanePolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture({
      name: "//projects/deployments/pleomino-shared:staging_release",
      allowed_refs: ["main"],
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
      lane_policy: "//projects/deployments/pleomino-shared:lane",
      environment_stage: "dev",
      admission_policy: "//projects/deployments/pleomino-shared:dev_release",
      secret_requirements: [],
      runtime_config_requirements: [],
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
      lane_policy: "//projects/deployments/pleomino-shared:lane",
      environment_stage: "staging",
      admission_policy: "//projects/deployments/pleomino-shared:staging_release",
      secret_requirements: [],
      runtime_config_requirements: [],
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

test("extractNixosSharedHostDeployments preserves bootstrap policy metadata", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/demoapp:app"),
    nixosSharedHostLaneGovernanceNodeFixture(),
    nixosSharedHostLanePolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture(),
    {
      name: "//projects/deployments/deploy-system-dev:deploy",
      provider: "nixos-shared-host",
      component: "//projects/apps/demoapp:app",
      component_kind: "static-webapp",
      publisher: "nixos-shared-host-static-webapp",
      provisioner: "nixos-shared-host-manifest",
      protection_class: "shared_nonprod",
      lane_policy: "//projects/deployments/pleomino-shared:lane",
      environment_stage: "dev",
      admission_policy: "//projects/deployments/pleomino-shared:dev_release",
      bootstrap: {
        scope: "deployment_authority",
        allow_first_install: "true",
        allow_offline_recovery: "true",
      },
      secret_requirements: [],
      runtime_config_requirements: [],
      app_name: "demoapp",
      container_port: 3000,
    },
  ];

  const { deployments, errors } = extractNixosSharedHostDeployments(nodes);
  assert.deepEqual(errors, []);
  assert.deepEqual(deployments[0]?.bootstrap, {
    scope: "deployment_authority",
    modes: ["first_install", "offline_recovery"],
  });
});
