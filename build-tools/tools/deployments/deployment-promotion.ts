#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { requiredDeploymentSourceRef } from "./contract";
import {
  resolveDeploymentPromotionSource,
  resolveDeploymentPromotionSourceRecordPath,
  type NixosSharedHostReplaySnapshot,
} from "./deployment-promotion-source";
import { normalizeSingleComponentArtifactInput } from "./nixos-shared-host-single-component-artifact-input";
import {
  exactArtifactPromotionErrors,
  promotionCompatibilityErrors,
  sourcePromotionRevision,
} from "./deployment-promotion-compatibility";
import type {
  CrossDeploymentPromotionSelection,
  CrossDeploymentPromotionSourceSelection,
  DeploymentPromotionSource,
} from "./deployment-promotion-types";
import { resolveDeploymentGitCommit } from "./deployment-git-ref";
import { sourceRefAllowed } from "./deployment-source-ref-policy";
export type {
  CrossDeploymentPromotionSelection,
  CrossDeploymentPromotionSourceSelection,
  DeploymentPromotionSource,
} from "./deployment-promotion-types";
export { resolveDeploymentPromotionSource } from "./deployment-promotion-source";
export { resolveDeploymentPromotionSourceRecordPath } from "./deployment-promotion-source";

async function eligibilityErrors(
  workspaceRoot: string,
  deployment: DeploymentTarget,
  source: DeploymentPromotionSource,
): Promise<string[]> {
  const targetRef = requiredDeploymentSourceRef(deployment);
  const errors: string[] = [];
  if (!sourceRefAllowed(targetRef, deployment.admissionPolicy.allowedRefs)) {
    errors.push(
      `deployment admission policy ${deployment.admissionPolicyRef} does not allow source ref ${targetRef}`,
    );
  }
  const targetRevision = await resolveDeploymentGitCommit({
    workspaceRoot,
    revision: targetRef,
    purpose: "promotion target ref",
  });
  if (targetRevision !== sourcePromotionRevision(source)) {
    errors.push(
      `source run no longer matches current promotable target state: ${source.record.deployRunId}`,
    );
  }
  return errors;
}

export async function resolveCrossDeploymentPromotionSourceSelection<
  TDeployment extends DeploymentTarget,
>(opts: {
  workspaceRoot: string;
  deployment: TDeployment;
  recordsRoot: string;
  sourceRunId: string;
  backendDatabaseUrl?: string;
}): Promise<CrossDeploymentPromotionSourceSelection<TDeployment>> {
  const source = await resolveDeploymentPromotionSource(opts);
  const errors = [
    ...promotionCompatibilityErrors(opts.deployment, source),
    ...(await eligibilityErrors(opts.workspaceRoot, opts.deployment, source)),
  ];
  if (errors.length > 0) {
    throw new Error(`promotion source run is not eligible: ${source.record.deployRunId}
${errors.join("\n")}`);
  }
  return {
    operationKind: "promotion",
    deployment: opts.deployment,
    parentRunId: source.record.deployRunId,
    releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
    sourceReplaySnapshotPath: source.replaySnapshotPath,
    sourceRecord: source.record,
    sourceReplaySnapshot: source.replaySnapshot,
  };
}

export async function resolveCrossDeploymentPromotionSelection<
  TDeployment extends DeploymentTarget,
>(opts: {
  workspaceRoot: string;
  deployment: TDeployment;
  recordsRoot: string;
  sourceRunId: string;
  backendDatabaseUrl?: string;
}): Promise<CrossDeploymentPromotionSelection<TDeployment>> {
  const selection = await resolveCrossDeploymentPromotionSourceSelection(opts);
  const errors = exactArtifactPromotionErrors(selection.deployment);
  if (errors.length > 0) {
    throw new Error(`promotion source run is not eligible: ${selection.parentRunId}
${errors.join("\n")}`);
  }
  return {
    ...selection,
    artifact: (() => {
      if (!selection.sourceRecord.provider) return selection.sourceReplaySnapshot.artifact;
      if (selection.sourceRecord.provider !== "nixos-shared-host") {
        return selection.sourceReplaySnapshot.artifact;
      }
      const source = selection.sourceReplaySnapshot as NixosSharedHostReplaySnapshot;
      if (source.publishInput.kind === "exact-artifact") return source.publishInput.artifact;
      const normalizedArtifact = normalizeSingleComponentArtifactInput({
        deployment: source.deployment,
        componentArtifacts: source.publishInput.components,
      });
      if (normalizedArtifact) return normalizedArtifact;
      throw new Error(
        "multi-component same-artifact promotion requires per-component publish-only handling",
      );
    })(),
    artifactLineageId:
      selection.sourceRecord.artifactLineageId ||
      ("artifactIdentity" in selection.sourceReplaySnapshot
        ? (selection.sourceReplaySnapshot as NixosSharedHostReplaySnapshot).artifactIdentity
        : selection.sourceReplaySnapshot.artifact.identity),
  };
}
