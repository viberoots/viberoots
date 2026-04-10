#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { S3StaticAdmittedContext } from "./s3-static-admission.ts";
import type { S3StaticDeployment } from "./contract.ts";
import type {
  DeploymentSmokeException,
  DeploymentSmokeOutcome,
} from "./deployment-smoke-policy.ts";
import type { S3StaticProvisionerPlanRef } from "./s3-static-provisioner-plan.ts";
import { S3_STATIC_PROVIDER } from "./contract.ts";
import { operatorErrorFields } from "./deployment-control-plane-redaction.ts";

export const S3_STATIC_RECORD_SCHEMA = "deploy-record@2026-04-09";

export type S3StaticDeployRecord = {
  schemaVersion: typeof S3_STATIC_RECORD_SCHEMA;
  deployRunId: string;
  operationKind: "deploy";
  runClassification: "deploy";
  lifecycleState: "finished";
  terminationReason: null;
  finalOutcome: "succeeded" | "publish_failed" | "smoke_failed_after_publish";
  deploymentId: string;
  deploymentLabel: string;
  provider: typeof S3_STATIC_PROVIDER;
  providerTarget: S3StaticDeployment["providerTarget"];
  providerTargetIdentity: string;
  artifact?: { identity: string; storedArtifactPath?: string; provenancePath?: string };
  admittedContext: S3StaticAdmittedContext;
  publisherType: string;
  provisionerType?: string;
  smokeOutcome?: DeploymentSmokeOutcome;
  smokeException?: DeploymentSmokeException;
  smokeError?: string;
  provisionerPlan?: S3StaticProvisionerPlanRef;
  deploymentMetadataFingerprint?: string;
  providerConfigFingerprint?: string;
  publicUrl?: string;
  providerReleaseId?: string;
  failedStep?: "publish" | "smoke";
  error?: string;
  errorFingerprint?: string;
};

export function createS3StaticDeployRunId(): string {
  return `deploy-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function createS3StaticDeployRecord(
  deployment: S3StaticDeployment,
  outcome: Omit<
    S3StaticDeployRecord,
    | "schemaVersion"
    | "deploymentId"
    | "deploymentLabel"
    | "provider"
    | "providerTarget"
    | "providerTargetIdentity"
    | "publisherType"
  >,
): S3StaticDeployRecord {
  return {
    schemaVersion: S3_STATIC_RECORD_SCHEMA,
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    provider: S3_STATIC_PROVIDER,
    providerTarget: deployment.providerTarget,
    providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
    publisherType: deployment.publisher.type,
    ...outcome,
    ...operatorErrorFields(outcome.error),
  };
}

export async function writeS3StaticDeployRecord(
  recordsRoot: string,
  record: S3StaticDeployRecord,
): Promise<string> {
  const recordPath = path.join(path.resolve(recordsRoot), "runs", `${record.deployRunId}.json`);
  await fsp.mkdir(path.dirname(recordPath), { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return recordPath;
}
