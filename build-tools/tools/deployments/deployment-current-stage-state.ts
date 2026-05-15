#!/usr/bin/env zx-wrapper
import { decodeBackendJson } from "./nixos-shared-host-control-plane-backend-db";
import type { BackendQueryable } from "./nixos-shared-host-control-plane-backend-db";
import {
  currentStageStateExtras,
  secretSafeStageStateValue,
} from "./deployment-current-stage-state-extras";
import {
  DEPLOYMENT_CURRENT_STAGE_STATE_SCHEMA,
  type DeploymentCurrentStageState,
} from "./deployment-current-stage-state-types";
import { writeCurrentStageStateCas } from "./deployment-current-stage-state-cas";
export { DEPLOYMENT_CURRENT_STAGE_STATE_SCHEMA, type DeploymentCurrentStageState };
export {
  readBackendCurrentStageState,
  readBackendCurrentStageStates,
  readBackendStageHistory,
} from "./deployment-current-stage-state-read";

type DeployRecordDoc = {
  deployRunId: string;
  deploymentId: string;
  deploymentLabel?: string;
  operationKind?: string;
  publishMode?: string;
  providerTargetIdentity?: string;
  finalOutcome?: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  artifact?: { identity?: string; storedArtifactPath?: string; provenancePath?: string };
  artifactIdentity?: string;
  componentArtifacts?: Array<{
    identity?: string;
    storedArtifactPath?: string;
    provenancePath?: string;
  }>;
  replaySnapshotPath?: string;
  providerConfigSnapshotPath?: string;
  provisionerPlan?: { artifactPath?: string; fingerprint?: string };
  driftStatus?: DeploymentCurrentStageState["driftStatus"];
  admittedContext?: {
    environmentStage?: string;
    source?: {
      sourceRevision?: string;
      sourceRunId?: string;
      artifactIdentity?: string;
    };
    policyEvaluation?: {
      requestedBy?: { principalId?: string };
      binding?: { payloadFingerprint?: string; artifactIdentity?: string; sourceRunId?: string };
      requiredChecks?: Array<{
        name?: string;
        status?: string;
        reporterIdentity?: string;
        reportingKind?: string;
        recordRef?: string;
      }>;
      requiredApprovals?: Array<{ name?: string }>;
    };
  };
  controlPlane?: {
    submissionId?: string;
    executionSnapshotPath?: string;
  };
};

type SnapshotDoc = {
  deployment?: {
    environmentStage?: string;
    lanePolicy?: { artifactReuseMode?: string };
  };
};

function eligibleOperation(record: DeployRecordDoc): boolean {
  return ["deploy", "promotion", "retry", "rollback"].includes(String(record.operationKind || ""));
}

function artifactIdentity(record: DeployRecordDoc): string {
  const componentIdentities = (record.componentArtifacts || [])
    .map((component) => component.identity)
    .filter(Boolean);
  return (
    record.artifact?.identity ||
    record.artifactIdentity ||
    record.admittedContext?.source?.artifactIdentity ||
    record.admittedContext?.policyEvaluation?.binding?.artifactIdentity ||
    componentIdentities.join(",")
  );
}

function approvalNames(record: DeployRecordDoc): string[] {
  return (record.admittedContext?.policyEvaluation?.requiredApprovals || [])
    .map((approval) => String(approval.name || "").trim())
    .filter(Boolean);
}

async function readSnapshot(
  client: BackendQueryable,
  submissionId: string,
): Promise<SnapshotDoc | null> {
  const row = (
    await client.query<{ document_json?: unknown }>(
      "SELECT document_json FROM snapshots WHERE submission_id = $1",
      [submissionId],
    )
  ).rows[0];
  return row?.document_json ? decodeBackendJson<SnapshotDoc>(row.document_json) : null;
}

function toCurrentStageState(opts: {
  record: DeployRecordDoc;
  snapshot: SnapshotDoc | null;
  updatedAt: string;
}): DeploymentCurrentStageState | null {
  const { record, snapshot, updatedAt } = opts;
  if (record.finalOutcome !== "succeeded" || !eligibleOperation(record)) return null;
  if (record.publishMode === "preview") return null;
  const sourceRevision = String(record.admittedContext?.source?.sourceRevision || "").trim();
  const identity = artifactIdentity(record);
  const environmentStage =
    snapshot?.deployment?.environmentStage || record.admittedContext?.environmentStage || "";
  const artifactReuseMode = snapshot?.deployment?.lanePolicy?.artifactReuseMode || "";
  if (!sourceRevision || !identity || !environmentStage || !artifactReuseMode) return null;
  const policyEvaluation = record.admittedContext?.policyEvaluation;
  return {
    schemaVersion: DEPLOYMENT_CURRENT_STAGE_STATE_SCHEMA,
    deploymentId: record.deploymentId,
    deploymentLabel: record.deploymentLabel || "",
    environmentStage,
    providerTargetIdentity: record.providerTargetIdentity || "",
    currentRunId: record.deployRunId,
    operationKind: String(record.operationKind || ""),
    ...(record.admittedContext?.source?.sourceRunId ||
    policyEvaluation?.binding?.sourceRunId ||
    record.parentRunId
      ? {
          sourceRunId:
            record.admittedContext?.source?.sourceRunId ||
            policyEvaluation?.binding?.sourceRunId ||
            record.parentRunId,
        }
      : {}),
    sourceRevision: secretSafeStageStateValue(sourceRevision),
    artifactIdentity: secretSafeStageStateValue(identity),
    artifactReuseMode,
    ...(record.parentRunId ? { parentRunId: record.parentRunId } : {}),
    ...(record.releaseLineageId ? { releaseLineageId: record.releaseLineageId } : {}),
    ...(record.artifactLineageId ? { artifactLineageId: record.artifactLineageId } : {}),
    finalOutcome: record.finalOutcome,
    updatedAt,
    approvalContext: {
      ...(policyEvaluation?.binding?.payloadFingerprint
        ? { payloadFingerprint: policyEvaluation.binding.payloadFingerprint }
        : {}),
      requiredApprovals: approvalNames(record),
      ...(policyEvaluation?.requestedBy?.principalId
        ? { requestedBy: policyEvaluation.requestedBy.principalId }
        : {}),
    },
    ...currentStageStateExtras(record),
  };
}

export async function writeCurrentStageStateForDeployRecord(opts: {
  client: BackendQueryable;
  record: DeployRecordDoc;
  updatedAt: string;
  expectedCurrentRunId?: string | null;
  enforceCompareAndSwap?: boolean;
}) {
  const submissionId = opts.record.controlPlane?.submissionId;
  if (!submissionId) return null;
  const state = toCurrentStageState({
    record: opts.record,
    snapshot: await readSnapshot(opts.client, submissionId),
    updatedAt: opts.updatedAt,
  });
  if (!state) return null;
  const stateJson = JSON.stringify(state);
  await writeCurrentStageStateCas({ ...opts, state, stateJson });
  await opts.client.query(
    `INSERT INTO stage_state_history (
      deployment_id, environment_stage, deploy_run_id, document_json, updated_at
    ) VALUES ($1, $2, $3, $4::jsonb, $5)
    ON CONFLICT(deployment_id, environment_stage, deploy_run_id) DO UPDATE SET
      document_json = EXCLUDED.document_json,
      updated_at = EXCLUDED.updated_at`,
    [
      state.deploymentId,
      state.environmentStage,
      state.currentRunId,
      JSON.stringify(state),
      state.updatedAt,
    ],
  );
  return state;
}
