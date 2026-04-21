#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  resolveInitialCloudflarePagesAdmittedContext,
  resolvePromotionCloudflarePagesAdmittedContext,
} from "./cloudflare-pages-admission.ts";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
  type CloudflarePagesControlPlaneOperationKind,
  type CloudflarePagesControlPlaneSnapshot,
  type CloudflarePagesPublishBehavior,
  type CloudflarePagesSmokeConnectOverride,
} from "./cloudflare-pages-control-plane-contract.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import type { DeploymentRunRecordLike } from "./deployment-admission-records.ts";
import {
  admitStaticWebappArtifact,
  type AdmittedStaticWebappArtifact,
} from "./static-webapp-artifacts.ts";
import { workerVaultRuntimeMetadata } from "./deployment-vault-runtime-worker.ts";

export type CloudflarePagesPromotionSourceSelection = {
  record: DeploymentRunRecordLike;
  recordPath?: string;
  replaySnapshotPath: string;
};

function vaultRuntimeFor(deployment: CloudflarePagesDeployment) {
  const vaultRuntime = workerVaultRuntimeMetadata({ deployment });
  return vaultRuntime ? { vaultRuntime } : {};
}

export async function createCloudflarePagesControlPlaneSnapshot(
  opts: {
    workspaceRoot: string;
    deployment: CloudflarePagesDeployment;
    recordsRoot: string;
    deployBatchId?: string;
    artifactDir?: string;
    artifact?: AdmittedStaticWebappArtifact;
    operationKind?: CloudflarePagesControlPlaneOperationKind;
    publishBehavior?: CloudflarePagesPublishBehavior;
    parentRunId?: string;
    releaseLineageId?: string;
    artifactLineageId?: string;
    source?: CloudflarePagesPromotionSourceSelection;
    smokeConnectOverride?: CloudflarePagesSmokeConnectOverride;
    deferSecretReferenceResolution?: boolean;
  },
  submissionId: string,
): Promise<CloudflarePagesControlPlaneSnapshot> {
  const operationKind = opts.operationKind || "deploy";
  const publishBehavior = opts.publishBehavior || "deploy";
  if (operationKind === "promotion" && !opts.source) {
    throw new Error("cloudflare-pages promotion requires source run evidence");
  }
  if (!opts.artifact && !opts.artifactDir) {
    throw new Error(`cloudflare-pages ${operationKind} submission requires exact artifact input`);
  }
  const artifact =
    opts.artifact ||
    (await admitStaticWebappArtifact({
      recordsRoot: opts.recordsRoot,
      artifactDir: path.resolve(opts.artifactDir || ""),
    }));
  const admittedContext = opts.source
    ? await resolvePromotionCloudflarePagesAdmittedContext({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        artifactIdentity: artifact.identity,
        sourceRecord: opts.source.record,
        ...(opts.deferSecretReferenceResolution ? { deferSecretReferenceResolution: true } : {}),
      })
    : await resolveInitialCloudflarePagesAdmittedContext({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        artifactIdentity: artifact.identity,
        ...(opts.deferSecretReferenceResolution ? { deferSecretReferenceResolution: true } : {}),
      });
  const lockScope = opts.deployment.providerTarget.providerTargetIdentity;
  return {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId,
    submittedAt: new Date().toISOString(),
    ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
    operationKind,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: lockScope,
    lockScope,
    deployment: opts.deployment,
    admittedContext,
    ...vaultRuntimeFor(opts.deployment),
    paths: {
      workspaceRoot: path.resolve(opts.workspaceRoot),
      recordsRoot: path.resolve(opts.recordsRoot),
    },
    action: {
      kind: "deploy",
      publishBehavior,
      publishInput: {
        kind: "exact-artifact",
        artifact,
      },
      ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
      ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
      ...(opts.artifactLineageId ? { artifactLineageId: opts.artifactLineageId } : {}),
      ...(opts.source?.recordPath ? { sourceRecordPath: opts.source.recordPath } : {}),
      ...(opts.source ? { sourceReplaySnapshotPath: opts.source.replaySnapshotPath } : {}),
    },
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  };
}
