#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyReviewedBuildSystemVerifyPath,
  isReviewedDeploymentOwnedBuildSystemPath,
  isReviewedDeploymentOwnedTestPath,
  isReviewedSharedBuildSystemPath,
} from "../../lib/deployment-verify-scope.ts";

test("deployment verify scope marks reviewed deployment-owned paths explicitly", () => {
  const deploymentOwned = [
    "build-tools/deployments/defs.bzl",
    "build-tools/tools/deployments/deploy.ts",
    "build-tools/tools/tests/deployments/deployment_domain_taxonomy.bzl",
    "build-tools/tools/tests/deployments/nixos-shared-host.contract.test.ts",
  ];
  for (const relPath of deploymentOwned) {
    assert.equal(isReviewedDeploymentOwnedBuildSystemPath(relPath), true, relPath);
    assert.equal(classifyReviewedBuildSystemVerifyPath(relPath), "deployment-owned", relPath);
  }
  assert.equal(
    isReviewedDeploymentOwnedTestPath(
      "build-tools/tools/tests/deployments/nixos-shared-host.validation.test.ts",
    ),
    true,
  );
});

test("deployment verify scope keeps reviewed shared paths out of the deployment domain", () => {
  const sharedPaths = [
    "build-tools/tools/buck/zx_test.bzl",
    "build-tools/tools/tests/deployment_conventions.bzl",
    "build-tools/tools/tests/defs.bzl",
    "build-tools/tools/dev/verify/run-verify.ts",
    "build-tools/tools/lib/build-system-test-scope.ts",
    "build-tools/lang/defs_common.bzl",
    "toolchains/TARGETS",
    "third_party/providers/TARGETS",
    "TARGETS",
    "flake.nix",
    "flake.lock",
  ];
  for (const relPath of sharedPaths) {
    assert.equal(isReviewedSharedBuildSystemPath(relPath), true, relPath);
    assert.equal(isReviewedDeploymentOwnedBuildSystemPath(relPath), false, relPath);
    assert.equal(classifyReviewedBuildSystemVerifyPath(relPath), "shared", relPath);
  }
});

test("deployment verify scope leaves unrelated paths unclassified", () => {
  const unrelatedPaths = [
    "docs/deployment-plan.md",
    "test-workspace/apps/pleomino/TARGETS",
    "test-workspace/deployments/pleomino-dev/TARGETS",
  ];
  for (const relPath of unrelatedPaths) {
    assert.equal(isReviewedDeploymentOwnedBuildSystemPath(relPath), false, relPath);
    assert.equal(isReviewedSharedBuildSystemPath(relPath), false, relPath);
    assert.equal(classifyReviewedBuildSystemVerifyPath(relPath), "unclassified", relPath);
  }
  assert.equal(
    isReviewedDeploymentOwnedTestPath(
      "build-tools/tools/tests/dev/coverage-policy-doc-check.test.ts",
    ),
    false,
  );
});
