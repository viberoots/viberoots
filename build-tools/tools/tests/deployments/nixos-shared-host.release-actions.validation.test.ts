#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph.ts";
import { extractNixosSharedHostDeployments } from "../../deployments/contract.ts";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture.ts";
import {
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture.ts";
import {
  deploymentReleaseActionNodeFixture,
  deploymentRequirementFixture,
} from "./deployment-metadata.fixture.ts";

function staticWebappComponent(label: string): GraphNode {
  return { name: label, labels: ["kind:app", "webapp:pwa"] };
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
    release_actions: ["//projects/deployments/demoapp-shared:db_migration"],
    app_name: "demoapp",
    container_port: 3000,
    ...overrides,
  };
}

function baseNodes(overrides: Partial<GraphNode> = {}): GraphNode[] {
  return [
    staticWebappComponent("//projects/apps/demoapp:app"),
    nixosSharedHostLaneGovernanceNodeFixture(),
    nixosSharedHostLanePolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture(),
    deploymentReleaseActionNodeFixture(),
    deploymentNode(overrides),
  ];
}

test("validation rejects release-action secret use without a declared secret requirement", () => {
  const { errors } = extractNixosSharedHostDeployments(baseNodes());
  assert.ok(
    errors.some((entry) => entry.includes('requires undeclared secret requirement "database_url"')),
  );
});

test("validation rejects release-action runtime config use without a declared runtime config requirement", () => {
  const { errors } = extractNixosSharedHostDeployments(
    baseNodes({
      secret_requirements: [
        {
          name: "database_url",
          step: "release_actions.pre_publish",
          contract_id: "secret://deployments/demoapp/database_url",
          required: "true",
        },
      ],
    }),
  );
  assert.ok(
    errors.some((entry) =>
      entry.includes('requires undeclared runtime_config requirement "schema_version"'),
    ),
  );
});

test("validation accepts supported release actions when required contracts are declared", () => {
  const requirements = [
    deploymentRequirementFixture({
      name: "database_url",
      contractId: "secret://deployments/demoapp/database_url",
    }),
    deploymentRequirementFixture({
      name: "schema_version",
      contractId: "config://deployments/demoapp/schema_version",
    }),
  ];
  const toGraph = (requirement: (typeof requirements)[number]) => ({
    name: requirement.name,
    step: requirement.step,
    contract_id: requirement.contractId,
    required: String(requirement.required),
  });
  const { errors, deployments } = extractNixosSharedHostDeployments(
    baseNodes({
      secret_requirements: [toGraph(requirements[0])],
      runtime_config_requirements: [toGraph(requirements[1])],
    }),
  );
  assert.deepEqual(errors, []);
  assert.equal(deployments[0]?.releaseActions[0]?.type, "schema_migration");
});
