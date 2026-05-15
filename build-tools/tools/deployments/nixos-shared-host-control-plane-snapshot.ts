#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  admitNixosSharedHostComponentArtifacts,
  type NixosSharedHostResolvedComponentArtifact,
} from "./nixos-shared-host-component-artifacts";
import {
  admitNixosSharedHostArtifact,
  type NixosSharedHostAdmittedArtifact,
} from "./nixos-shared-host-artifacts";
import type { NixosSharedHostDeployment } from "./contract";
import {
  resolveInitialNixosSharedHostAdmittedContext,
  resolvePromotionNixosSharedHostAdmittedContext,
  resolveReplayNixosSharedHostAdmittedContext,
} from "./nixos-shared-host-admission";
import {
  NIXOS_SHARED_HOST_CONTROL_PLANE_SNAPSHOT_SCHEMA,
  type NixosSharedHostControlPlaneOperationKind,
  type NixosSharedHostControlPlanePaths,
  type NixosSharedHostControlPlaneSnapshot,
  type NixosSharedHostPublishBehavior,
  type NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract";
import {
  isMultiComponentNixosSharedHostDeployment,
  nixosSharedHostDeploymentTargetIdentity,
} from "./nixos-shared-host-components";
import { nixosSharedHostPublishInputArtifactIdentity } from "./nixos-shared-host-publish-input";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records";
import type { NixosSharedHostReplaySnapshot } from "./nixos-shared-host-replay";
import { createNixosSharedHostProgressiveRollout } from "./nixos-shared-host-progressive-rollout";
import { normalizeSingleComponentArtifactInput } from "./nixos-shared-host-single-component-artifact-input";
import {
  hasReplaySnapshot,
  publishInputFor,
  recordedComponentResults,
} from "./nixos-shared-host-control-plane-snapshot-helpers";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import type { DeploymentReviewedSourceSnapshot } from "./nixos-shared-host-reviewed-source-snapshot";
import { workerSecretRuntimeMetadata } from "./deployment-secret-worker-runtime-metadata";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
export { createNixosSharedHostSubmissionId } from "./nixos-shared-host-control-plane-submission-id";
export type NixosSharedHostControlPlaneSourceSelection = {
  record: NixosSharedHostDeployRecord | { deployRunId: string; deploymentId: string };
  replaySnapshotPath?: string;
  replaySnapshot?: NixosSharedHostReplaySnapshot;
};

export type NixosSharedHostControlPlaneSnapshotOpts = {
  workspaceRoot: string;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  deployBatchId?: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts?: NixosSharedHostResolvedComponentArtifact[];
  publishBehavior?: NixosSharedHostPublishBehavior;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
  source?: NixosSharedHostControlPlaneSourceSelection;
  admissionEvidence?: DeploymentAdmissionEvidence;
  deferSecretReferenceResolution?: boolean;
  reviewedSourceSnapshot?: DeploymentReviewedSourceSnapshot;
  objectStore?: ControlPlaneArtifactStore;
};

function admittedContextOptions(opts: NixosSharedHostControlPlaneSnapshotOpts) {
  return {
    ...(opts.reviewedSourceSnapshot ? { reviewedSourceSnapshot: opts.reviewedSourceSnapshot } : {}),
    ...(opts.deferSecretReferenceResolution ? { deferSecretReferenceResolution: true } : {}),
  };
}

export async function createNixosSharedHostControlPlaneSnapshot(
  opts: NixosSharedHostControlPlaneSnapshotOpts,
  submissionId: string,
): Promise<NixosSharedHostControlPlaneSnapshot> {
  const submittedAt = new Date().toISOString();
  const multiComponent = isMultiComponentNixosSharedHostDeployment(opts.deployment);
  const lockScope = nixosSharedHostDeploymentTargetIdentity(opts.deployment);
  const stagingRoot = opts.paths.artifactStagingRoot;
  if (
    (opts.operationKind === "retry" || opts.operationKind === "rollback") &&
    !hasReplaySnapshot(opts.source)
  ) {
    throw new Error(`shared control-plane ${opts.operationKind} submission requires source run`);
  }
  if (opts.operationKind === "promotion" && !opts.source) {
    throw new Error("shared control-plane promotion submission requires source run");
  }
  if (multiComponent && (opts.artifact || opts.artifactDir)) {
    throw new Error(
      "multi-component nixos-shared-host deployments require per-component exact artifact inputs",
    );
  }
  const singleComponentArtifacts =
    !multiComponent && opts.operationKind !== "explicit_removal"
      ? opts.componentArtifacts ||
        (opts.artifactDirsByComponentId
          ? await admitNixosSharedHostComponentArtifacts({
              deployment: opts.deployment,
              recordsRoot: opts.paths.recordsRoot,
              artifactDirsByComponentId: opts.artifactDirsByComponentId,
              ...(stagingRoot ? { stagingRoot } : {}),
              ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
              submissionId,
            })
          : undefined)
      : undefined;
  if (
    opts.operationKind !== "explicit_removal" &&
    opts.operationKind !== "provision_only" &&
    !opts.artifact &&
    !opts.artifactDir &&
    !opts.componentArtifacts &&
    !opts.artifactDirsByComponentId
  ) {
    throw new Error(
      `shared control-plane ${opts.operationKind} submission requires exact artifact input`,
    );
  }
  const artifact =
    opts.operationKind === "explicit_removal" || multiComponent
      ? undefined
      : normalizeSingleComponentArtifactInput({
          deployment: opts.deployment,
          artifact: opts.artifact,
          componentArtifacts: singleComponentArtifacts,
        }) ||
        (opts.operationKind === "provision_only" &&
        !opts.artifact &&
        !opts.artifactDir &&
        !(singleComponentArtifacts && singleComponentArtifacts.length > 0)
          ? undefined
          : await admitNixosSharedHostArtifact({
              recordsRoot: opts.paths.recordsRoot,
              artifactDir: path.resolve(opts.artifactDir || ""),
              kind: opts.deployment.component.kind,
              ...(stagingRoot ? { stagingRoot } : {}),
              ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
              deploymentId: opts.deployment.deploymentId,
              submissionId,
            }));
  const componentArtifacts =
    opts.operationKind !== "explicit_removal" && multiComponent
      ? opts.componentArtifacts ||
        (await admitNixosSharedHostComponentArtifacts({
          deployment: opts.deployment,
          recordsRoot: opts.paths.recordsRoot,
          artifactDirsByComponentId: opts.artifactDirsByComponentId || {},
          ...(stagingRoot ? { stagingRoot } : {}),
          ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
          submissionId,
        }))
      : undefined;
  const publishInput =
    opts.operationKind === "explicit_removal"
      ? undefined
      : publishInputFor({
          artifact,
          componentArtifacts,
        });
  const artifactIdentity =
    opts.operationKind === "explicit_removal" || !publishInput
      ? undefined
      : nixosSharedHostPublishInputArtifactIdentity(publishInput);
  const admittedContext =
    opts.operationKind === "explicit_removal"
      ? undefined
      : opts.operationKind === "promotion"
        ? await resolvePromotionNixosSharedHostAdmittedContext({
            workspaceRoot: opts.workspaceRoot,
            deployment: opts.deployment,
            artifactIdentity,
            ...admittedContextOptions(opts),
            sourceRecord: opts.source!.record,
          })
        : hasReplaySnapshot(opts.source)
          ? await resolveReplayNixosSharedHostAdmittedContext({
              workspaceRoot: opts.workspaceRoot,
              deployment: opts.deployment,
              artifactIdentity,
              ...admittedContextOptions(opts),
              sourceRecord: opts.source.record,
              sourceReplaySnapshot: opts.source.replaySnapshot,
              rollback: opts.operationKind === "rollback",
            })
          : await resolveInitialNixosSharedHostAdmittedContext({
              workspaceRoot: opts.workspaceRoot,
              deployment: opts.deployment,
              artifactIdentity,
              ...admittedContextOptions(opts),
            });
  const progressiveRollout = createNixosSharedHostProgressiveRollout(opts.deployment);
  return {
    schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId,
    submittedAt,
    ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
    operationKind: opts.operationKind,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: nixosSharedHostDeploymentTargetIdentity(opts.deployment),
    lockScope,
    deployment: opts.deployment,
    ...(progressiveRollout ? { progressiveRollout } : {}),
    ...(hasReplaySnapshot(opts.source)
      ? {
          recordedReleaseActions:
            opts.source.replaySnapshot.releaseActionPlan ||
            opts.source.replaySnapshot.deployment.releaseActions,
        }
      : {}),
    ...(admittedContext ? { admittedContext } : {}),
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
    ...workerSecretRuntimeMetadata({ deployment: opts.deployment }),
    paths: {
      statePath: path.resolve(opts.paths.statePath),
      hostRoot: path.resolve(opts.paths.hostRoot),
      recordsRoot: path.resolve(opts.paths.recordsRoot),
      ...(stagingRoot ? { artifactStagingRoot: path.resolve(stagingRoot) } : {}),
      ...(opts.paths.hostConfigPath
        ? { hostConfigPath: path.resolve(opts.paths.hostConfigPath) }
        : {}),
    },
    action:
      opts.operationKind !== "explicit_removal"
        ? {
            kind: "deploy",
            publishBehavior: opts.publishBehavior || "deploy",
            ...(publishInput ? { publishInput } : {}),
            ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
            ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
            ...(opts.artifactLineageId ? { artifactLineageId: opts.artifactLineageId } : {}),
            ...(opts.source?.replaySnapshotPath
              ? { sourceReplaySnapshotPath: opts.source.replaySnapshotPath }
              : {}),
            ...(recordedComponentResults(opts.source)
              ? { recordedComponentResults: recordedComponentResults(opts.source) }
              : {}),
          }
        : { kind: "explicit_removal" },
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  };
}
