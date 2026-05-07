#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isDeploymentProjectPath,
  resolveDeploymentImpactSelection,
} from "../../lib/deployment-impact-selector";

const deploymentTargetLabels = ["//projects/deployments/pleomino-dev:deploy"];

test("deployment-impact: reviewed deployment-owned build-system paths stay deployment-only", () => {
  const result = resolveDeploymentImpactSelection(
    [
      "build-tools/deployments/defs.bzl",
      "build-tools/tools/tests/deployments/nixos-shared-host.contract.test.ts",
    ],
    { deploymentTargetLabels },
  );

  assert.equal(result.mode, "deployment-only");
  assert.deepEqual(result.diagnostics.deploymentOwnedPaths, [
    "build-tools/deployments/defs.bzl",
    "build-tools/tools/tests/deployments/nixos-shared-host.contract.test.ts",
  ]);
  assert.deepEqual(result.diagnostics.fullBuildSystemTriggerPaths, []);
  assert.deepEqual(result.diagnostics.deploymentProjectPaths, []);
  assert.equal(result.diagnostics.reason, "deployment-owned-build-system-path-changed");
});

test("deployment-impact: deployment taxonomy-only edits stay deployment-only", () => {
  const result = resolveDeploymentImpactSelection(
    [
      "build-tools/tools/tests/deployments/deployment_domain_taxonomy.bzl",
      "build-tools/tools/tests/deployments/deployment_resource_limited_taxonomy.bzl",
    ],
    { deploymentTargetLabels },
  );

  assert.equal(result.mode, "deployment-only");
  assert.deepEqual(result.diagnostics.deploymentOwnedPaths, [
    "build-tools/tools/tests/deployments/deployment_domain_taxonomy.bzl",
    "build-tools/tools/tests/deployments/deployment_resource_limited_taxonomy.bzl",
  ]);
  assert.deepEqual(result.diagnostics.fullBuildSystemTriggerPaths, []);
  assert.equal(result.diagnostics.reason, "deployment-owned-build-system-path-changed");
});

test("deployment-impact: reviewed shared-host service modules stay deployment-only", () => {
  const result = resolveDeploymentImpactSelection(
    [
      "build-tools/tools/nix/shared-host-identity-provider-migration.nix",
      "build-tools/tools/nix/shared-host-postgres-module.nix",
      "build-tools/tools/nix/shared-host-vault-module.nix",
    ],
    { deploymentTargetLabels },
  );

  assert.equal(result.mode, "deployment-only");
  assert.deepEqual(result.diagnostics.deploymentOwnedPaths, [
    "build-tools/tools/nix/shared-host-identity-provider-migration.nix",
    "build-tools/tools/nix/shared-host-postgres-module.nix",
    "build-tools/tools/nix/shared-host-vault-module.nix",
  ]);
  assert.deepEqual(result.diagnostics.fullBuildSystemTriggerPaths, []);
  assert.equal(result.diagnostics.reason, "deployment-owned-build-system-path-changed");
});

test("deployment-impact: shared helpers and reviewed loader/root paths broaden to mixed mode", () => {
  const result = resolveDeploymentImpactSelection(
    [
      "build-tools/tools/tests/deployment_conventions.bzl",
      "build-tools/tools/tests/defs.bzl",
      "toolchains/TARGETS",
      "build-tools/tools/dev/verify/run-verify.ts",
      "third_party/providers/auto_map.bzl",
      "flake.nix",
    ],
    { deploymentTargetLabels },
  );

  assert.equal(result.mode, "mixed-build-system");
  assert.deepEqual(result.diagnostics.sharedBuildSystemPaths, [
    "build-tools/tools/dev/verify/run-verify.ts",
    "build-tools/tools/tests/defs.bzl",
    "build-tools/tools/tests/deployment_conventions.bzl",
    "flake.nix",
    "third_party/providers/auto_map.bzl",
    "toolchains/TARGETS",
  ]);
  assert.deepEqual(result.diagnostics.unknownBuildSystemPaths, []);
  assert.equal(result.diagnostics.reason, "shared-build-system-path-changed");
});

test("deployment-impact: unknown build-tools paths fail closed to mixed mode", () => {
  const result = resolveDeploymentImpactSelection(
    ["build-tools/tools/tests/verify/project-impact-selector.policy.test.ts"],
    { deploymentTargetLabels },
  );

  assert.equal(result.mode, "mixed-build-system");
  assert.deepEqual(result.diagnostics.sharedBuildSystemPaths, []);
  assert.deepEqual(result.diagnostics.unknownBuildSystemPaths, [
    "build-tools/tools/tests/verify/project-impact-selector.policy.test.ts",
  ]);
  assert.equal(result.diagnostics.reason, "unknown-build-system-path-changed");
});

test("deployment-impact: deployment project paths trigger deployment and project impact mode", () => {
  const result = resolveDeploymentImpactSelection(
    ["./projects/deployments/pleomino-dev/TARGETS", "build-tools/deployments/defs.bzl"],
    { deploymentTargetLabels },
  );

  assert.equal(
    isDeploymentProjectPath("projects/deployments/pleomino-dev/TARGETS", ["projects/deployments"]),
    true,
  );
  assert.equal(
    isDeploymentProjectPath("projects/apps/pleomino/TARGETS", ["projects/deployments"]),
    false,
  );
  assert.equal(result.mode, "deployment-and-project-impact");
  assert.deepEqual(result.diagnostics.deploymentOwnedPaths, ["build-tools/deployments/defs.bzl"]);
  assert.deepEqual(result.diagnostics.deploymentProjectPaths, [
    "projects/deployments/pleomino-dev/TARGETS",
  ]);
  assert.deepEqual(result.diagnostics.deploymentProjects, ["projects/deployments/pleomino-dev"]);
  assert.equal(result.diagnostics.reason, "deployment-project-path-changed");
});

test("deployment-impact: unrelated paths keep no-deployment-impact mode", () => {
  const result = resolveDeploymentImpactSelection(
    ["docs/deployment-plan.md", "projects/apps/pleomino/src/index.ts"],
    { deploymentTargetLabels },
  );

  assert.equal(result.mode, "no-deployment-impact");
  assert.deepEqual(result.diagnostics.deploymentOwnedPaths, []);
  assert.deepEqual(result.diagnostics.deploymentProjectPaths, []);
  assert.deepEqual(result.diagnostics.fullBuildSystemTriggerPaths, []);
  assert.equal(result.diagnostics.reason, "no-deployment-impact");
});

test("deployment-impact: diagnostics JSON stays normalized and stable", () => {
  const result = resolveDeploymentImpactSelection(
    [
      "projects\\deployments\\pleomino-dev\\TARGETS",
      "build-tools\\deployments\\defs.bzl",
      "build-tools\\deployments\\defs.bzl",
    ],
    { deploymentTargetLabels },
  );

  assert.equal(
    JSON.stringify(result, null, 2),
    [
      "{",
      '  "mode": "deployment-and-project-impact",',
      '  "diagnostics": {',
      '    "mode": "deployment-and-project-impact",',
      '    "changedPaths": [',
      '      "build-tools/deployments/defs.bzl",',
      '      "projects/deployments/pleomino-dev/TARGETS"',
      "    ],",
      '    "deploymentOwnedPaths": [',
      '      "build-tools/deployments/defs.bzl"',
      "    ],",
      '    "deploymentProjectPaths": [',
      '      "projects/deployments/pleomino-dev/TARGETS"',
      "    ],",
      '    "deploymentProjects": [',
      '      "projects/deployments/pleomino-dev"',
      "    ],",
      '    "sharedBuildSystemPaths": [],',
      '    "unknownBuildSystemPaths": [],',
      '    "fullBuildSystemTriggerPaths": [],',
      '    "reason": "deployment-project-path-changed"',
      "  }",
      "}",
    ].join("\n"),
  );
});
