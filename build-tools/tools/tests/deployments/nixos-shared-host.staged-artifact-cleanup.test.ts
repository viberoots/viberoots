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
import { serviceSubmissionAdmissionEvidence } from "../../deployments/deployment-service-client-contract";
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
import { authRequiredDeployment } from "./nixos-shared-host.service-auth-boundary.helpers";
import { readJson, writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";

const TOKEN = "cleanup-token";

async function writeStagedArtifact(hostRoot: string, name: string) {
  const artifactDir = path.join(hostRoot, ".deploy-artifacts", "fixture", name);
  await writeDemoArtifact(artifactDir);
  await fsp.writeFile(
    stagedUploadCompleteMarkerPath(artifactDir),
    '{"schemaVersion":"nixos-shared-host-staged-upload@1"}\n',
    "utf8",
  );
  return artifactDir;
}

async function baseRequest(deployment: any, artifactDir: string) {
  return {
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
}

async function janitorRecords(backend: any) {
  return (
    await queryBackend<any>(
      backend,
      "SELECT document_json FROM artifact_cleanup_janitor_records ORDER BY created_at DESC",
    )
  ).rows.map((row) => row.document_json);
}

test("service removes rejected staged artifacts during challenge authorization failure", async () => {
  await runInTemp("nixos-staged-cleanup-challenge", async (tmp, $) => {
    const deployment = authRequiredDeployment();
    const paths = {
      statePath: path.join(tmp, "state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const backend = {
      recordsRoot: paths.recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    };
    const artifactDir = await writeStagedArtifact(paths.hostRoot, "authz");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: backend.databaseUrl,
      localFixture: true,
    });
    try {
      const response = await fetch(
        new URL("/api/v1/submission-challenges/artifact", controlPlane.url),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(await baseRequest(deployment, artifactDir)),
        },
      );
      assert.equal(response.status, 403);
      await assert.rejects(fsp.access(artifactDir));
      assert.deepEqual(await janitorRecords(backend), []);
    } finally {
      await controlPlane.close();
    }
  });
});

test("service records redacted janitor metadata when rejected cleanup fails", async () => {
  await runInTemp("nixos-staged-cleanup-janitor", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const paths = {
      statePath: path.join(tmp, "state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const backend = {
      recordsRoot: paths.recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    };
    const artifactDir = await writeStagedArtifact(paths.hostRoot, "janitor-artifact");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: backend.databaseUrl,
      token: TOKEN,
    });
    const parent = path.dirname(artifactDir);
    try {
      const request = await baseRequest(deployment, artifactDir);
      const challenge = await readJson<any>(
        await fetch(new URL("/api/v1/submission-challenges/artifact", controlPlane.url), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify(request),
        }),
      );
      const principal = deploymentServicePrincipalForToken(TOKEN);
      const badProof = createArtifactBindingProof(
        artifactBindingEnvelope({
          request,
          principalId: principal.principalId,
          keyId: challenge.keyId,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          finalizedStagedArtifactReference: `${artifactDir}-different`,
        }),
        principal.proofSecret,
      );
      await fsp.chmod(parent, 0o500);
      const rejected = await fetch(new URL("/api/v1/submissions", controlPlane.url), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ ...request, artifactBindingProof: badProof }),
      });
      assert.equal(rejected.ok, false);
      const records = await janitorRecords(backend);
      assert.equal(records.length, 1);
      const recordText = JSON.stringify(records[0]);
      assert.match(recordText, /submit_rejected/);
      assert.doesNotMatch(
        recordText,
        new RegExp(artifactDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      assert.doesNotMatch(recordText, /cleanup-token|nonce|proof/i);
    } finally {
      await fsp.chmod(parent, 0o700).catch(() => {});
      await controlPlane.close();
    }
  });
});
