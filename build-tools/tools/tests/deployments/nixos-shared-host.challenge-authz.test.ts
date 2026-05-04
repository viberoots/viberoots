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
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { createNixosSharedHostSubmissionId } from "../../deployments/nixos-shared-host-control-plane-snapshot";
import { runInTemp } from "../lib/test-helpers";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";
import { readJson, writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";
import {
  authRequiredDeployment,
  evidenceWithoutPrincipal,
  writeAuthSession,
} from "./nixos-shared-host.service-auth-boundary.helpers";

async function challenge(url: string, body: any) {
  return await fetch(new URL("/api/v1/submission-challenges/artifact", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function challengeRows(backend: any) {
  const row = (
    await queryBackend<any>(backend, "SELECT COUNT(*) AS count FROM artifact_challenges")
  ).rows[0];
  return Number(row?.count || 0);
}

async function baseRequest(deployment: any, artifactDir: string) {
  return {
    schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
    submissionId: createNixosSharedHostSubmissionId(),
    submittedAt: new Date().toISOString(),
    deployment,
    operationKind: "deploy",
    artifactDir,
    admissionEvidence: evidenceWithoutPrincipal(deployment),
    ...(await expectedNixosSharedHostArtifactIdentities({ deployment, artifactDir })),
  };
}

test("challenge issuance rejects unauthorized auth-required requests before persistence", async () => {
  await runInTemp("nixos-challenge-authz-rejections", async (tmp, $) => {
    const deployment = authRequiredDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: `${tmp}/state.json`,
      hostRoot: `${tmp}/host`,
      recordsRoot: `${tmp}/records`,
    };
    const backend = {
      recordsRoot: paths.recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    };
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: backend.databaseUrl,
      localFixture: true,
    });
    try {
      const request = await baseRequest(deployment, artifactDir);
      assert.equal((await challenge(controlPlane.url, request)).status, 403);
      assert.equal(await challengeRows(backend), 0);
      const badRole = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:approver",
        role: "approver",
      });
      assert.equal(
        (await challenge(controlPlane.url, { ...request, authSessionId: badRole })).status,
        403,
      );
      assert.equal(await challengeRows(backend), 0);
      const submitter = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:submitter",
        role: "submitter",
      });
      const issued = await readJson<any>(
        await challenge(controlPlane.url, { ...request, authSessionId: submitter }),
      );
      assert.match(issued.challengeId, /^artifact-challenge-/);
      assert.equal(await challengeRows(backend), 1);
    } finally {
      await controlPlane.close();
    }
  });
});

test("final submit rejects auth principal drift without consuming the challenge", async () => {
  await runInTemp("nixos-challenge-authz-drift", async (tmp, $) => {
    const deployment = authRequiredDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: `${tmp}/state.json`,
      hostRoot: `${tmp}/host`,
      recordsRoot: `${tmp}/records`,
    };
    const backend = {
      recordsRoot: paths.recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    };
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: backend.databaseUrl,
      localFixture: true,
    });
    try {
      const request = await baseRequest(deployment, artifactDir);
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
      const challengedRequest = { ...request, authSessionId: authA };
      const issued = await readJson<any>(await challenge(controlPlane.url, challengedRequest));
      const principal = deploymentServicePrincipalForToken();
      const proof = createArtifactBindingProof(
        artifactBindingEnvelope({
          request: challengedRequest,
          principalId: principal.principalId,
          keyId: issued.keyId,
          challengeId: issued.challengeId,
          nonce: issued.nonce,
          finalizedStagedArtifactReference: artifactDir,
        }),
        principal.proofSecret,
      );
      const drifted = await fetch(new URL("/api/v1/submissions", controlPlane.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, authSessionId: authB, artifactBindingProof: proof }),
      });
      assert.equal(drifted.ok, false);
      assert.match(await drifted.text(), /authorization binding mismatch/);
      assert.equal(await challengeRows(backend), 1);
      const accepted = await readJson<any>(
        await fetch(new URL("/api/v1/submissions", controlPlane.url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...challengedRequest, artifactBindingProof: proof }),
        }),
      );
      assert.equal(accepted.lifecycleState, "waiting_for_lock");
    } finally {
      await controlPlane.close();
    }
  });
});
