#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { normalizeAttestationEvidence } from "../../deployments/deployment-admission-supply-chain";
import { createDeploymentPublicationEvidence } from "../../deployments/deployment-publication-evidence";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const aggregate = `/nix/store/${"a".repeat(32)}-aggregate/aggregate.json`;
const output = `/nix/store/${"b".repeat(32)}-static-webapp`;
const evidenceStoreLocator = "s3://reviewed-evidence/reproducibility";

test("deployment publication evidence contains only the locator, signed aggregate, and output", () => {
  const evidence = createDeploymentPublicationEvidence({
    reproducibilityAggregateStorePath: aggregate,
    publicationOutputPath: output,
    evidenceStoreLocator,
  });
  assert.deepEqual(evidence.attestations, [
    {
      reproducibilityAggregateStorePath: aggregate,
      publicationOutputPath: output,
      evidenceStoreLocator,
    },
  ]);
  assert.deepEqual(normalizeAttestationEvidence(evidence.attestations), evidence.attestations);
});

test("deployment publication evidence rejects caller-authored trust and non-store inputs", () => {
  assert.deepEqual(
    normalizeAttestationEvidence([
      {
        reproducibilityAggregateStorePath: aggregate,
        publicationOutputPath: output,
        evidenceStoreLocator,
        builderIdentity: "reviewed:caller-claim",
        signatureStatus: "verified",
      },
    ]),
    [],
  );
  assert.throws(
    () =>
      createDeploymentPublicationEvidence({
        reproducibilityAggregateStorePath: "/tmp/aggregate.json",
        publicationOutputPath: output,
        evidenceStoreLocator,
      }),
    /exact signed aggregate/,
  );
});

test("the deployment evidence producer is exported as a real Nix app", () => {
  const apps = fs.readFileSync(
    viberootsSourcePath("build-tools/tools/nix/flake/outputs-apps.nix"),
    "utf8",
  );
  assert.match(apps, /deployment-publication-evidence\.ts/);
  assert.match(apps, /deployment-publication-evidence = deploymentTool/);
});
