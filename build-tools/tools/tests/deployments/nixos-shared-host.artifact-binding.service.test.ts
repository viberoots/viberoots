#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  artifactBindingEnvelope,
  createArtifactBindingProof,
  expectedNixosSharedHostArtifactIdentities,
} from "../../deployments/deployment-artifact-binding.ts";
import { deploymentServicePrincipalForToken } from "../../deployments/deployment-artifact-challenges.ts";
import { serviceSubmissionAdmissionEvidence } from "../../deployments/deployment-service-client-contract.ts";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract.ts";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server.ts";
import { createNixosSharedHostSubmissionId } from "../../deployments/nixos-shared-host-control-plane-snapshot.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture.ts";
import { readJson, writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers.ts";

const TOKEN = "artifact-binding-token";

async function submit(url: string, request: any, token = TOKEN) {
  return await fetch(new URL("/api/v1/submissions", url), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
  });
}

async function challenge(url: string, request: any, token = TOKEN) {
  return await readJson<any>(
    await fetch(new URL("/api/v1/submission-challenges/artifact", url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(request),
    }),
  );
}

test("protected/shared service uploads require challenge-bound artifact proofs", async () => {
  await runInTemp("nixos-shared-host-artifact-binding", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
      token: TOKEN,
    });
    try {
      const request = {
        schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
        submissionId: createNixosSharedHostSubmissionId(),
        submittedAt: new Date().toISOString(),
        deployment,
        operationKind: "deploy",
        artifactDir,
        ...(await expectedNixosSharedHostArtifactIdentities({ deployment, artifactDir })),
        admissionEvidence: serviceSubmissionAdmissionEvidence(
          reviewedLaneAdmissionEvidenceFixture({ deployment }),
        ),
      };
      assert.equal(
        (
          await fetch(new URL("/api/v1/submission-challenges/artifact", controlPlane.url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
          })
        ).status,
        401,
      );
      assert.match(
        await (
          await submit(controlPlane.url, { ...request, expectedArtifactIdentity: undefined })
        ).text(),
        /expected artifact identity/,
      );
      assert.match(
        await (await submit(controlPlane.url, request)).text(),
        /artifact submission challenge is required/,
      );
      const issued = await challenge(controlPlane.url, request);
      const principal = deploymentServicePrincipalForToken(TOKEN);
      const proof = createArtifactBindingProof(
        artifactBindingEnvelope({
          request,
          principalId: principal.principalId,
          keyId: issued.keyId,
          challengeId: issued.challengeId,
          nonce: issued.nonce,
          finalizedStagedArtifactReference: `${artifactDir}-different`,
        }),
        principal.proofSecret,
      );
      assert.match(
        await (await submit(controlPlane.url, { ...request, artifactBindingProof: proof })).text(),
        /fingerprint mismatch|verification failed/,
      );
      const goodProof = createArtifactBindingProof(
        artifactBindingEnvelope({
          request,
          principalId: principal.principalId,
          keyId: issued.keyId,
          challengeId: issued.challengeId,
          nonce: issued.nonce,
          finalizedStagedArtifactReference: artifactDir,
        }),
        principal.proofSecret,
      );
      const accepted = await readJson<any>(
        await submit(controlPlane.url, { ...request, artifactBindingProof: goodProof }),
      );
      assert.equal(accepted.lifecycleState, "waiting_for_lock");
    } finally {
      await controlPlane.close();
    }
  });
});
