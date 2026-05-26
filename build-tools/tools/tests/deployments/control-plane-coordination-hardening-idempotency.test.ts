#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fingerprintControlPlanePayload } from "../../deployments/deployment-control-plane-idempotency";
import { handleControlPlaneSubmit } from "../../deployments/nixos-shared-host-control-plane-service-api";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract";
import {
  localHarnessControlPlaneDatabaseUrl,
  readBackendSubmissionBySubmissionId,
  resolveBackendIdempotency,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";
import { runInTemp } from "../lib/test-helpers";

function submitFingerprint(request: Record<string, unknown>) {
  const {
    submissionId: _submissionId,
    submittedAt: _submittedAt,
    authSessionId: _authSessionId,
    artifactBindingProof: _artifactBindingProof,
    ...stable
  } = request;
  return fingerprintControlPlanePayload(stable);
}

test("normal submit retry resumes after crash following idempotency durability", async () => {
  await runInTemp("control-plane-submit-idempotency-crash-retry", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const backend = {
      recordsRoot: paths.recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
    };
    const admissionEvidence = reviewedLaneAdmissionEvidenceFixture({ deployment }) as any;
    delete admissionEvidence.requestedBy;
    const artifactDir = path.join(tmp, "artifact");
    await writeDemoArtifact(artifactDir);
    const request = {
      schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
      submissionId: "retry-generated-submission",
      submittedAt: "2026-05-01T10:00:00.000Z",
      deployment,
      operationKind: "deploy" as const,
      idempotencyKey: "normal-submit-after-crash",
      artifactDir,
      admissionEvidence,
    };
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    await resolveBackendIdempotency({
      backend,
      kind: "submit",
      key: request.idempotencyKey,
      requestFingerprint: submitFingerprint({
        ...request,
        submissionId: "durable-original-submission",
      }),
      targetId: "durable-original-submission",
    });
    const submitted = await handleControlPlaneSubmit(request, {
      workspaceRoot: tmp,
      paths,
      backend,
      localFixture: true,
    });
    assert.equal(submitted.submissionId, "durable-original-submission");
    assert.equal(submitted.lifecycleState, "waiting_for_lock");
    assert.ok(await readBackendSubmissionBySubmissionId(backend, submitted.submissionId));
    assert.equal(await readBackendSubmissionBySubmissionId(backend, request.submissionId), null);
  });
});
