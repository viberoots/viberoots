#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  createDeploymentArtifactChallenge,
  deploymentServicePrincipalForToken,
} from "../../deployments/deployment-artifact-challenges.ts";
import { acceptChallengedArtifactSubmission } from "../../deployments/deployment-artifact-submit-transaction.ts";
import { fingerprintControlPlanePayload } from "../../deployments/deployment-control-plane-idempotency.ts";
import { serviceSubmissionAdmissionEvidence } from "../../deployments/deployment-service-client-contract.ts";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db.ts";
import { prepareBackendNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane-backend-prepare.ts";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  challengedSubmitProof,
  challengedSubmitRequest,
  countBackendRows,
} from "./nixos-shared-host.challenged-submit.helpers.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import { readJson, writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers.ts";

const TOKEN = "challenged-submit-token";

test("challenged submit retries reuse the accepted transaction and keep audit output redacted", async () => {
  await runInTemp("nixos-shared-host-challenged-submit-retry", async (tmp, $) => {
    const artifactDir = path.join(tmp, "artifact");
    await writeDemoArtifact(artifactDir);
    const request = await challengedSubmitRequest(artifactDir, "retry-key");
    await ensureNixosSharedHostStageBranch(tmp, $, request.deployment);
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const backend = {
      recordsRoot: paths.recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    };
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: backend.databaseUrl,
      token: TOKEN,
    });
    try {
      const challenge = await readJson<any>(
        await fetch(new URL("/api/v1/submission-challenges/artifact", controlPlane.url), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify(request),
        }),
      );
      const body = {
        ...request,
        artifactBindingProof: challengedSubmitProof(request, challenge, TOKEN),
      };
      const submit = () =>
        fetch(new URL("/api/v1/submissions", controlPlane.url), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify(body),
        });
      const accepted = await readJson<any>(await submit());
      const retried = await readJson<any>(await submit());
      assert.equal(retried.submissionId, accepted.submissionId);
      assert.equal(
        await countBackendRows(backend, "queue", `submission_id = '${request.submissionId}'`),
        1,
      );
      assert.equal(accepted.lifecycleState, "waiting_for_lock");
      assert.equal(accepted.artifactBinding.challengeId, challenge.challengeId);
      assert.equal(accepted.artifactBinding.verificationDecision, "accepted");
      assert.equal(
        accepted.artifactBinding.expectedIdentities.expectedArtifactIdentity,
        request.expectedArtifactIdentity,
      );
      assert.equal(
        accepted.artifactBinding.admittedIdentities.expectedArtifactIdentity,
        request.expectedArtifactIdentity,
      );
      const statusUrl = new URL("/api/v1/status", controlPlane.url);
      statusUrl.searchParams.set("submissionId", request.submissionId);
      const status = await readJson<any>(
        await fetch(statusUrl, { headers: { authorization: `Bearer ${TOKEN}` } }),
      );
      const publicJson = JSON.stringify({ accepted, status });
      assert.doesNotMatch(publicJson, new RegExp(TOKEN));
      assert.doesNotMatch(publicJson, new RegExp(body.artifactBindingProof.mac));
      assert.doesNotMatch(publicJson, new RegExp(challenge.nonce));
      assert.doesNotMatch(
        publicJson,
        new RegExp(artifactDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      const otherChallenge = await readJson<any>(
        await fetch(new URL("/api/v1/submission-challenges/artifact", controlPlane.url), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify(request),
        }),
      );
      const conflict = await fetch(new URL("/api/v1/submissions", controlPlane.url), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          ...request,
          artifactBindingProof: challengedSubmitProof(request, otherChallenge, TOKEN),
        }),
      });
      assert.equal(conflict.ok, false);
      assert.match(await conflict.text(), /idempotency key does not match/);
      assert.equal(
        (
          await queryBackend<any>(
            backend,
            "SELECT used_at FROM artifact_challenges WHERE challenge_id = $1",
            [otherChallenge.challengeId],
          )
        ).rows[0]?.used_at,
        null,
      );
    } finally {
      await controlPlane.close();
    }
  });
});

test("failed challenged accept rolls back challenge consumption and idempotency state", async () => {
  await runInTemp("nixos-shared-host-challenged-submit-rollback", async (tmp, $) => {
    const artifactDir = path.join(tmp, "artifact");
    await writeDemoArtifact(artifactDir);
    const request = await challengedSubmitRequest(artifactDir, "crash-window-key");
    await ensureNixosSharedHostStageBranch(tmp, $, request.deployment);
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const backend = {
      recordsRoot: paths.recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    };
    const principal = deploymentServicePrincipalForToken();
    const challenge = await createDeploymentArtifactChallenge({
      backend,
      request,
      principalId: principal.principalId,
      keyId: principal.keyId,
    });
    const body = {
      ...request,
      artifactBindingProof: challengedSubmitProof(request, challenge),
    };
    const requestFingerprint = fingerprintControlPlanePayload({
      ...body,
      submittedAt: body.submittedAt,
    });
    const prepared = await prepareBackendNixosSharedHostControlPlaneRun({
      workspaceRoot: tmp,
      operationKind: body.operationKind,
      deployment: body.deployment,
      paths,
      backend,
      submissionId: body.submissionId,
      dedupe: { mode: "created", requestFingerprint, idempotencyKey: body.idempotencyKey },
      requestedBy: body.admissionEvidence.requestedBy,
      artifactDir: body.artifactDir,
      expectedArtifactIdentity: body.expectedArtifactIdentity,
      admissionEvidence: body.admissionEvidence,
      persistMode: "defer",
    });
    await queryBackend(
      backend,
      "INSERT INTO snapshots (submission_id, execution_snapshot_path, document_json, updated_at) VALUES ($1, $2, $3::jsonb, $4)",
      [
        body.submissionId,
        "conflict",
        JSON.stringify({ submissionId: body.submissionId }),
        new Date().toISOString(),
      ],
    );
    const accept = () =>
      acceptChallengedArtifactSubmission({
        backend,
        idempotencyKey: body.idempotencyKey,
        requestFingerprint,
        request: body,
        proof: body.artifactBindingProof,
        finalizedStagedArtifactReference: body.artifactDir,
        principalId: principal.principalId,
        keyId: principal.keyId,
        proofSecret: principal.proofSecret,
        snapshot: prepared.snapshot,
        submission: prepared.submission,
        refs: {
          submissionPath: prepared.submissionPath,
          executionSnapshotPath: prepared.executionSnapshotPath,
        },
      });
    await assert.rejects(accept, /already exists/i);
    assert.equal(await countBackendRows(backend, "idempotency"), 0);
    assert.equal(await countBackendRows(backend, "queue"), 0);
    assert.equal(
      (
        await queryBackend<any>(
          backend,
          "SELECT used_at FROM artifact_challenges WHERE challenge_id = $1",
          [challenge.challengeId],
        )
      ).rows[0]?.used_at,
      null,
    );
    await queryBackend(backend, "DELETE FROM snapshots WHERE submission_id = $1", [
      body.submissionId,
    ]);
    const accepted = await accept();
    assert.equal(accepted.submission.lifecycleState, "waiting_for_lock");
  });
});
