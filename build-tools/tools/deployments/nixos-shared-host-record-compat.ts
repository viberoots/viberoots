#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records";
import { NIXOS_SHARED_HOST_PROVIDER, type NixosSharedHostDeployment } from "./contract";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission";
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-component-results";
import type { NixosSharedHostMutationAuthority } from "./nixos-shared-host-control-plane-contract";
import type { NixosSharedHostProgressiveRollout } from "./nixos-shared-host-progressive-rollout";
import type { NixosSharedHostProvisionerPlanRef } from "./nixos-shared-host-provisioner-plan";
import type {
  NixosSharedHostFailedStep,
  NixosSharedHostFinalOutcome,
  NixosSharedHostOperationKind,
  NixosSharedHostRunClassification,
} from "./nixos-shared-host-records";
import type { DeploymentSmokeException, DeploymentSmokeOutcome } from "./deployment-smoke-policy";
import { nixosSharedHostRunnerIdentities } from "./nixos-shared-host-provenance";

const CURRENT_NIXOS_SHARED_HOST_RECORD_SCHEMA = "deploy-record@2026-04-10";

function runnerIdentitiesFromLegacy(raw: Record<string, unknown>) {
  return typeof raw.runnerIdentities === "object" && raw.runnerIdentities
    ? raw.runnerIdentities
    : {
        ...(typeof raw.publisherType === "string" ? { publisher: raw.publisherType } : {}),
        ...(typeof raw.provisionerType === "string" ? { provisioner: raw.provisionerType } : {}),
        ...(typeof raw.smokeRunnerType === "string" ? { smoke: raw.smokeRunnerType } : {}),
      };
}

function migrateLegacyRecord(raw: Record<string, unknown>): NixosSharedHostDeployRecord {
  return {
    ...raw,
    schemaVersion: CURRENT_NIXOS_SHARED_HOST_RECORD_SCHEMA,
    operationKind: raw.operationKind || "deploy",
    runClassification: raw.runClassification || "deploy",
    publishMode: raw.publishMode || "normal",
    lifecycleState: raw.lifecycleState || "finished",
    terminationReason: raw.terminationReason ?? null,
    provider: raw.provider || NIXOS_SHARED_HOST_PROVIDER,
    effectiveRunTarget: raw.effectiveRunTarget || raw.providerTarget,
    runnerIdentities: runnerIdentitiesFromLegacy(raw),
  } as NixosSharedHostDeployRecord;
}

export const NIXOS_SHARED_HOST_RECORD_MIGRATIONS = {
  "deploy-record@2026-04-04": migrateLegacyRecord,
  "deploy-record@2026-04-08": migrateLegacyRecord,
};

export type NixosSharedHostRecordOutcome = {
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

export function isCurrentNixosSharedHostDeployRecord(
  raw: Record<string, unknown>,
): raw is NixosSharedHostDeployRecord {
  return typeof raw.deployRunId === "string" && typeof raw.deploymentLabel === "string";
}

export function withCurrentRunnerIdentities(
  deployment: NixosSharedHostDeployment,
  record: NixosSharedHostDeployRecord,
): NixosSharedHostDeployRecord {
  return {
    ...record,
    runnerIdentities:
      record.runnerIdentities ||
      nixosSharedHostRunnerIdentities(deployment, deployment.releaseActions),
  };
}
