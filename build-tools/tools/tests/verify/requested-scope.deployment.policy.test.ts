#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRequestedVerifyScope } from "../../dev/verify/requested-scope";
import { summarizeVerifyScopeDecision } from "../../dev/verify/selection-output";

const defaultArgs = {
  coverage: false,
  console: "auto" as const,
  targets: ["//..."],
  selector: "default" as const,
  requestedProjects: [],
  explainSelection: false,
};

function baseDecision(overrides: Record<string, unknown> = {}) {
  return {
    requestedMode: "auto" as const,
    selectorMode: "no-template-impact" as const,
    targets: ["//..."],
    diagnostics: null,
    lintFilters: null,
    reason: "fallback-build-system-scope",
    ...overrides,
  };
}

test("deployment-only changes select deployment suite plus safety floor", async () => {
  const result = await resolveRequestedVerifyScope({
    root: process.cwd(),
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: {},
    deps: {
      resolveTemplateScope: async () => baseDecision(),
      collectChangedPaths: async () => ["build-tools/deployments/defs.bzl"],
      listDeploymentTargets: async () => ["//projects/deployments/pleomino/dev:deploy"],
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

test("deployment project changes select deployment and project-impact union", async () => {
  const result = await resolveRequestedVerifyScope({
    root: process.cwd(),
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: {},
    deps: {
      resolveTemplateScope: async () =>
        baseDecision({
          selectorMode: "project-impact",
          targets: ["//projects/apps/pleomino/..."],
          reason: "project-impact-targeted",
        }),
      collectChangedPaths: async () => [
        "projects/apps/pleomino/src/index.ts",
        "projects/deployments/pleomino/dev/TARGETS",
      ],
      listDeploymentTargets: async () => ["//projects/deployments/pleomino/dev:deploy"],
      queryDeploymentDomainTargets: async () => ["//:deployment_domain_labels_cquery"],
      resolveProjectImpactSelection: async () => ({
        mode: "project-impact",
        targets: ["//projects/deployments/pleomino/dev/..."],
        diagnostics: {
          mode: "project-impact",
          changedPaths: [
            "projects/apps/pleomino/src/index.ts",
            "projects/deployments/pleomino/dev/TARGETS",
          ],
          changedProjects: ["projects/deployments/pleomino/dev"],
          dependentProjects: [],
          selectedTargets: ["//projects/deployments/pleomino/dev/..."],
          reason: "project-impact-selection",
        },
      }),
      deploymentSafetyFloorTargets: ["//:deployment_verify_scope_boundary"],
    },
  });

  assert.equal(result.selection.selectorMode, "deployment-and-project-impact");
  assert.equal(result.selection.reason, "deployment-and-project-impact-targeted");
  assert.deepEqual(result.selection.targets, [
    "//:deployment_domain_labels_cquery",
    "//:deployment_verify_scope_boundary",
    "//projects/apps/pleomino/...",
    "//projects/deployments/pleomino/dev/...",
  ]);
});

test("mixed build-system deployment impact keeps the existing selection", async () => {
  const result = await resolveRequestedVerifyScope({
    root: process.cwd(),
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: {},
    deps: {
      resolveTemplateScope: async () => baseDecision(),
      collectChangedPaths: async () => ["build-tools/tools/dev/verify/run-verify.ts"],
      listDeploymentTargets: async () => ["//projects/deployments/pleomino/dev:deploy"],
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
    root: process.cwd(),
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: {},
    deps: {
      resolveTemplateScope: async () =>
        baseDecision({
          targets: ["//docs/..."],
          reason: "non-build-system-scope",
        }),
      collectChangedPaths: async () => [
        "docs/nixos-shared-host-setup.md",
        "build-tools/tools/deployments/control-plane-host-profile/saas-oci-profile.md",
      ],
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
    root: process.cwd(),
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env: { VBR_DEPLOYMENT_TEST_SCOPE: "never" },
    deps: {
      resolveTemplateScope: async () => baseDecision(),
      collectChangedPaths: async () => {
        throw new Error("deployment classifier should not run when selector is disabled");
      },
    },
  });

  assert.equal(result.selection.requestedDeploymentMode, "never");
  assert.equal(result.selection.selectorMode, "no-template-impact");
});

test("always mode fails unless the change is safely deployment-only", async () => {
  await assert.rejects(
    async () =>
      resolveRequestedVerifyScope({
        root: process.cwd(),
        invocationCwd: process.cwd(),
        args: defaultArgs,
        env: { VBR_DEPLOYMENT_TEST_SCOPE: "always" },
        deps: {
          resolveTemplateScope: async () => baseDecision(),
          collectChangedPaths: async () => ["projects/deployments/pleomino/dev/TARGETS"],
          listDeploymentTargets: async () => ["//projects/deployments/pleomino/dev:deploy"],
        },
      }),
    /VBR_DEPLOYMENT_TEST_SCOPE=always requires deployment-only changes/,
  );
});

test("deployment selection fails fast when the deployment query resolves zero targets", async () => {
  await assert.rejects(
    async () =>
      resolveRequestedVerifyScope({
        root: process.cwd(),
        invocationCwd: process.cwd(),
        args: defaultArgs,
        env: {},
        deps: {
          resolveTemplateScope: async () => baseDecision(),
          collectChangedPaths: async () => ["build-tools/deployments/defs.bzl"],
          listDeploymentTargets: async () => ["//projects/deployments/pleomino/dev:deploy"],
          queryDeploymentDomainTargets: async () => [],
        },
      }),
    /zero resolved deployment-domain test targets/,
  );
});

test("deployment selection fails fast when the safety floor is empty", async () => {
  await assert.rejects(
    async () =>
      resolveRequestedVerifyScope({
        root: process.cwd(),
        invocationCwd: process.cwd(),
        args: defaultArgs,
        env: {},
        deps: {
          resolveTemplateScope: async () => baseDecision(),
          collectChangedPaths: async () => ["build-tools/deployments/defs.bzl"],
          listDeploymentTargets: async () => ["//projects/deployments/pleomino/dev:deploy"],
          queryDeploymentDomainTargets: async () => ["//:deployment_domain_labels_cquery"],
          deploymentSafetyFloorTargets: [],
        },
      }),
    /zero deployment safety-floor targets/,
  );
});
