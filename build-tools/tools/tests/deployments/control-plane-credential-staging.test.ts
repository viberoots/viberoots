#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  runCredentialRotation,
  runCredentialStaging,
} from "../../deployments/control-plane-credential-staging";
import { validateRunbookBundle } from "../../deployments/cloud-control-runbook";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { validateCredentialRotationEvidence } from "../../deployments/control-plane-credential-staging-evidence";
import { runDeploymentControlPlaneCommand } from "../../deployments/deployment-control-plane";
import { runInScratchTemp } from "../lib/test-helpers";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";
import { evidence } from "./cloud-control-cutover-fixture";
import {
  cutoverOptions,
  withRawControlPlaneArgv,
  writeBundle,
} from "./control-plane-credential-staging.helpers";

test("credential staging writes non-secret evidence and gates setup doctor", async () => {
  await runInScratchTemp("credential-staging-evidence", async (tmp) => {
    await writeBundle(tmp);
    let doctor = await validateRunbookBundle(tmp);
    assert.equal(
      doctor.phases.find((phase: any) => phase.id === "managed-dependencies").status,
      "blocked",
    );
    const staging = await runCredentialStaging({
      bundleDir: tmp,
      out: path.join(tmp, "credential-staging.json"),
    });
    await fsp.writeFile(path.join(tmp, "credential-preflight.json"), JSON.stringify({ ok: true }));
    await fsp.writeFile(path.join(tmp, "setup-doctor.json"), JSON.stringify({ ok: true }));
    assert.equal(staging.ok, true);
    assert.equal(staging.hostMountEvidence.targetPath, "/run/deployment-control-plane/credentials");
    assert.ok(!staging.hostMountEvidence.filenameSet.includes("artifact-store-access-key-id"));
    assert.ok(!staging.hostMountEvidence.filenameSet.includes("artifact-store-secret-access-key"));
    assert.ok(!JSON.stringify(staging).includes("secret-value"));
    doctor = await validateRunbookBundle(tmp);
    assert.equal(
      doctor.phases.find((phase: any) => phase.id === "credential-preflight").status,
      "complete",
    );
    assert.ok(
      !doctor.phases
        .find((phase: any) => phase.id === "managed-dependencies")
        .missingInputs.includes("$PROFILE_ROOT/credential-staging.json"),
    );
  });
});

test("credential staging fails closed for unsafe maps and mount evidence", async () => {
  await runInScratchTemp("credential-staging-negative", async (tmp) => {
    await writeBundle(tmp);
    const mapPath = path.join(tmp, "credential-map.json");
    const map = JSON.parse(await fsp.readFile(mapPath, "utf8"));
    map.entries[0].source = { kind: "unsupported", raw: "secret-value" };
    await fsp.writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
    const staging = await runCredentialStaging({ bundleDir: tmp });
    assert.equal(staging.ok, false);
    assert.match(staging.errors.join("\n"), /unsupported|secret values/);
    await writeBundle(tmp);
    const validStaging = await runCredentialStaging({ bundleDir: tmp });
    validStaging.hostMountEvidence.permissions = "0644";
    await fsp.writeFile(path.join(tmp, "credential-staging.json"), JSON.stringify(validStaging));
    await fsp.writeFile(path.join(tmp, "credential-preflight.json"), JSON.stringify({ ok: true }));
    await fsp.writeFile(path.join(tmp, "setup-doctor.json"), JSON.stringify({ ok: true }));
    const doctor = await validateRunbookBundle(tmp);
    assert.match(JSON.stringify(doctor), /host mount permissions/);
  });
});

test("credential staging rejects mount and reload evidence mismatches", async () => {
  await runInScratchTemp("credential-staging-mount-reload-negative", async (tmp) => {
    await writeBundle(tmp);
    const staging = await runCredentialStaging({ bundleDir: tmp });
    const cases = [
      [
        "filename",
        {
          ...staging,
          hostMountEvidence: { ...staging.hostMountEvidence, filenameSet: ["control-plane-token"] },
        },
      ],
      [
        "target",
        {
          ...staging,
          hostMountEvidence: { ...staging.hostMountEvidence, targetPath: "/tmp/creds" },
        },
      ],
      [
        "owner",
        {
          ...staging,
          hostMountEvidence: { ...staging.hostMountEvidence, owner: { uid: 0, gid: 0 } },
        },
      ],
      ["reload", { ...staging, reloadEvidence: undefined }],
      [
        "worker",
        {
          ...staging,
          reloadEvidence: {
            ...staging.reloadEvidence,
            workers: [{ unit: "worker", action: "noop" }],
          },
        },
      ],
    ];
    for (const [name, evidenceValue] of cases) {
      await fsp.writeFile(path.join(tmp, "credential-staging.json"), JSON.stringify(evidenceValue));
      await fsp.writeFile(
        path.join(tmp, "credential-preflight.json"),
        JSON.stringify({ ok: true }),
      );
      await fsp.writeFile(path.join(tmp, "setup-doctor.json"), JSON.stringify({ ok: true }));
      const doctor = await validateRunbookBundle(tmp);
      assert.equal(
        doctor.phases.find((phase: any) => phase.id === "credential-preflight").status,
        "ready",
        String(name),
      );
    }
  });
});

test("credential rotation records complete evidence and stale entries", async () => {
  await runInScratchTemp("credential-rotation-cutover", async (tmp) => {
    await writeBundle(tmp);
    const cleanRotation = await runCredentialRotation({ bundleDir: tmp });
    assert.deepEqual(cleanRotation.backendRefs.length > 0, true);
    assert.deepEqual(cleanRotation.generatedSecretWritePlanIds.length > 0, true);
    assert.deepEqual(Array.isArray(cleanRotation.hostCredentialSourceIds), true);
    assert.deepEqual(cleanRotation.hostMountEvidence.filenameSet.length > 0, true);
    assert.deepEqual(
      validateCredentialRotationEvidence(
        { ...cleanRotation, backendRefs: undefined as any },
        {
          manifestDigest: cleanRotation.manifestDigest,
          credentialMapDigest: cleanRotation.credentialMapDigest,
          requiredFiles: cleanRotation.hostMountEvidence.filenameSet,
          maxAgeMinutes: 60,
        },
      ).some((error) => /backend refs/.test(error)),
      true,
    );
    const rotation = await runCredentialRotation({
      bundleDir: tmp,
      staleCredentials: ["control-plane-token"],
    });
    assert.equal(rotation.ok, false);
    assert.match(rotation.errors.join("\n"), /stale credential active/);
    const missing = validateCloudControlCutover(
      evidence({ credentialStaging: undefined }) as any,
      cutoverOptions(),
    );
    assert.match(missing.errors.join("\n"), /credential staging evidence is required/);
  });
});

test("cutover requires current credential manifest and map digest binding", async () => {
  const noDigests = validateCloudControlCutover(
    evidence({ credentialManifestDigest: undefined, credentialMapDigest: undefined }) as any,
    cutoverOptions(),
  );
  assert.match(noDigests.errors.join("\n"), /expected manifest digest is missing/);
  assert.match(noDigests.errors.join("\n"), /expected credential map digest is missing/);
  const oldDigest = validateCloudControlCutover(
    evidence({ credentialManifestDigest: "sha256:old-manifest" }) as any,
    cutoverOptions(),
  );
  assert.match(oldDigest.errors.join("\n"), /manifest digest does not match/);
});

test("setup doctor blocks later phases when staging evidence is absent despite later outputs", async () => {
  await runInScratchTemp("credential-staging-late-output-bypass", async (tmp) => {
    await writeBundle(tmp);
    await fsp.writeFile(path.join(tmp, "setup-doctor.json"), JSON.stringify({ ok: true }));
    await fsp.writeFile(path.join(tmp, "credential-preflight.json"), JSON.stringify({ ok: true }));
    await fsp.writeFile(
      path.join(tmp, "managed-dependency-evidence.json"),
      JSON.stringify({ ok: true }),
    );
    const doctor = await validateRunbookBundle(tmp);
    assert.equal(
      doctor.phases.find((phase: any) => phase.id === "credential-preflight").status,
      "ready",
    );
    assert.equal(
      doctor.phases.find((phase: any) => phase.id === "managed-dependencies").status,
      "blocked",
    );
  });
});

test("credential staging and rotation CLI modes are real entrypoints", async () => {
  await runInScratchTemp("credential-staging-entrypoints", async (tmp) => {
    await writeBundle(tmp);
    await withControlPlaneArgv(
      [
        "credential-staging",
        "--bundle-dir",
        tmp,
        "--out",
        path.join(tmp, "credential-staging.json"),
      ],
      runDeploymentControlPlaneCommand,
    );
    await withControlPlaneArgv(
      [
        "credential-rotation",
        "--bundle-dir",
        tmp,
        "--out",
        path.join(tmp, "credential-rotation.json"),
      ],
      runDeploymentControlPlaneCommand,
    );
    assert.ok(await exists(path.join(tmp, "credential-staging.json")));
    assert.ok(await exists(path.join(tmp, "credential-rotation.json")));
    await withRawControlPlaneArgv(
      [
        "--bundle-dir",
        tmp,
        "credential-staging",
        "--out",
        path.join(tmp, "credential-staging-before.json"),
      ],
      runDeploymentControlPlaneCommand,
    );
    assert.ok(await exists(path.join(tmp, "credential-staging-before.json")));
  });
});

async function exists(file: string): Promise<boolean> {
  return fsp.access(file).then(
    () => true,
    () => false,
  );
}
