#!/usr/bin/env zx-wrapper
import { requireNixosSharedHostAdmittedArtifactPath } from "./nixos-shared-host-artifacts";
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-component-results";
import type { NixosSharedHostDeployment } from "./contract";
import { assertProtectedSharedReplayUsable } from "./deployment-control-plane-retention";
import {
  readBackendDeployRecordEnvelopeByDeployRunId,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import {
  liveRollbackCompatibilityErrors,
  recordedReplayPolicyErrors,
  replayRunnerCompatibilityErrors,
  rollbackSourceEligibilityErrors,
  sameDeploymentReplayErrors,
} from "./nixos-shared-host-replay-guardrails";
import { rollbackStageStateErrors } from "./deployment-rollback-candidates";
import { type NixosSharedHostDeployRecord } from "./nixos-shared-host-records";
import {
  nixosSharedHostReplayArtifactIdentity,
  readNixosSharedHostReplaySnapshot,
  type NixosSharedHostReplaySnapshot,
} from "./nixos-shared-host-replay-snapshot";

export {
  NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA,
  nixosSharedHostReplayArtifactIdentity,
  readNixosSharedHostReplaySnapshot,
  replaySnapshotPathFor,
  writeNixosSharedHostReplayComponentResults,
  writeNixosSharedHostReplaySnapshot,
  type NixosSharedHostReplaySnapshot,
} from "./nixos-shared-host-replay-snapshot";

function requireReplaySnapshotPath(record: NixosSharedHostDeployRecord): string {
  if (typeof record.replaySnapshotPath === "string" && record.replaySnapshotPath.trim()) {
    return record.replaySnapshotPath;
  }
  if (record.runClassification === "explicit_removal") {
    throw new Error(`source run does not carry a publishable artifact: ${record.deployRunId}
wrong run classification: ${record.runClassification}`);
  }
  throw new Error(`deploy record is missing replaySnapshotPath: ${record.deployRunId}`);
}

export async function resolveNixosSharedHostReplaySource(opts: {
  recordsRoot: string;
  backendDatabaseUrl: string;
  deployRunId?: string;
}) {
  if (!opts.deployRunId) {
    throw new Error("resolve replay source requires --deploy-run-id");
  }
  const backend: NixosSharedHostControlPlaneBackendTarget = {
    recordsRoot: opts.recordsRoot,
    databaseUrl: opts.backendDatabaseUrl,
  };
  const envelope = await readBackendDeployRecordEnvelopeByDeployRunId(backend, opts.deployRunId);
  if (!envelope) {
    throw Object.assign(new Error(`deploy record not found for ${opts.deployRunId}`), {
      code: "ENOENT",
    });
  }
  const record = envelope.record as NixosSharedHostDeployRecord;
  const replaySnapshotPath = requireReplaySnapshotPath(record);
  const replaySnapshot = await readNixosSharedHostReplaySnapshot(replaySnapshotPath);
  await assertProtectedSharedReplayUsable({
    protectionClass: "shared_nonprod",
    deployRunId: record.deployRunId,
    recordPath: envelope.recordPath,
    recordUpdatedAt: envelope.updatedAt,
    requireRecordPathInBundle: false,
    replaySnapshotPath,
    replayCreatedAt: replaySnapshot.createdAt,
    artifacts:
      replaySnapshot.publishInput.kind === "component-artifacts"
        ? replaySnapshot.publishInput.components.map(({ artifact }) => artifact)
        : [replaySnapshot.publishInput.artifact],
    replayBundlePaths: [
      replaySnapshot.platformStateSnapshotPath,
      replaySnapshot.hostConfigSnapshotPath,
      replaySnapshot.provisionerPlan?.artifactPath || "",
    ],
    evidence: replaySnapshot.admittedContext.policyEvaluation,
  });
  if (replaySnapshot.publishInput.kind === "component-artifacts") {
    const componentArtifactDirs = Object.fromEntries(
      await Promise.all(
        replaySnapshot.publishInput.components.map(async ({ componentId, artifact }) => [
          componentId,
          await requireNixosSharedHostAdmittedArtifactPath(artifact),
        ]),
      ),
    );
    return { record, replaySnapshot, componentArtifactDirs };
  }
  const artifactDir = await requireNixosSharedHostAdmittedArtifactPath(
    replaySnapshot.publishInput.artifact,
  );
  return { record, replaySnapshot, artifactDir };
}

function componentIds(values: Array<{ componentId: string }>): string {
  return values
    .map((value) => value.componentId)
    .sort()
    .join(",");
}

export function requireNixosSharedHostReplayComponentState(
  deployment: NixosSharedHostDeployment,
  replaySnapshot: NixosSharedHostReplaySnapshot,
): {
  componentArtifacts: typeof replaySnapshot.publishInput.components;
  componentResults: NixosSharedHostComponentResult[];
} {
  if (replaySnapshot.publishInput.kind !== "component-artifacts") {
    throw new Error("multi-component replay requires recorded per-component exact artifact inputs");
  }
  if (!replaySnapshot.componentResults?.length) {
    throw new Error("multi-component replay is missing recorded per-component replay state");
  }
  const expectedComponentIds = deployment.components
    .map((component) => component.id)
    .sort()
    .join(",");
  if (componentIds(replaySnapshot.publishInput.components) !== expectedComponentIds) {
    throw new Error("multi-component replay artifact state does not match deployment components");
  }
  if (componentIds(replaySnapshot.componentResults) !== expectedComponentIds) {
    throw new Error("multi-component replay result state does not match deployment components");
  }
  const artifactIdentityByComponentId = new Map(
    replaySnapshot.publishInput.components.map(({ componentId, artifact }) => [
      componentId,
      artifact.identity,
    ]),
  );
  for (const result of replaySnapshot.componentResults) {
    if (artifactIdentityByComponentId.get(result.componentId) !== result.artifactIdentity) {
      throw new Error(`multi-component replay state drifted for component "${result.componentId}"`);
    }
  }
  return {
    componentArtifacts: replaySnapshot.publishInput.components,
    componentResults: replaySnapshot.componentResults,
  };
}

export async function resolveNixosSharedHostReplaySelection(opts: {
  deployment: NixosSharedHostDeployment;
  recordsRoot: string;
  backendDatabaseUrl: string;
  sourceRunId: string;
  rollback: boolean;
}) {
  const source = await resolveNixosSharedHostReplaySource({
    recordsRoot: opts.recordsRoot,
    backendDatabaseUrl: opts.backendDatabaseUrl,
    deployRunId: opts.sourceRunId,
  });
  const errors = sameDeploymentReplayErrors(opts.deployment, source.replaySnapshot.deployment);
  errors.push(
    ...replayRunnerCompatibilityErrors({
      deployment: opts.deployment,
      record: source.record,
      replaySnapshot: source.replaySnapshot,
    }),
  );
  if (
    source.replaySnapshot.deployment.releaseActions.length > 0 &&
    !source.replaySnapshot.releaseActionPlan?.length
  ) {
    errors.push("recorded replay snapshot is missing the release-action plan required for replay");
  }
  const recordedReleaseActions =
    source.replaySnapshot.releaseActionPlan || source.replaySnapshot.deployment.releaseActions;
  errors.push(
    ...recordedReplayPolicyErrors({
      operationKind: opts.rollback ? "rollback" : "retry",
      releaseActions: recordedReleaseActions,
    }),
  );
  if (errors.length > 0) {
    throw new Error(`shared replay source is not compatible with the current deployment:
${errors.join("\n")}`);
  }
  const rollbackErrors = opts.rollback ? rollbackSourceEligibilityErrors(source.record) : [];
  if (rollbackErrors.length > 0) {
    throw new Error(`rollback source run is not eligible: ${source.record.deployRunId}
${rollbackErrors.join("\n")}`);
  }
  const liveCompatibilityErrors = opts.rollback
    ? await liveRollbackCompatibilityErrors({
        backend: {
          recordsRoot: opts.recordsRoot,
          databaseUrl: opts.backendDatabaseUrl,
        },
        deploymentId: opts.deployment.deploymentId,
        sourceRunId: source.record.deployRunId,
      })
    : [];
  if (liveCompatibilityErrors.length > 0) {
    throw new Error(`rollback source run is blocked by current release-action posture:
${liveCompatibilityErrors.join("\n")}`);
  }
  const stageStateErrors = opts.rollback
    ? await rollbackStageStateErrors({
        backend: {
          recordsRoot: opts.recordsRoot,
          databaseUrl: opts.backendDatabaseUrl,
        },
        deployment: opts.deployment,
        sourceRunId: source.record.deployRunId,
      })
    : [];
  if (stageStateErrors.length > 0) {
    throw new Error(`rollback source run is not admitted by current stage state:
${stageStateErrors.join("\n")}`);
  }
  const replaySource =
    source.replaySnapshot.publishInput.kind === "component-artifacts"
      ? requireNixosSharedHostReplayComponentState(opts.deployment, source.replaySnapshot)
      : undefined;
  return {
    operationKind: opts.rollback ? "rollback" : "retry",
    deployment: opts.deployment,
    ...(source.replaySnapshot.publishInput.kind === "exact-artifact"
      ? { artifact: source.replaySnapshot.publishInput.artifact }
      : {
          componentArtifacts: replaySource!.componentArtifacts,
          compositeArtifactIdentity: source.replaySnapshot.publishInput.compositeArtifactIdentity,
        }),
    parentRunId: source.record.deployRunId,
    ...(source.record.releaseLineageId ? { releaseLineageId: source.record.releaseLineageId } : {}),
    artifactLineageId:
      source.record.artifactLineageId ||
      nixosSharedHostReplayArtifactIdentity(source.replaySnapshot),
    replaySnapshotPath: requireReplaySnapshotPath(source.record),
    sourceRecord: source.record,
    sourceReplaySnapshot: source.replaySnapshot,
    ...(replaySource ? { sourceComponentResults: replaySource.componentResults } : {}),
  };
}
