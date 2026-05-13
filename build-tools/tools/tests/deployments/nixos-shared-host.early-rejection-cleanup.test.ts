#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  artifactBindingEnvelope,
  createArtifactBindingProof,
  expectedNixosSharedHostArtifactIdentities,
} from "../../deployments/deployment-artifact-binding";
import { deploymentServicePrincipalForToken } from "../../deployments/deployment-artifact-challenges";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { createNixosSharedHostSubmissionId } from "../../deployments/nixos-shared-host-control-plane-snapshot";
import { stagedUploadCompleteMarkerPath } from "../../deployments/nixos-shared-host-staged-artifact";
import { runInTemp } from "../lib/test-helpers";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { readJson, writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";
import {
  authRequiredDeployment,
  evidenceWithoutPrincipal,
  writeAuthSession,
} from "./nixos-shared-host.service-auth-boundary.helpers";

const TOKEN = "early-cleanup-token";

async function writeStagedArtifact(hostRoot: string, name: string) {
  const artifactDir = path.join(hostRoot, ".deploy-artifacts", "fixture", name);
  await writeDemoArtifact(artifactDir, name);
  await fsp.writeFile(
    stagedUploadCompleteMarkerPath(artifactDir),
    '{"schemaVersion":"nixos-shared-host-staged-upload@1"}\n',
    "utf8",
  );
  return artifactDir;
}

async function janitorRecords(recordsRoot: string) {
  return (
    await queryBackend<any>(
      {
        recordsRoot,
        databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
      },
      "SELECT document_json FROM artifact_cleanup_janitor_records ORDER BY created_at DESC",
    )
  ).rows.map((row) => row.document_json);
}

test("bearer-token rejection during challenge issuance still cleans staged artifacts", async () => {
  await runInTemp("nixos-early-cleanup-token-rejection", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const paths = {
      statePath: path.join(tmp, "state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const artifactDir = await writeStagedArtifact(paths.hostRoot, "missing-token");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
      token: TOKEN,
    });
    try {
      const response = await fetch(
        new URL("/api/v1/submission-challenges/artifact", controlPlane.url),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
            submissionId: createNixosSharedHostSubmissionId(),
            submittedAt: new Date().toISOString(),
            deployment,
            operationKind: "deploy",
            artifactDir,
            ...(await expectedNixosSharedHostArtifactIdentities({ deployment, artifactDir })),
            admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
          }),
        },
      );
      assert.equal(response.status, 401);
      await assert.rejects(fsp.access(artifactDir));
      assert.deepEqual(await janitorRecords(paths.recordsRoot), []);
    } finally {
      await controlPlane.close();
    }
  });
});

test("final-submit auth-boundary rejection still cleans staged artifacts before accept", async () => {
  await runInTemp("nixos-early-cleanup-submit-auth", async (tmp, $) => {
    const deployment = authRequiredDeployment();
    const paths = {
      statePath: path.join(tmp, "state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const artifactDir = await writeStagedArtifact(paths.hostRoot, "submit-auth");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
      token: TOKEN,
    });
    try {
      const authA = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:submitter-a",
        role: "submitter",
      });
      const authB = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:submitter-b",
        role: "submitter",
      });
      const request = {
        schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
        submissionId: createNixosSharedHostSubmissionId(),
        submittedAt: new Date().toISOString(),
        deployment,
        operationKind: "deploy",
        authSessionId: authA,
        artifactDir,
        ...(await expectedNixosSharedHostArtifactIdentities({ deployment, artifactDir })),
        admissionEvidence: evidenceWithoutPrincipal(deployment),
      };
      const challenge = await readJson<any>(
        await fetch(new URL("/api/v1/submission-challenges/artifact", controlPlane.url), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify(request),
        }),
      );
      const principal = deploymentServicePrincipalForToken(TOKEN);
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
      const rejected = await fetch(new URL("/api/v1/submissions", controlPlane.url), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ ...request, authSessionId: authB, artifactBindingProof: proof }),
      });
      assert.equal(rejected.status, 403);
      await assert.rejects(fsp.access(artifactDir));
      assert.deepEqual(await janitorRecords(paths.recordsRoot), []);
    } finally {
      await controlPlane.close();
    }
  });
});
