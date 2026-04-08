#!/usr/bin/env zx-wrapper
import path from "node:path";
import { requireNixosSharedHostAdmittedArtifactPath } from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-component-results.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  liveRollbackCompatibilityErrors,
  rollbackSourceEligibilityErrors,
  sameDeploymentReplayErrors,
} from "./nixos-shared-host-replay-guardrails.ts";
import {
  deployRecordPathFor,
  readNixosSharedHostDeployRecord,
  type NixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";
import {
  nixosSharedHostReplayArtifactIdentity,
  readNixosSharedHostReplaySnapshot,
  type NixosSharedHostReplaySnapshot,
} from "./nixos-shared-host-replay-snapshot.ts";

export {
  NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_SCHEMA,
  nixosSharedHostReplayArtifactIdentity,
  readNixosSharedHostReplaySnapshot,
  replaySnapshotPathFor,
  writeNixosSharedHostReplayComponentResults,
  writeNixosSharedHostReplaySnapshot,
  type NixosSharedHostReplaySnapshot,
} from "./nixos-shared-host-replay-snapshot.ts";

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
  recordPath?: string;
  recordsRoot?: string;
  deployRunId?: string;
}) {
  if (!opts.recordPath && (!opts.recordsRoot || !opts.deployRunId)) {
    throw new Error(
      "resolve replay source requires --record-path or --records-root plus --deploy-run-id",
    );
  }
  const recordPath = opts.recordPath
    ? path.resolve(opts.recordPath)
    : deployRecordPathFor(String(opts.recordsRoot || ""), String(opts.deployRunId || ""));
  const record = await readNixosSharedHostDeployRecord(recordPath);
  const replaySnapshot = await readNixosSharedHostReplaySnapshot(requireReplaySnapshotPath(record));
  if (replaySnapshot.publishInput.kind === "component-artifacts") {
    const componentArtifactDirs = Object.fromEntries(
      await Promise.all(
        replaySnapshot.publishInput.components.map(async ({ componentId, artifact }) => [
          componentId,
          await requireNixosSharedHostAdmittedArtifactPath(artifact),
        ]),
      ),
    );
    return { record, recordPath, replaySnapshot, componentArtifactDirs };
  }
  const artifactDir = await requireNixosSharedHostAdmittedArtifactPath(
    replaySnapshot.publishInput.artifact,
  );
  return { record, recordPath, replaySnapshot, artifactDir };
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
  sourceRunId: string;
  rollback: boolean;
}) {
  const source = await resolveNixosSharedHostReplaySource({
    recordsRoot: opts.recordsRoot,
    deployRunId: opts.sourceRunId,
  });
  const errors = sameDeploymentReplayErrors(opts.deployment, source.replaySnapshot.deployment);
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
        recordsRoot: opts.recordsRoot,
        deploymentId: opts.deployment.deploymentId,
        sourceRunId: source.record.deployRunId,
      })
    : [];
  if (liveCompatibilityErrors.length > 0) {
    throw new Error(`rollback source run is blocked by current release-action posture:
${liveCompatibilityErrors.join("\n")}`);
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
    recordPath: source.recordPath,
    replaySnapshotPath: requireReplaySnapshotPath(source.record),
    sourceRecord: source.record,
    sourceReplaySnapshot: source.replaySnapshot,
    ...(replaySource ? { sourceComponentResults: replaySource.componentResults } : {}),
  };
}
