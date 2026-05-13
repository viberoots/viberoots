#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { createNixosSharedHostSubmissionId } from "../../deployments/nixos-shared-host-control-plane-snapshot";
import { runInTemp } from "../lib/test-helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { readJson, writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";
import {
  authRequiredDeployment,
  evidenceWithoutPrincipal,
  postSubmission,
  withArtifactBinding,
  writeAuthSession,
} from "./nixos-shared-host.service-auth-boundary.helpers";

function casePaths(tmp: string, name: string) {
  const root = path.join(tmp, name);
  return {
    statePath: path.join(root, "platform-state.json"),
    hostRoot: path.join(root, "host"),
    recordsRoot: path.join(root, "records"),
  };
}

test("auth-required protected/shared service auth boundaries", async (t) => {
  await runInTemp("nixos-service-auth-boundaries", async (tmp, $) => {
    const deployment = authRequiredDeployment();
    const artifactDir = path.join(tmp, "artifact");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    await writeDemoArtifact(artifactDir);

    await t.test("submissions derive principal from service session", async () => {
      const paths = casePaths(tmp, "submit-boundary");
      const controlPlane = await startNixosSharedHostControlPlaneServer({
        workspaceRoot: tmp,
        paths,
        backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
        localFixture: true,
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

    await t.test("submissions reject missing, forged, bad-role, and expired auth", async () => {
      const paths = casePaths(tmp, "rejections");
      const controlPlane = await startNixosSharedHostControlPlaneServer({
        workspaceRoot: tmp,
        paths,
        backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
        localFixture: true,
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

    await t.test("run actions derive operator from service session", async () => {
      const paths = casePaths(tmp, "run-action");
      const controlPlane = await startNixosSharedHostControlPlaneServer({
        workspaceRoot: tmp,
        paths,
        backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
        localFixture: true,
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
});
