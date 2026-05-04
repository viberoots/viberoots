#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  artifactBindingEnvelope,
  createArtifactBindingProof,
  expectedNixosSharedHostArtifactIdentities,
} from "../../deployments/deployment-artifact-binding";
import { deploymentServicePrincipalForToken } from "../../deployments/deployment-artifact-challenges";
import { serviceSubmissionAdmissionEvidence } from "../../deployments/deployment-service-client-contract";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { createNixosSharedHostSubmissionId } from "../../deployments/nixos-shared-host-control-plane-snapshot";
import { runInTemp } from "../lib/test-helpers";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { multiComponentDeployment } from "./nixos-shared-host.multi-component.fixture";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { readJson, writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";

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

async function challengeRows(recordsRoot: string) {
  const row = (
    await queryBackend<any>(
      {
        recordsRoot,
        databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
      },
      "SELECT COUNT(*) AS count FROM artifact_challenges",
    )
  ).rows[0];
  return Number(row?.count || 0);
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
        /expectedArtifactIdentity/,
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

test("challenge issuance rejects missing required expected artifact identities before persistence", async () => {
  await runInTemp("nixos-shared-host-artifact-binding-required-identities", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot,
    };
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
      token: TOKEN,
    });
    try {
      const singleDeployment = nixosSharedHostDeploymentFixture();
      const singleArtifact = path.join(tmp, "artifact-single");
      await writeDemoArtifact(singleArtifact);
      await ensureNixosSharedHostStageBranch(tmp, $, singleDeployment);
      const singleRequest = {
        schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
        submissionId: createNixosSharedHostSubmissionId(),
        submittedAt: new Date().toISOString(),
        deployment: singleDeployment,
        operationKind: "deploy",
        artifactDir: singleArtifact,
        ...(await expectedNixosSharedHostArtifactIdentities({
          deployment: singleDeployment,
          artifactDir: singleArtifact,
        })),
        admissionEvidence: serviceSubmissionAdmissionEvidence(
          reviewedLaneAdmissionEvidenceFixture({ deployment: singleDeployment }),
        ),
      };
      const singleRejected = await fetch(
        new URL("/api/v1/submission-challenges/artifact", controlPlane.url),
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ ...singleRequest, expectedArtifactIdentity: undefined }),
        },
      );
      assert.equal(singleRejected.ok, false);
      assert.match(await singleRejected.text(), /expectedArtifactIdentity/);
      assert.equal(await challengeRows(recordsRoot), 0);

      const multiDeployment = multiComponentDeployment();
      const frontend = path.join(tmp, "artifact-frontend");
      const api = path.join(tmp, "artifact-api");
      await writeDemoArtifact(frontend, "frontend");
      await writeDemoArtifact(api, "api");
      await ensureNixosSharedHostStageBranch(tmp, $, multiDeployment);
      const multiRequest = {
        schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
        submissionId: createNixosSharedHostSubmissionId(),
        submittedAt: new Date().toISOString(),
        deployment: multiDeployment,
        operationKind: "deploy",
        artifactDirsByComponentId: { frontend, api },
        ...(await expectedNixosSharedHostArtifactIdentities({
          deployment: multiDeployment,
          artifactDirsByComponentId: { frontend, api },
        })),
        admissionEvidence: serviceSubmissionAdmissionEvidence(
          reviewedLaneAdmissionEvidenceFixture({ deployment: multiDeployment }),
        ),
      };
      const multiRejected = await fetch(
        new URL("/api/v1/submission-challenges/artifact", controlPlane.url),
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ ...multiRequest, expectedCompositeArtifactIdentity: undefined }),
        },
      );
      assert.equal(multiRejected.ok, false);
      assert.match(await multiRejected.text(), /expectedCompositeArtifactIdentity/);
      assert.equal(await challengeRows(recordsRoot), 0);
    } finally {
      await controlPlane.close();
    }
  });
});
