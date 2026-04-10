#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readVersionedJson } from "./deployment-schema-compat.ts";
import type { GooglePlayAdmittedContext } from "./google-play-admission.ts";
import type {
  GooglePlayReleaseHealth,
  GooglePlayRolloutState,
  GooglePlayTrackState,
} from "./google-play-publisher.ts";
import type { DeploymentExecutionPolicyFacts } from "./deployment-execution-policy.ts";
import type {
  DeploymentSmokeException,
  DeploymentSmokeOutcome,
} from "./deployment-smoke-policy.ts";
import type { GooglePlayDeployment } from "./contract.ts";
import type { AdmittedGooglePlayArtifact } from "./google-play-artifacts.ts";
import { GOOGLE_PLAY_PROVIDER } from "./contract.ts";
import { operatorErrorFields } from "./deployment-control-plane-redaction.ts";

export const GOOGLE_PLAY_RECORD_SCHEMA = "google-play-deploy-record@1";
export type GooglePlayOperationKind = "deploy" | "promotion" | "retry" | "rollback";
export type GooglePlayDeployRecord = {
  schemaVersion: typeof GOOGLE_PLAY_RECORD_SCHEMA;
  deployRunId: string;
  operationKind: GooglePlayOperationKind;
  runClassification: GooglePlayOperationKind;
  publishMode: "normal" | "publish-only";
  lifecycleState: "finished";
  terminationReason: null;
  finalOutcome: "succeeded" | "publish_failed" | "smoke_failed_after_publish";
  deploymentId: string;
  deploymentLabel: string;
  provider: typeof GOOGLE_PLAY_PROVIDER;
  providerTarget: GooglePlayDeployment["providerTarget"];
  providerTargetIdentity: string;
  artifact?: AdmittedGooglePlayArtifact;
  admittedContext: GooglePlayAdmittedContext;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  publisherType: string;
  deploymentMetadataFingerprint?: string;
  providerConfigFingerprint?: string;
  replaySnapshotPath?: string;
  storeSubmissionId?: string;
  providerReleaseId?: string;
  trackState?: GooglePlayTrackState;
  rolloutState?: GooglePlayRolloutState;
  releaseHealth?: GooglePlayReleaseHealth;
  smokeOutcome?: DeploymentSmokeOutcome;
  smokeException?: DeploymentSmokeException;
  smokeError?: string;
  executionPolicy?: DeploymentExecutionPolicyFacts;
  failedStep?: "publish" | "release_health";
  error?: string;
  errorFingerprint?: string;
};

export function createGooglePlayDeployRunId(prefix = "deploy"): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function createGooglePlayDeployRecord(
  deployment: GooglePlayDeployment,
  outcome: Omit<
    GooglePlayDeployRecord,
    | "schemaVersion"
    | "deploymentId"
    | "deploymentLabel"
    | "provider"
    | "providerTarget"
    | "providerTargetIdentity"
    | "publisherType"
  >,
): GooglePlayDeployRecord {
  return {
    schemaVersion: GOOGLE_PLAY_RECORD_SCHEMA,
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    provider: GOOGLE_PLAY_PROVIDER,
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

export async function writeGooglePlayDeployRecord(
  recordsRoot: string,
  record: GooglePlayDeployRecord,
): Promise<string> {
  const recordPath = deployRecordPathFor(recordsRoot, record.deployRunId);
  await fsp.mkdir(path.dirname(recordPath), { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return recordPath;
}

export async function readGooglePlayDeployRecord(
  recordPath: string,
): Promise<GooglePlayDeployRecord> {
  return await readVersionedJson(recordPath, {
    kind: "google-play deploy record",
    currentSchemaVersion: GOOGLE_PLAY_RECORD_SCHEMA,
    validateCurrent: (raw): raw is GooglePlayDeployRecord =>
      typeof raw.deployRunId === "string" && typeof raw.deploymentLabel === "string",
  });
}
