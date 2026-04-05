#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission.ts";
import type { NixosSharedHostControlPlaneWorkerAuthority } from "./nixos-shared-host-control-plane-contract.ts";
import {
  NIXOS_SHARED_HOST_PROVIDER,
  type NixosSharedHostDeployment,
  type NixosSharedHostProviderTarget,
} from "./contract.ts";
import { nixosSharedHostDeploymentTargetIdentity } from "./nixos-shared-host-components.ts";

export const NIXOS_SHARED_HOST_RECORD_SCHEMA = "deploy-record@2026-04-04";

export type NixosSharedHostOperationKind = "deploy" | "promotion" | "retry" | "rollback";
export type NixosSharedHostRunClassification = NixosSharedHostOperationKind | "explicit_removal";
export type NixosSharedHostFinalOutcome =
  | "succeeded"
  | "provision_failed"
  | "release_action_failed"
  | "publish_failed"
  | "smoke_failed_after_publish";
export type NixosSharedHostFailedStep =
  | "provision"
  | "publish"
  | "smoke"
  | "release_actions.pre_publish"
  | "release_actions.post_publish_pre_smoke"
  | "release_actions.post_smoke";

export type NixosSharedHostComponentResult = {
  componentId: string;
  providerTargetIdentity: string;
  publicUrl?: string;
  healthUrl?: string;
  artifactIdentity?: string;
  finalOutcome: "succeeded" | "publish_failed" | "smoke_failed_after_publish" | "not_started";
};

export type NixosSharedHostDeployRecord = {
  schemaVersion: typeof NIXOS_SHARED_HOST_RECORD_SCHEMA;
  deployRunId: string;
  operationKind: NixosSharedHostOperationKind;
  runClassification: NixosSharedHostRunClassification;
  publishMode: "normal";
  lifecycleState: "finished";
  terminationReason: null;
  finalOutcome: NixosSharedHostFinalOutcome;
  deploymentId: string;
  deploymentLabel: string;
  provider: typeof NIXOS_SHARED_HOST_PROVIDER;
  providerTarget: NixosSharedHostProviderTarget;
  effectiveRunTarget: NixosSharedHostProviderTarget;
  providerTargetIdentity: string;
  controlPlane?: {
    submissionId: string;
    submissionPath: string;
    workerId: string;
    admission: "admitted";
    lockScope: string;
    executionSnapshotPath: string;
  };
  deployBatchId?: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  artifact?: {
    identity: string;
    storedArtifactPath?: string;
    provenancePath?: string;
  };
  componentResults?: NixosSharedHostComponentResult[];
  admittedContext?: NixosSharedHostAdmittedContext;
  failedStep?: NixosSharedHostFailedStep;
  provisionerType?: string;
  publisherType?: string;
  smokeRunnerType?: "nixos-shared-host-static-webapp-smoke";
  deploymentMetadataFingerprint?: string;
  replaySnapshotPath?: string;
  publicUrl?: string;
  healthUrl?: string;
  error?: string;
};

type NixosSharedHostRecordOutcome = {
  deployRunId: string;
  operationKind?: NixosSharedHostOperationKind;
  runClassification: NixosSharedHostRunClassification;
  finalOutcome: NixosSharedHostFinalOutcome;
  artifactIdentity?: string;
  failedStep?: NixosSharedHostFailedStep;
  publicUrl?: string;
  healthUrl?: string;
  error?: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  deployBatchId?: string;
  authority?: NixosSharedHostControlPlaneWorkerAuthority;
  artifactStoredArtifactPath?: string;
  artifactProvenancePath?: string;
  admittedContext?: NixosSharedHostAdmittedContext;
  componentResults?: NixosSharedHostComponentResult[];
  deploymentMetadataFingerprint?: string;
  replaySnapshotPath?: string;
};

export function createNixosSharedHostDeployRunId(prefix = "deploy"): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function createNixosSharedHostDeployRecord(
  deployment: NixosSharedHostDeployment,
  outcome: NixosSharedHostRecordOutcome,
): NixosSharedHostDeployRecord {
  return {
    schemaVersion: NIXOS_SHARED_HOST_RECORD_SCHEMA,
    deployRunId: outcome.deployRunId,
    operationKind: outcome.operationKind || "deploy",
    runClassification: outcome.runClassification,
    publishMode: "normal",
    lifecycleState: "finished",
    terminationReason: null,
    finalOutcome: outcome.finalOutcome,
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    provider: NIXOS_SHARED_HOST_PROVIDER,
    providerTarget: deployment.providerTarget,
    effectiveRunTarget: deployment.providerTarget,
    providerTargetIdentity: nixosSharedHostDeploymentTargetIdentity(deployment),
    ...(outcome.authority
      ? {
          controlPlane: {
            submissionId: outcome.authority.submissionId,
            submissionPath: outcome.authority.submissionPath,
            workerId: outcome.authority.workerId,
            admission: "admitted" as const,
            lockScope: outcome.authority.lockScope,
            executionSnapshotPath: outcome.authority.executionSnapshotPath,
          },
        }
      : {}),
    ...(outcome.deployBatchId ? { deployBatchId: outcome.deployBatchId } : {}),
    ...(outcome.parentRunId ? { parentRunId: outcome.parentRunId } : {}),
    ...(outcome.releaseLineageId ? { releaseLineageId: outcome.releaseLineageId } : {}),
    ...(outcome.artifactLineageId ? { artifactLineageId: outcome.artifactLineageId } : {}),
    ...(outcome.artifactIdentity
      ? {
          artifact: {
            identity: outcome.artifactIdentity,
            ...(outcome.artifactStoredArtifactPath
              ? { storedArtifactPath: outcome.artifactStoredArtifactPath }
              : {}),
            ...(outcome.artifactProvenancePath
              ? { provenancePath: outcome.artifactProvenancePath }
              : {}),
          },
        }
      : {}),
    ...(outcome.admittedContext ? { admittedContext: outcome.admittedContext } : {}),
    ...(outcome.componentResults ? { componentResults: outcome.componentResults } : {}),
    ...(outcome.failedStep ? { failedStep: outcome.failedStep } : {}),
    ...(deployment.provisioner ? { provisionerType: deployment.provisioner.type } : {}),
    ...(outcome.runClassification !== "explicit_removal"
      ? {
          publisherType: deployment.publisher.type,
          smokeRunnerType: "nixos-shared-host-static-webapp-smoke" as const,
        }
      : {}),
    ...(outcome.deploymentMetadataFingerprint
      ? { deploymentMetadataFingerprint: outcome.deploymentMetadataFingerprint }
      : {}),
    ...(outcome.replaySnapshotPath ? { replaySnapshotPath: outcome.replaySnapshotPath } : {}),
    ...(outcome.publicUrl ? { publicUrl: outcome.publicUrl } : {}),
    ...(outcome.healthUrl ? { healthUrl: outcome.healthUrl } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
  };
}

export function deployRecordPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(path.resolve(recordsRoot), "runs", `${deployRunId}.json`);
}

export async function writeNixosSharedHostDeployRecord(
  recordsRoot: string,
  record: NixosSharedHostDeployRecord,
): Promise<string> {
  const recordPath = deployRecordPathFor(recordsRoot, record.deployRunId);
  const runsDir = path.dirname(recordPath);
  await fsp.mkdir(runsDir, { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return recordPath;
}

export async function readNixosSharedHostDeployRecord(
  recordPath: string,
): Promise<NixosSharedHostDeployRecord> {
  const record = JSON.parse(await fsp.readFile(recordPath, "utf8")) as NixosSharedHostDeployRecord;
  if (
    record.schemaVersion !== NIXOS_SHARED_HOST_RECORD_SCHEMA ||
    typeof record.deployRunId !== "string" ||
    typeof record.deploymentLabel !== "string"
  ) {
    throw new Error(`invalid nixos-shared-host deploy record: ${recordPath}`);
  }
  return record;
}
