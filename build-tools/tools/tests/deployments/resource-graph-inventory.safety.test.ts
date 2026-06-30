#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeploymentResourceInventory } from "../../deployments/resource-graph-inventory";
import { cloudflareDeployment, cloudflareNodes } from "./deployment-contexts.scope.helpers";
import { deploymentTargetExceptionNodeFixture } from "./deployment-metadata.fixture";

test("lane governance resources expose reviewed safety metadata and graph edges", () => {
  const inventory = createDeploymentResourceInventory(
    cloudflareNodes([cloudflareDeployment({ provider_target: providerTarget() })]),
  );
  assert.deepEqual(inventory.errors, []);
  const lane = resource(inventory, "LanePolicy");
  const governance = resource(inventory, "LaneGovernancePolicy");
  const sourceRef = resource(inventory, "SourceRefPolicy");
  const admission = resource(inventory, "AdmissionPolicy");
  assert.equal(lane.refs?.includes(governance.id), true);
  assert.equal(typeof lane.facts?.admissionFingerprint, "string");
  assert.equal(governance.facts?.statusVisibility, "operator_status");
  assert.equal(Array.isArray(governance.facts?.trustedReporterIdentities), true);
  assert.equal(Array.isArray(governance.facts?.requiredApprovalBoundaries), true);
  assert.equal(sourceRef.refs?.includes(governance.id), true);
  assert.equal(Array.isArray(sourceRef.facts?.allowedRefs), true);
  assert.equal(Array.isArray(admission.facts?.requiredChecks), true);
  assert.equal(typeof admission.facts?.admissionFingerprint, "string");
});

test("target exception inventory preserves reviewed identity and approval boundaries", () => {
  const exceptionRef = "//projects/deployments/demoapp-shared:alias_window";
  const inventory = createDeploymentResourceInventory(
    cloudflareNodes([
      deploymentTargetExceptionNodeFixture({
        name: exceptionRef,
        affected_deployments: ["pleomino-staging"],
      }),
      cloudflareDeployment({
        target_exceptions: [exceptionRef],
        deployment_id: "pleomino-staging",
        provider_target: providerTarget(),
      }),
    ]),
  );
  assert.deepEqual(inventory.errors, []);
  const exception = resource(inventory, "DeploymentTargetException");
  assert.equal(exception.id, exceptionRef);
  assert.equal(exception.refs?.includes("pleomino-staging"), true);
  assert.equal(exception.facts?.exceptionKind, "alias");
  assert.equal(exception.facts?.approvalBoundary, "reviewed-target-exception");
  assert.equal(exception.facts?.statusVisibility, "operator_status");
  assert.equal(typeof exception.facts?.oldProviderTargetIdentity, "string");
  assert.equal(typeof exception.facts?.approvalEvidence, "string");
});

test("resource inventory fails closed for incomplete safety metadata", () => {
  const exceptionRef = "//projects/deployments/demoapp-shared:alias_window";
  const inventory = createDeploymentResourceInventory(
    cloudflareNodes([
      deploymentTargetExceptionNodeFixture({
        name: exceptionRef,
        approval_evidence: "",
        shared_lock_scope: "",
      }),
      cloudflareDeployment({
        target_exceptions: [exceptionRef],
        provider_target: providerTarget(),
      }),
    ]),
  );
  const errors = inventory.errors.join("\n");
  assert.match(errors, /target exception must define shared_lock_scope/);
  assert.match(errors, /target exception must define approval_evidence/);
  assert.equal(
    inventory.resources.some((entry) => entry.kind === "DeploymentTargetException"),
    false,
  );
});

function resource(inventory: ReturnType<typeof createDeploymentResourceInventory>, kind: string) {
  const found = inventory.resources.find((entry) => entry.kind === kind);
  assert.ok(found, `${kind} resource missing`);
  return found;
}

function providerTarget() {
  return { account: "web-platform-staging", project: "pleomino-staging" };
}
