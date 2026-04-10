#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission.ts";
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-component-results.ts";
import type { NixosSharedHostMutationAuthority } from "./nixos-shared-host-control-plane-contract.ts";
import type { NixosSharedHostProgressiveRollout } from "./nixos-shared-host-progressive-rollout.ts";
import type { NixosSharedHostProvisionerPlanRef } from "./nixos-shared-host-provisioner-plan.ts";
import {
  NIXOS_SHARED_HOST_PROVIDER,
  type NixosSharedHostDeployment,
  type NixosSharedHostProviderTarget,
} from "./contract.ts";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import type {
  DeploymentSmokeException,
  DeploymentSmokeOutcome,
} from "./deployment-smoke-policy.ts";
import { operatorErrorFields } from "./deployment-control-plane-redaction.ts";
import { recordAuthorityFields } from "./nixos-shared-host-record-authority.ts";
import { nixosSharedHostDeploymentTargetIdentity } from "./nixos-shared-host-components.ts";
import { SSR_WEBAPP_COMPONENT } from "./contract.ts";
export const NIXOS_SHARED_HOST_RECORD_SCHEMA = "deploy-record@2026-04-08";
export type NixosSharedHostOperationKind =
  | "deploy"
  | "promotion"
  | "provision_only"
  | "retry"
  | "rollback";
export type NixosSharedHostRunClassification = NixosSharedHostOperationKind | "explicit_removal";
export type NixosSharedHostFinalOutcome =
  | "succeeded"
  | "aborted"
  | "provision_failed"
  | "release_action_failed"
  | "publish_failed"
  | "smoke_failed_nonblocking"
  | "smoke_failed_after_publish";
export type NixosSharedHostFailedStep =
  | "provision"
  | "publish"
  | "smoke"
  | "release_actions.pre_publish"
  | "release_actions.post_publish_pre_smoke"
  | "release_actions.post_smoke";

export type NixosSharedHostDeployRecord = {
  schemaVersion: typeof NIXOS_SHARED_HOST_RECORD_SCHEMA;
  deployRunId: string;
  operationKind: NixosSharedHostOperationKind;
  runClassification: NixosSharedHostRunClassification;
  publishMode: "normal";
  lifecycleState: "finished";
  terminationReason: null;
  finalOutcome: NixosSharedHostFinalOutcome;
  progressiveRollout?: NixosSharedHostProgressiveRollout;
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
  breakGlass?: {
    incidentRef: string;
    freezeId: string;
    freezePath: string;
    evidencePath: string;
    requestedBy: DeploymentPrincipal;
    approvedBy?: DeploymentPrincipal;
    executedBy: DeploymentPrincipal;
    justification: string;
    bypassReason: string;
    selection: { kind: "exact_artifact"; artifactIdentity: string };
  };
  bootstrap?: {
    mode: "first_install" | "offline_recovery";
    evidencePath: string;
    executionSnapshotPath: string;
    lockScope: string;
    requestedBy: DeploymentPrincipal;
    executedBy: DeploymentPrincipal;
    ownershipProof: string;
    targetIdentityProof: string;
    selection: { kind: "exact_artifact"; artifactIdentity: string };
    reconciliation: {
      status: "pending" | "ingested";
      reconciledAt?: string;
      reconciledBy?: DeploymentPrincipal;
    };
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
  smokeRunnerType?: "nixos-shared-host-static-webapp-smoke" | "nixos-shared-host-ssr-webapp-smoke";
  smokeOutcome?: DeploymentSmokeOutcome;
  smokeException?: DeploymentSmokeException;
  smokeError?: string;
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
  deploymentMetadataFingerprint?: string;
  replaySnapshotPath?: string;
  publicUrl?: string;
  healthUrl?: string;
  error?: string;
  errorFingerprint?: string;
};

type NixosSharedHostRecordOutcome = {
  deployRunId: string;
  operationKind?: NixosSharedHostOperationKind;
  runClassification: NixosSharedHostRunClassification;
  finalOutcome: NixosSharedHostFinalOutcome;
  progressiveRollout?: NixosSharedHostProgressiveRollout;
  artifactIdentity?: string;
  failedStep?: NixosSharedHostFailedStep;
  publicUrl?: string;
  healthUrl?: string;
  error?: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  deployBatchId?: string;
  authority?: NixosSharedHostMutationAuthority;
  artifactStoredArtifactPath?: string;
  artifactProvenancePath?: string;
  admittedContext?: NixosSharedHostAdmittedContext;
  componentResults?: NixosSharedHostComponentResult[];
  smokeOutcome?: DeploymentSmokeOutcome;
  smokeException?: DeploymentSmokeException;
  smokeError?: string;
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
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
  const operatorError = operatorErrorFields(outcome.error);
  return {
    schemaVersion: NIXOS_SHARED_HOST_RECORD_SCHEMA,
    deployRunId: outcome.deployRunId,
    operationKind: outcome.operationKind || "deploy",
    runClassification: outcome.runClassification,
    publishMode: "normal",
    lifecycleState: "finished",
    terminationReason: null,
    finalOutcome: outcome.finalOutcome,
    ...(outcome.progressiveRollout ? { progressiveRollout: outcome.progressiveRollout } : {}),
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    provider: NIXOS_SHARED_HOST_PROVIDER,
    providerTarget: deployment.providerTarget,
    effectiveRunTarget: deployment.providerTarget,
    providerTargetIdentity: nixosSharedHostDeploymentTargetIdentity(deployment),
    ...recordAuthorityFields(outcome.authority),
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
    ...(outcome.runClassification !== "explicit_removal" &&
    outcome.runClassification !== "provision_only"
      ? {
          publisherType: deployment.publisher.type,
          smokeRunnerType:
            deployment.component.kind === SSR_WEBAPP_COMPONENT
              ? ("nixos-shared-host-ssr-webapp-smoke" as const)
              : ("nixos-shared-host-static-webapp-smoke" as const),
        }
      : {}),
    ...(outcome.smokeOutcome ? { smokeOutcome: outcome.smokeOutcome } : {}),
    ...(outcome.smokeException ? { smokeException: outcome.smokeException } : {}),
    ...(outcome.smokeError ? { smokeError: outcome.smokeError } : {}),
    ...(outcome.provisionerPlan ? { provisionerPlan: outcome.provisionerPlan } : {}),
    ...(outcome.deploymentMetadataFingerprint
      ? { deploymentMetadataFingerprint: outcome.deploymentMetadataFingerprint }
      : {}),
    ...(outcome.replaySnapshotPath ? { replaySnapshotPath: outcome.replaySnapshotPath } : {}),
    ...(outcome.publicUrl ? { publicUrl: outcome.publicUrl } : {}),
    ...(outcome.healthUrl ? { healthUrl: outcome.healthUrl } : {}),
    ...operatorError,
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
