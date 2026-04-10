#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readVersionedJson } from "./deployment-schema-compat.ts";
import type { AppStoreConnectAdmittedContext } from "./app-store-connect-admission.ts";
import type {
  AppStoreConnectReleaseHealth,
  AppStoreConnectRolloutState,
  AppStoreConnectTrackState,
} from "./app-store-connect-publisher.ts";
import type { DeploymentExecutionPolicyFacts } from "./deployment-execution-policy.ts";
import type {
  DeploymentSmokeException,
  DeploymentSmokeOutcome,
} from "./deployment-smoke-policy.ts";
import type { AppStoreConnectDeployment } from "./contract.ts";
import type { AdmittedMobileAppArtifact } from "./app-store-connect-artifacts.ts";
import { APP_STORE_CONNECT_PROVIDER } from "./contract.ts";
import { operatorErrorFields } from "./deployment-control-plane-redaction.ts";

export const APP_STORE_CONNECT_RECORD_SCHEMA = "deploy-record@2026-04-09";

export type AppStoreConnectOperationKind = "deploy" | "promotion" | "retry" | "rollback";
export type AppStoreConnectDeployRecord = {
  schemaVersion: typeof APP_STORE_CONNECT_RECORD_SCHEMA;
  deployRunId: string;
  operationKind: AppStoreConnectOperationKind;
  runClassification: AppStoreConnectOperationKind;
  publishMode: "normal" | "publish-only";
  lifecycleState: "finished";
  terminationReason: null;
  finalOutcome: "succeeded" | "publish_failed" | "smoke_failed_after_publish";
  deploymentId: string;
  deploymentLabel: string;
  provider: typeof APP_STORE_CONNECT_PROVIDER;
  providerTarget: AppStoreConnectDeployment["providerTarget"];
  providerTargetIdentity: string;
  artifact?: AdmittedMobileAppArtifact;
  admittedContext: AppStoreConnectAdmittedContext;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  publisherType: string;
  deploymentMetadataFingerprint?: string;
  providerConfigFingerprint?: string;
  replaySnapshotPath?: string;
  storeSubmissionId?: string;
  providerReleaseId?: string;
  trackState?: AppStoreConnectTrackState;
  rolloutState?: AppStoreConnectRolloutState;
  releaseHealth?: AppStoreConnectReleaseHealth;
  smokeOutcome?: DeploymentSmokeOutcome;
  smokeException?: DeploymentSmokeException;
  smokeError?: string;
  executionPolicy?: DeploymentExecutionPolicyFacts;
  failedStep?: "publish" | "release_health";
  error?: string;
  errorFingerprint?: string;
};

export function createAppStoreConnectDeployRunId(prefix = "deploy"): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function createAppStoreConnectDeployRecord(
  deployment: AppStoreConnectDeployment,
  outcome: Omit<
    AppStoreConnectDeployRecord,
    | "schemaVersion"
    | "deploymentId"
    | "deploymentLabel"
    | "provider"
    | "providerTarget"
    | "providerTargetIdentity"
    | "publisherType"
  >,
): AppStoreConnectDeployRecord {
  return {
    schemaVersion: APP_STORE_CONNECT_RECORD_SCHEMA,
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    provider: APP_STORE_CONNECT_PROVIDER,
    providerTarget: deployment.providerTarget,
    providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
    publisherType: deployment.publisher.type,
    ...outcome,
    ...operatorErrorFields(outcome.error),
  };
}

export function deployRecordPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(path.resolve(recordsRoot), "runs", `${deployRunId}.json`);
}

export async function writeAppStoreConnectDeployRecord(
  recordsRoot: string,
  record: AppStoreConnectDeployRecord,
): Promise<string> {
  const recordPath = deployRecordPathFor(recordsRoot, record.deployRunId);
  await fsp.mkdir(path.dirname(recordPath), { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return recordPath;
}

export async function readAppStoreConnectDeployRecord(
  recordPath: string,
): Promise<AppStoreConnectDeployRecord> {
  return await readVersionedJson(recordPath, {
    kind: "app-store-connect deploy record",
    currentSchemaVersion: APP_STORE_CONNECT_RECORD_SCHEMA,
    validateCurrent: (raw): raw is AppStoreConnectDeployRecord =>
      typeof raw.deployRunId === "string" && typeof raw.deploymentLabel === "string",
  });
}
