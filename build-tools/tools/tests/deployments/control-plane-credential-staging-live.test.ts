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
import {
  credentialOwner,
  liveBackendEvidence,
  liveHostVerification,
  liveHostVerifierProfile,
  writeCredentialFiles,
  writeLiveProfile,
} from "./control-plane-credential-live.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";

test("live credential staging requires explicit gate and reviewed evidence", async () => {
  await runInScratchTemp("credential-live-gated", async (tmp) => {
    await writeBundle(tmp);
    const envOnly = await runCredentialStaging({ bundleDir: tmp });
    assert.equal(envOnly.ok, true);

    const previous = process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
    try {
      process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = "1";
      const missingExplicit = await runCredentialStaging({ bundleDir: tmp });
      assert.equal(missingExplicit.ok, false);
      assert.match(missingExplicit.errors.join("\n"), /explicit --live/);
      const missingInputs = await runCredentialStaging({ bundleDir: tmp, live: true });
      assert.equal(missingInputs.ok, false);
      assert.match(missingInputs.errors.join("\n"), /live-backend-profile/);
      assert.match(missingInputs.errors.join("\n"), /credential-directory/);
    } finally {
      if (previous === undefined) delete process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
      else process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = previous;
    }
  });
});

test("live credential staging writes generated secrets and emits non-secret evidence", async () => {
  await runInScratchTemp("credential-live-writes", async (tmp) => {
    await writeBundle(tmp);
    const map = JSON.parse(await fsp.readFile(path.join(tmp, "credential-map.json"), "utf8"));
    const plan = map.entries.find(
      (entry: any) => entry.source.kind === "generated-secret-write-plan",
    );
    const server = await startFakeInfisicalServer(
      { clientId: "writer", clientSecret: "writer-secret", accessToken: "token" },
      [],
      { projectId: plan.source.selector.projectId, environment: plan.source.selector.environment },
    );
    try {
      const profile = path.join(tmp, "live-infisical-backend.profile.json");
      const credentials = path.join(tmp, "credentials");
      const hostVerification = path.join(tmp, "live-host-verification.json");
      const hostVerifierProfile = path.join(tmp, "live-host-verifier.profile.json");
      await writeLiveProfile(profile, server.siteUrl, plan.source);
      await writeCredentialFiles(tmp, credentials);
      const hostEvidence = await liveHostVerification(tmp);
      await fsp.writeFile(hostVerification, JSON.stringify(hostEvidence), "utf8");
      await fsp.writeFile(
        hostVerifierProfile,
        JSON.stringify(hostEvidence.reviewedVerifierProfile),
        "utf8",
      );
      const owner = await credentialOwner(credentials);
      const missingEnvGate = await runCredentialStaging({
        bundleDir: tmp,
        live: true,
        liveBackendProfile: profile,
        liveHostVerificationEvidence: hostVerification,
        liveHostVerifierProfile: hostVerifierProfile,
        credentialOwnerUid: owner.uid,
        credentialOwnerGid: owner.gid,
      });
      assert.equal(missingEnvGate.ok, false);
      assert.match(missingEnvGate.errors.join("\n"), /VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1/);
      assert.equal(server.secrets.length, 0);
      const previous = process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
      try {
        process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = "1";
        const staging = await runCredentialStaging({
          bundleDir: tmp,
          live: true,
          liveBackendProfile: profile,
          liveHostVerificationEvidence: hostVerification,
          liveHostVerifierProfile: hostVerifierProfile,
          credentialOwnerUid: owner.uid,
          credentialOwnerGid: owner.gid,
        });
        assert.equal(staging.ok, true);
        assert.equal(server.secrets.length, 1);
        assert.equal(server.secrets[0]!.secretName, plan.source.selector.secretName);
        assert.ok(server.secrets[0]!.secretValue?.startsWith("vbr_"));
        assert.ok(staging.deploymentOwnedLiveBackendWrite);
        assert.ok(staging.deploymentOwnedLiveHostVerification);
        const evidence = JSON.stringify(staging);
        assert.doesNotMatch(evidence, /writer-secret/);
        assert.ok(server.secrets[0]!.secretValue);
        assert.doesNotMatch(evidence, new RegExp(escapeRegExp(server.secrets[0]!.secretValue!)));
        assert.doesNotMatch(process.argv.join(" "), /writer-secret/);
        assert.doesNotMatch(
          process.argv.join(" "),
          new RegExp(escapeRegExp(server.secrets[0]!.secretValue!)),
        );
      } finally {
        if (previous === undefined) delete process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
        else process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = previous;
      }
    } finally {
      await server.close();
    }
  });
});

test("live credential staging rejects stale or overbroad host verification", async () => {
  await runInScratchTemp("credential-live-host-negative", async (tmp) => {
    await writeBundle(tmp);
    const evidence = await liveHostVerification(tmp);
    for (const [name, mutate, pattern] of [
      ["missing-profile", (_value: any) => undefined, /reviewed verifier profile/],
      ["wrong-target", (value: any) => (value.targetPath = "/tmp/credentials"), /target/],
      ["wrong-owner", (value: any) => (value.owner.uid = 501), /uid\/gid 10001/],
      ["stale-wiring", (value: any) => (value.awsBindMountVerified = false), /AWS bind-mounted/],
      ["missing-provenance", (value: any) => delete value.provenance, /provenance/],
      [
        "self-declared-remote",
        (value: any) => (value.provenance.kind = "local-host-verifier"),
        /reviewed provenance/,
      ],
    ] as const) {
      const file = path.join(tmp, `${name}.json`);
      const profile = path.join(tmp, `${name}.profile.json`);
      const changed = structuredClone(evidence);
      mutate(changed);
      await fsp.writeFile(file, JSON.stringify(changed), "utf8");
      await fsp.writeFile(profile, JSON.stringify(liveHostVerifierProfile(changed)), "utf8");
      const previous = process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
      try {
        process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = "1";
        const staging = await runCredentialStaging({
          bundleDir: tmp,
          live: true,
          liveHostVerificationEvidence: file,
          ...(name === "missing-profile" ? {} : { liveHostVerifierProfile: profile }),
        });
        assert.equal(staging.ok, false);
        assert.match(staging.errors.join("\n"), pattern);
      } finally {
        if (previous === undefined) delete process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
        else process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = previous;
      }
    }
  });
});

test("externally supplied backend proof cannot masquerade as deployment-owned live write", async () => {
  await runInScratchTemp("credential-live-external-proof", async (tmp) => {
    await writeBundle(tmp);
    const backend = path.join(tmp, "external-backend-proof.json");
    await fsp.writeFile(backend, JSON.stringify(await liveBackendEvidence(tmp)), "utf8");
    const previous = process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
    try {
      process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = "1";
      const staging = await runCredentialStaging({
        bundleDir: tmp,
        live: true,
        secretBackendEvidence: backend,
      });
      assert.equal(staging.ok, false);
      assert.ok(staging.externalReviewedBackendProof);
      assert.equal(staging.deploymentOwnedLiveBackendWrite, undefined);
      assert.match(staging.errors.join("\n"), /deployment-owned backend write/);
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
    await fsp.access(path.join(tmp, "credential-staging.json"));
    await fsp.access(path.join(tmp, "credential-rotation.json"));
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
    await fsp.access(path.join(tmp, "credential-staging-before.json"));
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
