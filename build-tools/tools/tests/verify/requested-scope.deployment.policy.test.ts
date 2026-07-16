#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeVerifyScopeDecision } from "../../dev/verify/selection-output";
import { resolveRequestedVerifyScope } from "../../dev/verify/requested-scope";
import {
  assertEmptySafetyFloorRejected,
  baseDecision,
  changedPaths,
  defaultArgs,
  rootWithoutChangeAuthority,
} from "./requested-scope.deployment.fixture";

test("deployment-only changes select deployment suite plus safety floor", async () => {
  const result = await resolveRequestedVerifyScope({
    root: rootWithoutChangeAuthority,
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: {},
    deps: {
      resolveTemplateScope: async () => baseDecision(),
      collectChangedPaths: async () => changedPaths("build-tools/deployments/defs.bzl"),
      listDeploymentTargets: async () => ["//projects/deployments/sample/dev:deploy"],
      queryDeploymentDomainTargets: async () => [
        "//:deployment_domain_labels_cquery",
        "//:nixos_shared_host_contract",
      ],
      deploymentSafetyFloorTargets: [
        "//:deployment_domain_labels_cquery",
        "//:deployment_verify_scope_boundary",
      ],
    },
  });

  assert.equal(result.selection.selectorMode, "deployment-only");
  assert.equal(result.selection.reason, "deployment-targeted");
  assert.deepEqual(result.selection.targets, [
    "//:deployment_domain_labels_cquery",
    "//:deployment_verify_scope_boundary",
    "//:nixos_shared_host_contract",
  ]);
});

test("viberoots-prefixed deployment-only changes override full build-system base scope", async () => {
  const result = await resolveRequestedVerifyScope({
    root: rootWithoutChangeAuthority,
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: {},
    deps: {
      resolveTemplateScope: async () =>
        baseDecision({
          targets: ["//...", "viberoots//..."],
          reason: "fallback-build-system-scope",
        }),
      collectChangedPaths: async () =>
        changedPaths(
          "viberoots/build-tools/deployments/defs.bzl",
          "viberoots/build-tools/tools/tests/deployments/deployment-domain.labels.cquery.test.ts",
        ),
      listDeploymentTargets: async () => ["//projects/deployments/sample/dev:deploy"],
      queryDeploymentDomainTargets: async () => [
        "viberoots//:deployment_domain_labels_cquery",
        "viberoots//:nixos_shared_host_contract",
      ],
      deploymentSafetyFloorTargets: [
        "viberoots//:deployment_domain_labels_cquery",
        "viberoots//:deployment_verify_scope_boundary",
      ],
    },
  });

  assert.equal(result.selection.selectorMode, "deployment-only");
  assert.equal(result.selection.reason, "deployment-targeted");
  assert.deepEqual(result.selection.targets, [
    "viberoots//:deployment_domain_labels_cquery",
    "viberoots//:deployment_verify_scope_boundary",
    "viberoots//:nixos_shared_host_contract",
  ]);
});

test("deployment project changes select project-impact targets without framework suite", async () => {
  const result = await resolveRequestedVerifyScope({
    root: rootWithoutChangeAuthority,
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: {},
    deps: {
      resolveTemplateScope: async () =>
        baseDecision({
          selectorMode: "project-impact",
          targets: ["//projects/apps/sample-app/..."],
          reason: "project-impact-targeted",
        }),
      collectChangedPaths: async () =>
        changedPaths(
          "projects/apps/sample-app/src/index.ts",
          "projects/deployments/sample/dev/TARGETS",
        ),
      listDeploymentTargets: async () => ["//projects/deployments/sample/dev:deploy"],
      queryDeploymentDomainTargets: async () => {
        throw new Error("deployment framework suite should not run for project deployment edits");
      },
      resolveProjectImpactSelection: async () => ({
        mode: "project-impact",
        targets: ["//projects/deployments/sample/dev/..."],
        diagnostics: {
          mode: "project-impact",
          changedPaths: [
            "projects/apps/sample-app/src/index.ts",
            "projects/deployments/sample/dev/TARGETS",
          ],
          changedProjects: ["projects/deployments/sample/dev"],
          dependentProjects: [],
          selectedTargets: ["//projects/deployments/sample/dev/..."],
          reason: "project-impact-selection",
        },
      }),
      deploymentSafetyFloorTargets: ["viberoots//:deployments_framework_safety_floor"],
    },
  });

  assert.equal(result.selection.selectorMode, "deployment-and-project-impact");
  assert.equal(result.selection.reason, "deployment-and-project-impact-targeted");
  assert.deepEqual(result.selection.targets, [
    "//projects/apps/sample-app/...",
    "//projects/deployments/sample/dev/...",
    "workspace_buck//...",
  ]);
  assert.ok(result.selection.diagnostics);
  assert.equal("deploymentDomainTargets" in result.selection.diagnostics, true);
  if ("deploymentDomainTargets" in result.selection.diagnostics) {
    assert.deepEqual(result.selection.diagnostics.deploymentDomainTargets, []);
    assert.deepEqual(result.selection.diagnostics.deploymentSafetyFloorTargets, []);
  }
});

test("mixed build-system deployment impact keeps the existing selection", async () => {
  const result = await resolveRequestedVerifyScope({
    root: rootWithoutChangeAuthority,
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: {},
    deps: {
      resolveTemplateScope: async () => baseDecision(),
      collectChangedPaths: async () =>
        changedPaths("viberoots/build-tools/tools/dev/verify/run-verify.ts"),
      listDeploymentTargets: async () => ["//projects/deployments/sample/dev:deploy"],
      queryDeploymentDomainTargets: async () => {
        throw new Error("deployment query should not run in mixed-build-system mode");
      },
    },
  });

  assert.equal(result.selection.selectorMode, "no-template-impact");
  assert.equal(result.selection.reason, "fallback-build-system-scope");
  assert.deepEqual(result.selection.targets, ["//..."]);
});

test("reviewed deployment documentation changes select only documentation contract targets", async () => {
  const result = await resolveRequestedVerifyScope({
    root: rootWithoutChangeAuthority,
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: {},
    deps: {
      resolveTemplateScope: async () =>
        baseDecision({
          targets: ["//docs/..."],
          reason: "non-build-system-scope",
        }),
      collectChangedPaths: async () =>
        changedPaths(
          "docs/nixos-shared-host-setup.md",
          "build-tools/tools/deployments/control-plane-host-profile/saas-oci-profile.md",
        ),
      listDeploymentTargets: async () => {
        throw new Error("deployment domain query should not run for docs-only changes");
      },
      deploymentDocContractTargets: ["//:deployment_docs_front_door_parity"],
    },
  });

  assert.equal(result.selection.selectorMode, "documentation-contract");
  assert.equal(result.selection.reason, "documentation-contract-targeted");
  assert.deepEqual(result.selection.targets, ["//:deployment_docs_front_door_parity"]);
  assert.match(summarizeVerifyScopeDecision(result.selection), /documentationPaths=2/);
});

test("never mode bypasses deployment selection", async () => {
  const result = await resolveRequestedVerifyScope({
    root: rootWithoutChangeAuthority,
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: { VBR_DEPLOYMENT_TEST_SCOPE: "never" },
    deps: {
      resolveTemplateScope: async () => baseDecision(),
      collectChangedPaths: async () => changedPaths(),
    },
  });

  assert.equal(result.selection.requestedDeploymentMode, "never");
  assert.equal(result.selection.selectorMode, "no-template-impact");
});

test("always mode fails unless the change is safely deployment-only", async () => {
  await assert.rejects(
    async () =>
      resolveRequestedVerifyScope({
        root: rootWithoutChangeAuthority,
        invocationCwd: process.cwd(),
        args: defaultArgs,
        env: { VBR_DEPLOYMENT_TEST_SCOPE: "always" },
        deps: {
          resolveTemplateScope: async () => baseDecision(),
          collectChangedPaths: async () => changedPaths("projects/deployments/sample/dev/TARGETS"),
          listDeploymentTargets: async () => ["//projects/deployments/sample/dev:deploy"],
        },
      }),
    /VBR_DEPLOYMENT_TEST_SCOPE=always requires deployment-only changes/,
  );
});

test("deployment selection fails fast when the deployment query resolves zero targets", async () => {
  await assert.rejects(
    async () =>
      resolveRequestedVerifyScope({
        root: rootWithoutChangeAuthority,
        invocationCwd: process.cwd(),
        args: defaultArgs,
        env: {},
        deps: {
          resolveTemplateScope: async () => baseDecision(),
          collectChangedPaths: async () => changedPaths("build-tools/deployments/defs.bzl"),
          listDeploymentTargets: async () => ["//projects/deployments/sample/dev:deploy"],
          queryDeploymentDomainTargets: async () => [],
        },
      }),
    /zero resolved deployment-domain test targets/,
  );
});

test("deployment selection fails fast when the safety floor is empty", async () => {
  await assertEmptySafetyFloorRejected();
});
