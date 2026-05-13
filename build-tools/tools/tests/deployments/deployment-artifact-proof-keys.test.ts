#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  artifactBindingEnvelope,
  createArtifactBindingProof,
} from "../../deployments/deployment-artifact-binding";
import {
  createDeploymentArtifactChallenge,
  deploymentServicePrincipalForToken,
} from "../../deployments/deployment-artifact-challenges";
import type { DeploymentArtifactProofKeyRegistry } from "../../deployments/deployment-artifact-proof-keys";
import { acceptChallengedArtifactSubmission } from "../../deployments/deployment-artifact-submit-transaction";
import { fingerprintControlPlanePayload } from "../../deployments/deployment-control-plane-idempotency";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { prepareBackendNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-backend-prepare";
import { runInTemp } from "../lib/test-helpers";
import {
  challengedSubmitRequest,
  countBackendRows,
} from "./nixos-shared-host.challenged-submit.helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";

const TOKEN = "proof-key-token";

function registry(entry: Partial<DeploymentArtifactProofKeyRegistry["keys"][number]>) {
  const principal = deploymentServicePrincipalForToken(TOKEN);
  return {
    keys: [
      {
        principalId: principal.principalId,
        keyId: "reviewed-key",
        algorithm: "hmac-sha256" as const,
        status: "active" as const,
        ...entry,
      },
    ],
  };
}

test("challenge issuance rejects unknown, disabled, unassigned, and mismatched proof keys", async () => {
  await runInTemp("artifact-proof-key-challenge-rejections", async (tmp) => {
    const artifactDir = path.join(tmp, "artifact");
    await writeDemoArtifact(artifactDir);
    const request = await challengedSubmitRequest(artifactDir, "proof-key-rejections");
    const backend = {
      recordsRoot: path.join(tmp, "records"),
      databaseUrl: localHarnessControlPlaneDatabaseUrl(path.join(tmp, "records")),
    };
    const principal = deploymentServicePrincipalForToken(TOKEN);
    const create = (proofKeyRegistry: DeploymentArtifactProofKeyRegistry, body = request) =>
      createDeploymentArtifactChallenge({
        backend,
        request: body,
        principalId: principal.principalId,
        keyId: principal.keyId,
        proofKeyRegistry,
      });
    await assert.rejects(create(registry({}), { ...request, proofKeyId: "missing" }), /unknown/);
    await assert.rejects(
      create(registry({ status: "disabled" }), { ...request, proofKeyId: "reviewed-key" }),
      /disabled/,
    );
    await assert.rejects(
      create(registry({ principalId: "service-token:other" }), {
        ...request,
        proofKeyId: "reviewed-key",
      }),
      /not assigned/,
    );
    await assert.rejects(
      create(registry({ algorithm: "ed25519" as any }), { ...request, proofKeyId: "reviewed-key" }),
      /algorithm mismatch/,
    );
    assert.equal(await countBackendRows(backend, "artifact_challenges"), 0);
  });
});

test("final submit rechecks proof-key registry state before accepting artifacts", async () => {
  await runInTemp("artifact-proof-key-final-submit", async (tmp, $) => {
    const artifactDir = path.join(tmp, "artifact");
    await writeDemoArtifact(artifactDir);
    const request = await challengedSubmitRequest(artifactDir, "proof-key-final");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, request.deployment);
    const backend = {
      recordsRoot: path.join(tmp, "records"),
      databaseUrl: localHarnessControlPlaneDatabaseUrl(path.join(tmp, "records")),
    };
    const principal = deploymentServicePrincipalForToken(TOKEN);
    const proofKeyRegistry = registry({ keyId: "reviewed-key" });
    const challenge = await createDeploymentArtifactChallenge({
      backend,
      request: { ...request, proofKeyId: "reviewed-key" },
      principalId: principal.principalId,
      keyId: principal.keyId,
      proofKeyRegistry,
    });
    const proof = createArtifactBindingProof(
      artifactBindingEnvelope({
        request,
        principalId: principal.principalId,
        keyId: challenge.keyId,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        finalizedStagedArtifactReference: artifactDir,
      }),
      principal.proofSecret,
    );
    const requestFingerprint = fingerprintControlPlanePayload({
      ...request,
      submittedAt: request.submittedAt,
    });
    const prepared = await prepareBackendNixosSharedHostControlPlaneRun({
      workspaceRoot: tmp,
      operationKind: request.operationKind,
      deployment: request.deployment,
      paths: {
        statePath: `${tmp}/state.json`,
        hostRoot: `${tmp}/host`,
        recordsRoot: backend.recordsRoot,
      },
      backend,
      submissionId: request.submissionId,
      dedupe: { mode: "created", requestFingerprint, idempotencyKey: request.idempotencyKey },
      requestedBy: request.admissionEvidence.requestedBy,
      artifactDir: request.artifactDir,
      expectedArtifactIdentity: request.expectedArtifactIdentity,
      admissionEvidence: request.admissionEvidence,
      persistMode: "defer",
    });
    await assert.rejects(
      acceptChallengedArtifactSubmission({
        backend,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint,
        request,
        proof,
        finalizedStagedArtifactReference: artifactDir,
        principalId: principal.principalId,
        keyId: challenge.keyId,
        proofSecret: principal.proofSecret,
        proofKeyRegistry: registry({ keyId: "reviewed-key", status: "disabled" }),
        snapshot: prepared.snapshot,
        submission: prepared.submission,
        refs: {
          submissionPath: prepared.submissionPath,
          executionSnapshotPath: prepared.executionSnapshotPath,
        },
      }),
      /disabled/,
    );
    assert.equal(await countBackendRows(backend, "queue"), 0);
    assert.equal(
      (await queryBackend<any>(backend, "SELECT used_at FROM artifact_challenges")).rows[0]
        ?.used_at,
      null,
    );
  });
});
