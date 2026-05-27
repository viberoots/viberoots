#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { runDeploymentControlPlaneCommand } from "../../deployments/deployment-control-plane";
import { runInScratchTemp } from "../lib/test-helpers";
import { capabilityEvidence, evidence, restoreEvidence } from "./cloud-control-cutover-fixture";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";

test("cloud cutover validation accepts fresh AWS evidence and writes a checklist", async () => {
  await runInScratchTemp("cloud-cutover-ok", async (tmp) => {
    const evidencePath = path.join(tmp, "evidence.json");
    const out = path.join(tmp, "report.json");
    await fsp.writeFile(evidencePath, JSON.stringify(evidence()), "utf8");
    await withControlPlaneArgv(
      [
        "cutover",
        "--evidence",
        evidencePath,
        "--expected-host-profile",
        "aws-ec2",
        "--expected-region",
        "us-east-1",
        "--selected-capability",
        "aws-ec2-control-plane-host,aws-s3-artifact-store",
        "--out",
        out,
      ],
      runDeploymentControlPlaneCommand,
    );
    const report = JSON.parse(await fsp.readFile(out, "utf8"));
    assert.equal(report.ok, true);
    assert.match(report.checklist.join("\n"), /standby workers/);
  });
});

test("cloud cutover CLI requires trusted expected host profile", async () => {
  await runInScratchTemp("cloud-cutover-expected-host", async (tmp) => {
    const evidencePath = path.join(tmp, "evidence.json");
    await fsp.writeFile(
      evidencePath,
      JSON.stringify(evidence({ hostProfile: "compose-podman" })),
      "utf8",
    );
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          ["cutover", "--evidence", evidencePath],
          runDeploymentControlPlaneCommand,
        ),
      /requires --expected-host-profile/,
    );
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          ["cutover", "--evidence", evidencePath, "--expected-host-profile", "aws-ec2"],
          runDeploymentControlPlaneCommand,
        ),
      /host profile compose-podman does not match/,
    );
  });
});

test("cloud cutover validation rejects stale, mismatched, and dashboard-only evidence", () => {
  const stale = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const result = validateCloudControlCutover(
    evidence({
      hostProfile: "compose-podman",
      generatedAt: stale,
      providerCapabilities: {
        "aws-ec2-control-plane-host": { ...capabilityEvidence(), source: "dashboard-only" },
      },
    }),
    {
      operation: "cutover",
      expectedHostProfile: "aws-ec2",
      expectedRegion: "us-east-1",
      selectedCapabilities: ["aws-ec2-control-plane-host"],
      maxAgeMinutes: 60,
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /host profile.*does not match/);
  assert.match(result.errors.join("\n"), /stale/);
  assert.match(result.errors.join("\n"), /dashboard or IaC state/);
});

test("cloud cutover validation requires cloud-primary staging evidence", () => {
  const result = validateCloudControlCutover(
    evidence({
      latestNonProductionDeployment: {
        runId: "deploy-run-1",
        hostProfile: "aws-ec2",
        trafficIngressHostProfile: "mini",
        cloudPrimaryPath: false,
        stagingDeploymentSucceeded: false,
      },
    }),
    {
      operation: "cutover",
      expectedHostProfile: "aws-ec2",
      expectedRegion: "us-east-1",
      selectedCapabilities: [],
      maxAgeMinutes: 60,
    },
  );
  assert.match(result.errors.join("\n"), /traffic\/ingress is not pointed/);
  assert.match(result.errors.join("\n"), /cloud-primary path/);
  assert.match(result.errors.join("\n"), /staging deployment did not succeed/);
});

test("cloud cutover validation covers restore rollback and break-glass gates", () => {
  assert.match(
    validateCloudControlCutover(evidence({ restore: {} }), {
      operation: "restore",
      expectedHostProfile: "aws-ec2",
      selectedCapabilities: [],
      maxAgeMinutes: 60,
    }).errors.join("\n"),
    /missing restore databaseRecords evidence/,
  );
  assert.match(
    validateCloudControlCutover(evidence({ standby: {} }), {
      operation: "rollback",
      expectedHostProfile: "aws-ec2",
      selectedCapabilities: [],
      maxAgeMinutes: 60,
    }).errors.join("\n"),
    /double-execution prevention/,
  );
  assert.match(
    validateCloudControlCutover(evidence({ breakGlass: { statusInspect: true } }), {
      operation: "break-glass",
      expectedHostProfile: "aws-ec2",
      selectedCapabilities: [],
      maxAgeMinutes: 60,
    }).errors.join("\n"),
    /providerMutationBlocked/,
  );
});

test("cloud cutover validation rejects incomplete restore provenance", () => {
  assert.match(
    validateCloudControlCutover(
      evidence({ restore: { ...restoreEvidence(), exportedConfigDigest: "" } }),
      {
        operation: "restore",
        expectedHostProfile: "aws-ec2",
        selectedCapabilities: [],
        maxAgeMinutes: 60,
      },
    ).errors.join("\n"),
    /missing restore exportedConfigDigest evidence/,
  );
  assert.match(
    validateCloudControlCutover(
      evidence({ restore: { ...restoreEvidence(), durableStateReferences: [] } }),
      {
        operation: "restore",
        expectedHostProfile: "aws-ec2",
        selectedCapabilities: [],
        maxAgeMinutes: 60,
      },
    ).errors.join("\n"),
    /missing restore durableStateReferences evidence/,
  );
});
