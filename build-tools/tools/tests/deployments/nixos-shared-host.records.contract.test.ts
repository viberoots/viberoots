#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createNixosSharedHostDeployRecord } from "../../deployments/nixos-shared-host-records.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

test("nixos-shared-host durable records persist canonical provider-target identity and artifact identity", () => {
  const deployment = nixosSharedHostDeploymentFixture({
    runtime: { appName: "pleomino", containerPort: 3000, targetGroup: "shared-dev" },
  });
  const record = createNixosSharedHostDeployRecord(deployment, {
    deployRunId: "deploy-123",
    runClassification: "deploy",
    finalOutcome: "succeeded",
    artifactIdentity: "static-webapp:abc123",
    artifactLineageId: "static-webapp:abc123",
    publicUrl: "https://pleomino.apps.kilty.io/",
  });
  assert.equal(record.schemaVersion, "deploy-record@2026-03-25");
  assert.equal(record.operationKind, "deploy");
  assert.equal(record.publishMode, "normal");
  assert.equal(record.lifecycleState, "finished");
  assert.equal(record.terminationReason, null);
  assert.equal(record.provider, "nixos-shared-host");
  assert.equal(record.providerTargetIdentity, "nixos-shared-host:shared-dev:pleomino");
  assert.deepEqual(record.providerTarget, record.effectiveRunTarget);
  assert.equal(record.artifact?.identity, "static-webapp:abc123");
  assert.equal(record.artifactLineageId, "static-webapp:abc123");
  assert.equal(record.publisherType, "nixos-shared-host-static-webapp");
  assert.equal(record.smokeRunnerType, "nixos-shared-host-static-webapp-smoke");
});
