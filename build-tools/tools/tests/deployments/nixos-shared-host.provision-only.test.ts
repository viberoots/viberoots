#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";

test("nixos-shared-host --provision-only writes state and records without publish output", async () => {
  await runInTemp("nixos-shared-host-provision-only", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson,
      deployment,
    });
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --provision-only`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.operationKind, "provision_only");
    assert.equal(summary.runClassification, "provision_only");
    assert.equal(summary.finalOutcome, "succeeded");
    assert.equal(summary.publicUrl, undefined);
    const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
    assert.equal(record.runClassification, "provision_only");
    assert.equal(record.finalOutcome, "succeeded");
    assert.equal(record.provisionerType, "nixos-shared-host-manifest");
    assert.equal("publisherType" in record, false);
    const state = JSON.parse(await fsp.readFile(statePath, "utf8"));
    assert.equal(state.deployments[0].deploymentId, deployment.deploymentId);
    const snapshot = JSON.parse(
      await fsp.readFile(record.controlPlane.executionSnapshotPath, "utf8"),
    );
    assert.equal(snapshot.operationKind, "provision_only");
    assert.equal(snapshot.action.publishBehavior, "provision-only");
    assert.equal("publishInput" in snapshot.action, false);
  });
});
