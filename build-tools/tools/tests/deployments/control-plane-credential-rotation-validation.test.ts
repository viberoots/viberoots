#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { runCredentialRotation } from "../../deployments/control-plane-credential-staging";
import { validateCredentialRotationEvidence } from "../../deployments/control-plane-credential-staging-evidence";
import { runDeploymentControlPlaneCommand } from "../../deployments/deployment-control-plane";
import { runInScratchTemp } from "../lib/test-helpers";
import { evidence } from "./cloud-control-cutover-fixture";
import { withRawControlPlaneArgv } from "./control-plane-credential-staging.helpers";
import { cutoverOptions, writeBundle } from "./control-plane-credential-staging.helpers";

test("rotation validation rejects missing fields and stale or mismatched evidence", async () => {
  await runInScratchTemp("credential-rotation-validation", async (tmp) => {
    await writeBundle(tmp);
    const rotation = await runCredentialRotation({ bundleDir: tmp });
    const expected = {
      manifestDigest: rotation.manifestDigest,
      credentialMapDigest: rotation.credentialMapDigest,
      requiredFiles: rotation.hostMountEvidence.filenameSet,
      maxAgeMinutes: 60,
    };
    const cases = [
      [{ ...rotation, generatedSecretWritePlanIds: undefined }, /write-plan ids/],
      [{ ...rotation, hostCredentialSourceIds: undefined }, /host credential source ids/],
      [{ ...rotation, generatedAt: "2020-01-01T00:00:00.000Z" }, /evidence is stale/],
      [{ ...rotation, credentialMapDigest: "sha256:old-map" }, /map digest does not match/],
      [
        { ...rotation, staleCredentialDetection: [{ file: "control-plane-token", stale: true }] },
        /active stale credential/,
      ],
      [
        { ...rotation, reloadEvidence: { ...rotation.reloadEvidence, workers: [] } },
        /worker reload/,
      ],
      [
        {
          ...rotation,
          hostMountEvidence: { ...rotation.hostMountEvidence, targetPath: "/tmp/creds" },
        },
        /host mount target/,
      ],
    ] as const;
    for (const [candidate, pattern] of cases) {
      assert.match(
        validateCredentialRotationEvidence(candidate as any, expected).join("\n"),
        pattern,
      );
    }
  });
});

test("cutover requires credential required files and current map digest", () => {
  const base = evidence() as any;
  const arbitrary = {
    ...base.credentialStaging,
    hostMountEvidence: { ...base.credentialStaging.hostMountEvidence, filenameSet: ["anything"] },
  };
  const missingRequiredFiles = validateCloudControlCutover(
    evidence({ credentialManifestRequiredFiles: undefined, credentialStaging: arbitrary }) as any,
    cutoverOptions(),
  );
  assert.match(missingRequiredFiles.errors.join("\n"), /required filename set is missing/);
  const oldMap = validateCloudControlCutover(
    evidence({ credentialMapDigest: "sha256:old-map" }) as any,
    cutoverOptions(),
  );
  assert.match(oldMap.errors.join("\n"), /map digest does not match/);
});

test("credential rotation supports value flags before the subcommand", async () => {
  await runInScratchTemp("credential-rotation-before-command-flags", async (tmp) => {
    await writeBundle(tmp);
    const out = path.join(tmp, "credential-rotation-before.json");
    await withRawControlPlaneArgv(
      ["--bundle-dir", tmp, "credential-rotation", "--out", out],
      runDeploymentControlPlaneCommand,
    );
    await fsp.access(out);
  });
});
