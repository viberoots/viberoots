#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { isBuildSystemPath } from "../../lib/build-system-test-scope";
import {
  isDocumentationPath,
  resolveDocumentationImpactSelection,
} from "../../lib/documentation-impact-selector";
import { resolveDeploymentImpactSelection } from "../../lib/deployment-impact-selector";

const deploymentTargetLabels = ["//projects/deployments/sample/dev:deploy"];

test("documentation-impact: markdown is documentation, not a build-system trigger", () => {
  const result = resolveDeploymentImpactSelection(
    [
      "docs/nixos-shared-host-setup.md",
      "build-tools/tools/deployments/control-plane-host-profile/saas-oci-profile.md",
    ],
    { deploymentTargetLabels },
  );

  assert.equal(result.mode, "no-deployment-impact");
  assert.deepEqual(result.diagnostics.deploymentOwnedPaths, []);
  assert.equal(
    isBuildSystemPath(
      "build-tools/tools/deployments/control-plane-host-profile/saas-oci-profile.md",
    ),
    false,
  );
  assert.equal(isBuildSystemPath("build-tools/tools/deployments/deploy.ts"), true);
  assert.equal(
    isDocumentationPath("viberoots/build-tools/tools/scaffolding/scaf/ARCHITECTURE.md"),
    true,
  );
});

test("documentation-impact: reviewed deployment docs select documentation contract targets", () => {
  const result = resolveDocumentationImpactSelection(
    [
      "docs/nixos-shared-host-setup.md",
      "build-tools/tools/deployments/control-plane-host-profile/saas-oci-profile.md",
    ],
    { deploymentDocContractTargets: ["//:deployment_docs_front_door_parity"] },
  );

  assert.equal(result.mode, "documentation-contract");
  assert.deepEqual(result.targets, ["//:deployment_docs_front_door_parity"]);
  assert.equal(result.diagnostics.reason, "reviewed-deployment-documentation-changed");
});

test("documentation-impact: mixed code and docs do not hide code impact", () => {
  const result = resolveDocumentationImpactSelection([
    "docs/nixos-shared-host-setup.md",
    "build-tools/tools/deployments/deploy.ts",
  ]);

  assert.equal(result.mode, "no-documentation-contract");
  assert.equal(result.diagnostics.reason, "mixed-documentation-and-code");
});
