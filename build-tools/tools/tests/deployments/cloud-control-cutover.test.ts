#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { runDeploymentControlPlaneCommand } from "../../deployments/deployment-control-plane";
import { runInScratchTemp } from "../lib/test-helpers";
import {
  capabilityEvidence,
  evidence,
  IMAGE_BUILD_IDENTITY,
  imagePublicationEvidence,
  restoreEvidence,
} from "./cloud-control-cutover-fixture";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";

const CUTOVER_OPTIONS = {
  operation: "cutover" as const,
  expectedHostProfile: "aws-ec2",
  expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
  selectedCapabilities: [],
  maxAgeMinutes: 60,
};

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
        "--expected-image-build-identity",
        IMAGE_BUILD_IDENTITY,
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
          [
            "cutover",
            "--evidence",
            evidencePath,
            "--expected-host-profile",
            "aws-ec2",
            "--expected-image-build-identity",
            IMAGE_BUILD_IDENTITY,
          ],
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
      ...CUTOVER_OPTIONS,
      expectedRegion: "us-east-1",
      selectedCapabilities: ["aws-ec2-control-plane-host"],
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /host profile.*does not match/);
  assert.match(result.errors.join("\n"), /stale/);
  assert.match(result.errors.join("\n"), /dashboard or IaC state/);
});

test("cloud cutover rejects placeholder declarations and manual-note evidence", () => {
  const invalid = { ...capabilityEvidence(), declaration: { id: "placeholder" } };
  const result = validateCloudControlCutover(
    evidence({
      providerCapabilities: {
        "aws-ec2-control-plane-host": {
          ...invalid,
          source: "manual-notes",
        },
      },
    }),
    {
      ...CUTOVER_OPTIONS,
      expectedRegion: "us-east-1",
      selectedCapabilities: ["aws-ec2-control-plane-host"],
    },
  );
  assert.match(result.errors.join("\n"), /unrelated capability|unknown provider-capability/);
  assert.match(result.errors.join("\n"), /manual notes/);
});

test("cloud cutover rejects unrelated or incomplete capability evidence", () => {
  const result = validateCloudControlCutover(
    evidence({
      providerCapabilities: {
        "aws-ec2-control-plane-host": capabilityEvidence("aws-s3-artifact-store"),
      },
    }),
    {
      ...CUTOVER_OPTIONS,
      selectedCapabilities: ["aws-ec2-control-plane-host"],
    },
  );
  assert.match(result.errors.join("\n"), /unrelated capability aws-s3-artifact-store/);
  const missing = validateCloudControlCutover(
    evidence({
      providerCapabilities: {
        "aws-ec2-control-plane-host": { ...capabilityEvidence(), auditEvidence: [] },
      },
    }),
    {
      ...CUTOVER_OPTIONS,
      selectedCapabilities: ["aws-ec2-control-plane-host"],
    },
  );
  assert.match(missing.errors.join("\n"), /missing provider-capability audit evidence contract/);
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
    { ...CUTOVER_OPTIONS, expectedRegion: "us-east-1" },
  );
  assert.match(result.errors.join("\n"), /traffic\/ingress is not pointed/);
  assert.match(result.errors.join("\n"), /cloud-primary path/);
  assert.match(result.errors.join("\n"), /staging deployment did not succeed/);
});

test("cloud cutover validation rejects missing or mismatched image publication evidence", () => {
  const missing = validateCloudControlCutover(
    evidence({ imagePublication: undefined }),
    CUTOVER_OPTIONS,
  );
  assert.match(missing.errors.join("\n"), /requires verified publication evidence/);

  const mismatched = validateCloudControlCutover(
    evidence({
      imagePublication: {
        ...imagePublicationEvidence(),
        inspectedDigest: `sha256:${"c".repeat(64)}`,
      },
    }),
    CUTOVER_OPTIONS,
  );
  assert.match(mismatched.errors.join("\n"), /must match registry inspect digest/);
  const wrongBuild = validateCloudControlCutover(evidence(), {
    ...CUTOVER_OPTIONS,
    expectedImageBuildIdentity: `nix-source-${"c".repeat(64)}`,
  });
  assert.match(wrongBuild.errors.join("\n"), /does not match expected build identity/);
});

test("cloud cutover validation covers restore rollback and break-glass gates", () => {
  assert.match(
    validateCloudControlCutover(evidence({ restore: {} }), {
      ...CUTOVER_OPTIONS,
      operation: "restore",
    }).errors.join("\n"),
    /missing restore databaseRecords evidence/,
  );
  assert.match(
    validateCloudControlCutover(evidence({ rollback: {} }), {
      ...CUTOVER_OPTIONS,
      operation: "rollback",
    }).errors.join("\n"),
    /missing rollback previousHostProfile evidence/,
  );
  assert.match(
    validateCloudControlCutover(evidence({ breakGlass: { statusInspect: {} } }), {
      ...CUTOVER_OPTIONS,
      operation: "break-glass",
    }).errors.join("\n"),
    /missing break-glass incidentRef evidence/,
  );
});

test("cloud cutover validation rejects incomplete restore provenance", () => {
  assert.match(
    validateCloudControlCutover(evidence({ restore: { ...restoreEvidence(), configDigest: "" } }), {
      ...CUTOVER_OPTIONS,
      operation: "restore",
    }).errors.join("\n"),
    /missing restore configDigest evidence/,
  );
  assert.match(
    validateCloudControlCutover(
      evidence({ restore: { ...restoreEvidence(), durableStateReferences: [] } }),
      {
        ...CUTOVER_OPTIONS,
        operation: "restore",
      },
    ).errors.join("\n"),
    /missing restore durableStateReferences evidence/,
  );
});
