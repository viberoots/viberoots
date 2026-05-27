#!/usr/bin/env zx-wrapper
import { defaultRequestedBy } from "./deployment-admission-evidence";
import { createAdmissionFailureSubmission } from "./nixos-shared-host-control-plane-admission-failure";
import { evaluateNixosSharedHostControlPlaneAdmission } from "./nixos-shared-host-control-plane-admission";
import { queueBackendSubmissionForLock } from "./nixos-shared-host-control-plane-backend-submit";
import {
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import type { NixosSharedHostDeployment } from "./contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import type { DeploymentLaneGovernanceResolver } from "./deployment-lane-governance-resolution";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneServiceInstance,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract";
import type {
  NixosSharedHostControlPlaneOperationKind,
  NixosSharedHostControlPlanePaths,
  NixosSharedHostControlPlaneSubmission,
  NixosSharedHostPublishBehavior,
  NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract";
import { assertExpectedArtifactIdentities } from "./nixos-shared-host-control-plane-artifact-identity";
import { ensureNoActiveProgressiveRun } from "./nixos-shared-host-control-plane-progressive-guard";
import { createNixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-submission";
import {
  createNixosSharedHostControlPlaneSnapshot,
  createNixosSharedHostSubmissionId,
  type NixosSharedHostControlPlaneSourceSelection,
} from "./nixos-shared-host-control-plane-snapshot";
import {
  executionSnapshotPathFor,
  submissionPathFor,
} from "./nixos-shared-host-control-plane-store";
import { writeNixosSharedHostProvisionerPlan } from "./nixos-shared-host-provisioner-plan";
import { createNixosSharedHostDeployRunId } from "./nixos-shared-host-records";
import { reviewedCurrentStageExpectation } from "./deployment-current-stage-state-expected";
import {
  cleanupReviewedSourceSnapshot,
  snapshotReviewedSourceForSubmission,
} from "./nixos-shared-host-reviewed-source-snapshot";
import { requestedReviewedSourceFromEvidence } from "./deployment-source-revision";
import { putVerifiedArtifactObject } from "./control-plane-artifact-store";
import { writeBackendSnapshotArtifactObjects } from "./control-plane-artifact-snapshot-metadata";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
import type { ReviewedSourceCredentialFiles } from "./nixos-shared-host-reviewed-source-git";
import {
  assertMiniCloudMigrationPreflight,
  type MiniCloudMigrationEvidence,
} from "./control-plane-mini-migration-preflight";

export async function prepareBackendNixosSharedHostControlPlaneRun(opts: {
  workspaceRoot: string;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionId?: string;
  dedupe: DeploymentControlPlaneRequestDedupe;
  requestedBy?: NixosSharedHostControlPlaneSubmission["requestedBy"];
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  authorizationSnapshot?: DeploymentControlPlaneAuthorization;
  deployBatchId?: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  expectedArtifactIdentity?: string;
  expectedComponentArtifactIdentities?: Record<string, string>;
  expectedCompositeArtifactIdentity?: string;
  expectedSourceRevision?: string;
  artifact?: any;
  componentArtifacts?: any[];
  publishBehavior?: NixosSharedHostPublishBehavior;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
  source?: NixosSharedHostControlPlaneSourceSelection;
  admissionEvidence?: DeploymentAdmissionEvidence;
  governanceResolver?: DeploymentLaneGovernanceResolver;
  persistMode?: "immediate" | "defer";
  serviceInstance?: DeploymentControlPlaneServiceInstance;
  objectStore?: ControlPlaneArtifactStore;
  reviewedSourceCredentials?: ReviewedSourceCredentialFiles;
  miniMigrationPreflight?: {
    enabled: boolean;
    evidence?: Partial<MiniCloudMigrationEvidence>;
  };
}) {
  const submissionId = opts.submissionId || createNixosSharedHostSubmissionId();
  const requestedBy =
    opts.requestedBy || opts.admissionEvidence?.requestedBy || defaultRequestedBy();
  const requestedReviewedSource = requestedReviewedSourceFromEvidence(opts.admissionEvidence);
  const reviewedSourceCredentials = opts.reviewedSourceCredentials;
  const reviewedSourceSnapshot =
    opts.operationKind !== "explicit_removal"
      ? await snapshotReviewedSourceForSubmission({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          submissionId,
          ...(opts.expectedSourceRevision
            ? { expectedSourceRevision: opts.expectedSourceRevision }
            : {}),
          ...(requestedReviewedSource?.ref
            ? { requestedSourceRef: requestedReviewedSource.ref }
            : {}),
          ...(reviewedSourceCredentials ? { reviewedSourceCredentials } : {}),
        })
      : undefined;
  const snapshot = await createNixosSharedHostControlPlaneSnapshot(
    {
      ...opts,
      deferSecretReferenceResolution: true,
      ...(reviewedSourceSnapshot ? { reviewedSourceSnapshot } : {}),
      ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
    },
    submissionId,
  );
  snapshot.expectedCurrentRunId = (
    await reviewedCurrentStageExpectation({ backend: opts.backend, deployment: opts.deployment })
  ).expectedCurrentRunId;
  const deployRunId = createNixosSharedHostDeployRunId();
  snapshot.provisionerPlan = await writeNixosSharedHostProvisionerPlan({ snapshot });
  const executionSnapshotPath = executionSnapshotPathFor(opts.paths.recordsRoot, submissionId);
  const submissionPath = submissionPathFor(opts.paths.recordsRoot, submissionId);
  const refs = {
    submissionPath,
    executionSnapshotPath,
  };
  const persistImmediately = opts.persistMode !== "defer";
  if (persistImmediately) {
    await writeBackendSnapshotDoc(opts.backend, snapshot, executionSnapshotPath);
  }
  try {
    assertExpectedArtifactIdentities(snapshot, {
      ...(opts.expectedArtifactIdentity
        ? { expectedArtifactIdentity: opts.expectedArtifactIdentity }
        : {}),
      ...(opts.expectedComponentArtifactIdentities
        ? { expectedComponentArtifactIdentities: opts.expectedComponentArtifactIdentities }
        : {}),
      ...(opts.expectedCompositeArtifactIdentity
        ? { expectedCompositeArtifactIdentity: opts.expectedCompositeArtifactIdentity }
        : {}),
    });
    await ensureNoActiveProgressiveRun(opts.paths.recordsRoot, snapshot.lockScope, submissionId, {
      backend: opts.backend,
    });
    if (opts.miniMigrationPreflight) {
      await assertMiniCloudMigrationPreflight({
        backend: opts.backend,
        ...opts.miniMigrationPreflight,
      });
    }
    await evaluateNixosSharedHostControlPlaneAdmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.paths.recordsRoot,
      backendDatabaseUrl: opts.backend.databaseUrl,
      deployment: opts.deployment,
      snapshot,
      source: opts.source,
      artifactLineageId: opts.artifactLineageId,
      admissionEvidence: opts.admissionEvidence,
      governanceResolver: opts.governanceResolver,
    });
    if (opts.objectStore) {
      (snapshot as any).executionSnapshotObject = await putVerifiedArtifactObject({
        store: opts.objectStore,
        body: Buffer.from(JSON.stringify(snapshot) + "\n"),
        payloadKind: "execution-snapshot",
        contentType: "application/json",
        provenance: { deploymentId: snapshot.deploymentId, submissionId },
      });
    }
    if (persistImmediately) {
      await writeBackendSnapshotDoc(opts.backend, snapshot, executionSnapshotPath);
      await writeBackendSnapshotArtifactObjects({ backend: opts.backend, snapshot });
    }
  } catch (error) {
    if (!persistImmediately) throw error;
    const submission = createAdmissionFailureSubmission({
      error,
      snapshot,
      executionSnapshotPath,
      deployRunId,
      dedupe: opts.dedupe,
      requestedBy,
      authorization: opts.authorization,
      authorizationSnapshot: opts.authorizationSnapshot,
      serviceInstance: opts.serviceInstance,
    });
    if (!submission) throw error;
    await writeBackendSubmissionDoc(opts.backend, submission, refs);
    await cleanupReviewedSourceSnapshot(opts.workspaceRoot, snapshot);
    throw Object.assign(error, { submission });
  }
  const submission = createNixosSharedHostControlPlaneSubmission(snapshot, executionSnapshotPath, {
    admission: { decision: "admitted", reason: "shared_nonprod" },
    lifecycleState: "queued",
    dedupe: opts.dedupe,
    requestedBy,
    authorization: opts.authorization,
    authorizationSnapshot: opts.authorizationSnapshot,
    ...(opts.serviceInstance ? { serviceInstance: opts.serviceInstance } : {}),
    ...(snapshot.progressiveRollout ? { progressiveRollout: snapshot.progressiveRollout } : {}),
    deployRunId,
  });
  const queuedSubmission = persistImmediately
    ? await queueBackendSubmissionForLock({
        backend: opts.backend,
        snapshot,
        submission,
        refs,
      })
    : submission;
  return {
    submission: queuedSubmission,
    submissionPath,
    executionSnapshotPath,
    lockScope: snapshot.lockScope,
    snapshot,
    deployRunId,
  };
}
