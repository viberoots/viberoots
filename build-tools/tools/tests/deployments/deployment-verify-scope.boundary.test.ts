#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  classifyReviewedBuildSystemVerifyPath,
  isReviewedDeploymentOwnedBuildSystemPath,
  isReviewedDeploymentOwnedTestPath,
  isReviewedSharedBuildSystemPath,
  REVIEWED_DEPLOYMENT_OWNED_SUPPORT_PATHS,
} from "../../lib/deployment-verify-scope";

test("deployment verify scope marks reviewed deployment-owned paths explicitly", () => {
  const deploymentOwned = [
    "build-tools/deployments/defs.bzl",
    "build-tools/tools/deployments/deploy.ts",
    "build-tools/tools/tests/deployments/deployment_domain_taxonomy.bzl",
    "build-tools/tools/tests/deployments/deployment_resource_limited_taxonomy.bzl",
    "build-tools/tools/tests/deployments/nixos-shared-host.contract.test.ts",
    ...REVIEWED_DEPLOYMENT_OWNED_SUPPORT_PATHS,
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
    "build-tools/tools/nix/node-modules/store.nix",
    "build-tools/tools/tests/scaffolding/template-taxonomy.contract.test.ts",
    "docs/history/plans/deployment-plan.md",
    "projects/apps/pleomino/TARGETS",
    "projects/deployments/pleomino/dev/TARGETS",
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

test("deployment verify scope docs enumerate the reviewed support paths exactly", async () => {
  const doc = await fsp.readFile(
    path.join(process.cwd(), "docs/history/migrations/deployment-verify-scope.md"),
    "utf8",
  );
  for (const relPath of REVIEWED_DEPLOYMENT_OWNED_SUPPORT_PATHS) {
    assert.match(doc, new RegExp(relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(doc, /build-tools\/tools\/nix\/\*\*/);
});
