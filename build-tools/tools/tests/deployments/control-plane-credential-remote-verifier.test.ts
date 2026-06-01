#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { validateRunbookBundle } from "../../deployments/cloud-control-runbook";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import {
  remoteHostEvidenceDigest,
  validateRemoteHostVerifierTrust,
} from "../../deployments/control-plane-credential-host-verifier-trust";
import { validateCredentialStagingEvidence } from "../../deployments/control-plane-credential-staging-evidence";
import { runCredentialStaging } from "../../deployments/control-plane-credential-staging";
import { runInScratchTemp } from "../lib/test-helpers";
import { evidence } from "./cloud-control-cutover-fixture";
import { liveCredentialStagingEvidence } from "./cloud-control-credential-staging.fixture";
import { liveHostVerification } from "./control-plane-credential-live.fixture";
import {
  commandAttestationProfile,
  liveHostVerifierProfile,
  liveHostVerifierTrustAnchor,
  wrongPublicKeyProfile,
} from "./control-plane-credential-remote-verifier.fixture";
import { cutoverOptions, writeBundle } from "./control-plane-credential-staging.helpers";

test("remote verifier trust accepts reviewed signatures and command attestations", async () => {
  await runInScratchTemp("credential-remote-trust-positive", async (tmp) => {
    await writeBundle(tmp);
    const host = (await liveHostVerification(tmp)) as any;
    assert.match(
      validateRemoteHostVerifierTrust(host, "credential staging").join("\n"),
      /trust anchor/,
    );
    assert.deepEqual(
      validateRemoteHostVerifierTrust(host, "credential staging", liveHostVerifierTrustAnchor()),
      [],
    );
    const attested = { ...host, reviewedVerifierProfile: commandAttestationProfile(host) };
    assert.deepEqual(
      validateRemoteHostVerifierTrust(
        attested,
        "credential staging",
        liveHostVerifierTrustAnchor(),
      ),
      [],
    );
  });
});

test("remote verifier trust rejects each untrusted binding case", async () => {
  await runInScratchTemp("credential-remote-trust-negative", async (tmp) => {
    await writeBundle(tmp);
    const host = (await liveHostVerification(tmp)) as any;
    const digest = remoteHostEvidenceDigest(host);
    const cases: [string, any, RegExp][] = [
      [
        "hand-authored",
        { evidenceDigest: digest, signature: "sig:marker" },
        /signature verification failed/,
      ],
      ["identity", { verifierIdentity: "other-verifier" }, /identity/],
      ["source-host", { sourceHostIdentity: "aws-ec2:i-other" }, /source host/],
      ["target-path", { targetPath: "/tmp/credentials" }, /target path/],
      ["filename-set", { filenameSet: ["control-plane-token"] }, /filename set/],
      ["aws-wiring", { awsBindMountVerified: false }, /AWS bind mount/],
      ["digest", { evidenceDigest: "sha256:wrong" }, /digest/],
      ["missing-signature", { signature: undefined }, /signature or command attestation/],
      [
        "missing-attestation",
        { publicKeyFingerprint: undefined, signature: undefined },
        /signature or command attestation/,
      ],
      [
        "hand-authored-command",
        {
          ...commandAttestationProfile(host),
          commandAttestation: {
            ...commandAttestationProfile(host).commandAttestation!,
            commandDigest: "sha256:attacker-command",
          },
        },
        /trust anchor/,
      ],
      ["wrong-public-key", wrongPublicKeyProfile(host), /public key trust anchor/],
      [
        "stale",
        { reviewedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-02T00:00:00.000Z" },
        /stale/,
      ],
    ];
    assert.match(
      validateRemoteHostVerifierTrust(
        { ...host, reviewedVerifierProfile: liveHostVerifierProfile(host) },
        "credential staging",
      ).join("\n"),
      /trust anchor/,
    );
    for (const [name, override, pattern] of cases) {
      const profile =
        name === "wrong-public-key" || name === "hand-authored-command"
          ? override
          : liveHostVerifierProfile(host, override);
      const changed = { ...host, reviewedVerifierProfile: profile };
      assert.match(
        validateRemoteHostVerifierTrust(
          changed,
          "credential staging",
          liveHostVerifierTrustAnchor(),
        ).join("\n"),
        pattern,
      );
    }
  });
});

test("live input and persisted validators share remote verifier trust rejection", async () => {
  await runInScratchTemp("credential-remote-trust-integration", async (tmp) => {
    await writeBundle(tmp);
    const host = (await liveHostVerification(tmp)) as any;
    const profile = liveHostVerifierProfile(host, {
      evidenceDigest: remoteHostEvidenceDigest(host),
      signature: "sig:self-authored-marker",
    });
    const embedded = liveHostVerifierProfile(host);
    const attestation = commandAttestationProfile(host);
    const trust = path.join(tmp, "trust.json");
    await fsp.writeFile(path.join(tmp, "host.json"), JSON.stringify(host), "utf8");
    await fsp.writeFile(path.join(tmp, "profile.json"), JSON.stringify(profile), "utf8");
    await fsp.writeFile(trust, JSON.stringify(liveHostVerifierTrustAnchor()), "utf8");
    assert.match(
      validateRemoteHostVerifierTrust(
        { ...host, reviewedVerifierProfile: embedded },
        "credential staging",
      ).join("\n"),
      /trust anchor/,
    );
    assert.match(
      validateRemoteHostVerifierTrust(
        { ...host, reviewedVerifierProfile: attestation },
        "credential staging",
      ).join("\n"),
      /trust anchor/,
    );
    const previous = process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
    try {
      process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = "1";
      const staging = await runCredentialStaging({
        bundleDir: tmp,
        live: true,
        liveHostVerificationEvidence: path.join(tmp, "host.json"),
        liveHostVerifierProfile: path.join(tmp, "profile.json"),
      });
      assert.match(staging.errors.join("\n"), /trust anchor/);
      const withTrust = await runCredentialStaging({
        bundleDir: tmp,
        live: true,
        liveHostVerificationEvidence: path.join(tmp, "host.json"),
        liveHostVerifierProfile: path.join(tmp, "profile.json"),
        liveHostVerifierTrustProfile: trust,
      });
      assert.match(withTrust.errors.join("\n"), /signature verification failed/);
    } finally {
      if (previous === undefined) delete process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
      else process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = previous;
    }
    const persisted = liveCredentialStagingEvidence("sha256:manifest", "sha256:map");
    persisted.deploymentOwnedLiveHostVerification = { ...host, reviewedVerifierProfile: profile };
    assert.match(
      validateCredentialStagingEvidence(persisted, expectation()).join("\n"),
      /trust anchor/,
    );
    persisted.deploymentOwnedLiveHostVerification = { ...host, reviewedVerifierProfile: embedded };
    assert.match(
      validateCredentialStagingEvidence(persisted, expectation()).join("\n"),
      /trust anchor/,
    );
    persisted.deploymentOwnedLiveHostVerification = {
      ...host,
      reviewedVerifierProfile: attestation,
    };
    assert.match(
      validateCredentialStagingEvidence(persisted, expectation()).join("\n"),
      /trust anchor/,
    );
    const cutover = validateCloudControlCutover(
      evidence({ credentialStaging: persisted }) as any,
      cutoverOptions(),
    );
    assert.match(cutover.errors.join("\n"), /trust anchor/);
  });
});

test("mixed external proof and live write evidence fails persisted, cutover, and runbook validation", async () => {
  await runInScratchTemp("credential-mixed-proof-live-write", async (tmp) => {
    await writeBundle(tmp);
    const staging = {
      ...liveCredentialStagingEvidence("sha256:manifest", "sha256:map"),
      externalReviewedBackendProof: {
        source: "external-reviewed-proof",
        evidence: { ref: "reviewed" },
      },
    };
    assert.match(
      validateCredentialStagingEvidence(staging, expectation()).join("\n"),
      /mixed external backend proof\/live backend write/,
    );
    const cutover = validateCloudControlCutover(
      evidence({ credentialStaging: staging }) as any,
      cutoverOptions(),
    );
    assert.match(cutover.errors.join("\n"), /mixed external backend proof\/live backend write/);
    await writeRunbookEvidence(tmp, staging);
    const doctor = await validateRunbookBundle(tmp);
    assert.match(JSON.stringify(doctor.phases), /mixed external backend proof\/live backend write/);
  });
});

function expectation() {
  return {
    manifestDigest: "sha256:manifest",
    credentialMapDigest: "sha256:map",
    requiredFiles: ["control-plane-token"],
    maxAgeMinutes: 60,
  };
}

async function writeRunbookEvidence(tmp: string, staging: any): Promise<void> {
  await fsp.writeFile(path.join(tmp, "live-infisical-backend.profile.json"), "{}\n", "utf8");
  await fsp.writeFile(path.join(tmp, "credential-staging.live.json"), JSON.stringify(staging));
}
