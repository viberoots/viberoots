#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  runCredentialRotation,
  runCredentialStaging,
} from "../../deployments/control-plane-credential-staging";
import { runDeploymentControlPlaneCommand } from "../../deployments/deployment-control-plane";
import { runInScratchTemp } from "../lib/test-helpers";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";
import { withRawControlPlaneArgv, writeBundle } from "./control-plane-credential-staging.helpers";

test("live credential staging requires explicit gate and reviewed evidence", async () => {
  await runInScratchTemp("credential-live-gated", async (tmp) => {
    await writeBundle(tmp);
    const missing = await runCredentialStaging({ bundleDir: tmp, live: true });
    assert.equal(missing.ok, false);
    assert.match(missing.errors.join("\n"), /LIVE_CREDENTIAL_STAGING/);
    assert.match(missing.errors.join("\n"), /secret-backend-evidence/);

    const previous = process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
    try {
      process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = "1";
      const backend = path.join(tmp, "live-backend-write.json");
      const mount = path.join(tmp, "live-host-mount.json");
      await fsp.writeFile(backend, JSON.stringify(await liveBackendEvidence(tmp)), "utf8");
      await fsp.writeFile(mount, JSON.stringify(await liveMountEvidence(tmp)), "utf8");
      const staging = await runCredentialStaging({
        bundleDir: tmp,
        live: true,
        secretBackendEvidence: backend,
        hostMountEvidence: mount,
      });
      assert.equal(staging.ok, true);
      assert.equal(staging.mode, "live-gated-backend-write");
      assert.equal(staging.hostMountEvidence.verifiedBy, "live-host-check");
      assert.ok(staging.liveBackendWriteEvidence);
    } finally {
      if (previous === undefined) delete process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
      else process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = previous;
    }
  });
});

test("credential rotation can regenerate a map for stale entries", async () => {
  await runInScratchTemp("credential-rotation-regenerate-map", async (tmp) => {
    await writeBundle(tmp);
    const rotatedMapOut = path.join(tmp, "credential-map.rotated.json");
    const rotation = await runCredentialRotation({
      bundleDir: tmp,
      staleCredentials: ["control-plane-token"],
      applyRotation: true,
      rotatedMapOut,
    });
    assert.equal(rotation.ok, true);
    assert.match(rotation.rotatedCredentialMapDigest || "", /^sha256:/);
    const rotated = JSON.parse(await fsp.readFile(rotatedMapOut, "utf8"));
    const token = rotated.entries.find((entry: any) => entry.file === "control-plane-token");
    assert.match(token.source.writePlanRef, /rotation-/);
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

async function liveBackendEvidence(tmp: string) {
  const map = JSON.parse(await fsp.readFile(path.join(tmp, "credential-map.json"), "utf8"));
  return {
    schemaVersion: "control-plane-credential-live-backend-write@1",
    checkedAt: new Date().toISOString(),
    liveGate: "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1",
    backend: "infisical",
    generatedSecretWritePlanIds: map.entries.flatMap((entry: any) =>
      entry.source.kind === "generated-secret-write-plan" ? [entry.source.writePlanRef] : [],
    ),
    backendRefs: map.entries.flatMap((entry: any) =>
      entry.source.kind === "secret-backend-ref" ? [entry.source.ref] : [],
    ),
    hostCredentialSourceIds: map.entries.flatMap((entry: any) =>
      entry.source.kind === "host-credential-source" ? [entry.source.hostSourceRef] : [],
    ),
    noSecretValuesPersisted: true,
    evidenceRef: "evidence://credential-staging/live-backend-write",
  };
}

async function exists(file: string): Promise<boolean> {
  return fsp.access(file).then(
    () => true,
    () => false,
  );
}

async function liveMountEvidence(tmp: string) {
  const manifest = JSON.parse(
    await fsp.readFile(path.join(tmp, "credential-manifest.json"), "utf8"),
  );
  return {
    evidenceRef: "evidence://credential-staging/live-host-mount",
    targetPath: "/run/deployment-control-plane/credentials",
    filenameSet: manifest.requiredFiles,
    owner: { uid: 10001, gid: 10001 },
    permissions: "0400",
  };
}
