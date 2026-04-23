#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract.ts";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server.ts";
import { createNixosSharedHostSubmissionId } from "../../deployments/nixos-shared-host-control-plane-snapshot.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import { readJson, writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers.ts";
import {
  authRequiredDeployment,
  evidenceWithoutPrincipal,
  postSubmission,
  withArtifactBinding,
  writeAuthSession,
} from "./nixos-shared-host.service-auth-boundary.helpers.ts";

test("auth-required protected/shared submissions derive principal from service session", async () => {
  await runInTemp("nixos-service-auth-submit-boundary", async (tmp, $) => {
    const deployment = authRequiredDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDemoArtifact(artifactDir);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    });
    try {
      const authSessionId = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:submitter",
        role: "submitter",
      });
      const submitted = await readJson<any>(
        await postSubmission(
          controlPlane.url,
          await withArtifactBinding(controlPlane.url, {
            schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
            submissionId: createNixosSharedHostSubmissionId(),
            submittedAt: new Date().toISOString(),
            deployment,
            operationKind: "deploy",
            authSessionId,
            artifactDir,
            admissionEvidence: evidenceWithoutPrincipal(deployment),
          }),
        ),
      );
      assert.equal(submitted.requestedBy.principalId, "oidc:submitter");
      assert.equal(submitted.authorization.principal.principalId, "oidc:submitter");
    } finally {
      await controlPlane.close();
    }
  });
});

test("auth-required protected/shared submissions reject missing, forged, bad-role, and expired auth", async () => {
  await runInTemp("nixos-service-auth-rejections", async (tmp, $) => {
    const deployment = authRequiredDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDemoArtifact(artifactDir);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    });
    try {
      const base = {
        schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
        submittedAt: new Date().toISOString(),
        deployment,
        operationKind: "deploy",
        artifactDir,
        admissionEvidence: evidenceWithoutPrincipal(deployment),
      };
      const missing = await postSubmission(controlPlane.url, {
        ...(await withArtifactBinding(controlPlane.url, {
          ...base,
          submissionId: createNixosSharedHostSubmissionId(),
        })),
      });
      assert.equal(missing.status, 403);
      const forgedSession = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:submitter",
        role: "submitter",
      });
      const forged = await postSubmission(controlPlane.url, {
        ...(await withArtifactBinding(controlPlane.url, {
          ...base,
          submissionId: createNixosSharedHostSubmissionId(),
          authSessionId: forgedSession,
          requestedBy: { principalId: "user:forged" },
        })),
      });
      assert.equal(forged.status, 403);
      const badRole = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:approver",
        role: "approver",
      });
      const unauthorized = await postSubmission(controlPlane.url, {
        ...(await withArtifactBinding(controlPlane.url, {
          ...base,
          submissionId: createNixosSharedHostSubmissionId(),
          authSessionId: badRole,
        })),
      });
      assert.equal(unauthorized.status, 403);
      const expiredSession = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:submitter-expired",
        role: "submitter",
        expired: true,
      });
      const expired = await postSubmission(controlPlane.url, {
        ...(await withArtifactBinding(controlPlane.url, {
          ...base,
          submissionId: createNixosSharedHostSubmissionId(),
          authSessionId: expiredSession,
        })),
      });
      assert.equal(expired.status, 403);
    } finally {
      await controlPlane.close();
    }
  });
});

test("auth-required run actions derive operator from service session", async () => {
  await runInTemp("nixos-service-auth-run-action", async (tmp, $) => {
    const deployment = authRequiredDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDemoArtifact(artifactDir);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    });
    try {
      const submitAuth = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "deploy",
        principalId: "oidc:submitter",
        role: "submitter",
      });
      const pending = await readJson<any>(
        await postSubmission(
          controlPlane.url,
          await withArtifactBinding(controlPlane.url, {
            schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
            submissionId: createNixosSharedHostSubmissionId(),
            submittedAt: new Date().toISOString(),
            deployment,
            operationKind: "deploy",
            authSessionId: submitAuth,
            artifactDir,
            admissionEvidence: evidenceWithoutPrincipal(deployment),
          }),
        ),
      );
      assert(["queued", "waiting_for_lock"].includes(pending.lifecycleState));
      const cancelAuth = await writeAuthSession({
        recordsRoot: paths.recordsRoot,
        deployment,
        operationKind: "cancel",
        principalId: "oidc:operator",
        role: "operator",
      });
      const cancelled = await readJson<any>(
        await fetch(new URL("/api/v1/run-actions", controlPlane.url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: "deployment-control-plane-run-action-request@1",
            actionId: "cancel-auth-session",
            submittedAt: new Date().toISOString(),
            submissionId: pending.submissionId,
            action: "cancel",
            authSessionId: cancelAuth,
          }),
        }),
      );
      assert.equal(cancelled.lifecycleState, "cancelled");
      assert.equal(cancelled.authorization.principal.principalId, "oidc:operator");
      assert.equal(cancelled.latestAction.requestedBy.principalId, "oidc:operator");
    } finally {
      await controlPlane.close();
    }
  });
});
