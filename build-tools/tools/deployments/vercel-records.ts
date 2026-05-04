#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { DeploymentSmokeOutcome } from "./deployment-smoke-policy";
import { readVersionedJson } from "./deployment-schema-compat";
import type { VercelDeployment } from "./contract";

export const VERCEL_RECORD_SCHEMA = "vercel-deploy-record@2026-05-03";

export type VercelOperationKind =
  | "deploy"
  | "preview"
  | "preview_cleanup"
  | "rollback"
  | "retry"
  | "promotion";

export type VercelDeployRecord = {
  schemaVersion: typeof VERCEL_RECORD_SCHEMA;
  deployRunId: string;
  operationKind: VercelOperationKind;
  runClassification: VercelOperationKind;
  finalOutcome: "succeeded" | "publish_failed" | "smoke_failed_after_publish";
  deploymentId: string;
  deploymentLabel: string;
  provider: "vercel";
  providerTargetIdentity: string;
  artifact?: { identity: string; outputDir?: string };
  sourceRunId?: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  publicUrl?: string;
  providerReleaseId?: string;
  aliasAssigned?: boolean;
  smokeOutcome?: DeploymentSmokeOutcome;
  providerConfigFingerprint?: string;
  replaySnapshotPath?: string;
  error?: string;
  controlPlane?: {
    submissionId?: string;
    workerId?: string;
    lockScope: string;
    admission?: string;
  };
};

export function createVercelDeployRunId(prefix = "vercel"): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function createVercelDeployRecord(
  deployment: VercelDeployment,
  outcome: Omit<
    VercelDeployRecord,
    "schemaVersion" | "deploymentId" | "deploymentLabel" | "provider" | "providerTargetIdentity"
  >,
): VercelDeployRecord {
  return {
    schemaVersion: VERCEL_RECORD_SCHEMA,
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    provider: "vercel",
    providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
    ...outcome,
  };
}

export function vercelRecordPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(path.resolve(recordsRoot), "runs", `${deployRunId}.json`);
}

export async function writeVercelDeployRecord(
  recordsRoot: string,
  record: VercelDeployRecord,
): Promise<string> {
  const recordPath = vercelRecordPathFor(recordsRoot, record.deployRunId);
  await fsp.mkdir(path.dirname(recordPath), { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return recordPath;
}

export async function readVercelDeployRecord(recordPath: string): Promise<VercelDeployRecord> {
  return await readVersionedJson(recordPath, {
    kind: "vercel deploy record",
    currentSchemaVersion: VERCEL_RECORD_SCHEMA,
    migrations: {
      "vercel-deploy-record@2026-05-02": (raw) =>
        ({ ...raw, schemaVersion: VERCEL_RECORD_SCHEMA }) as VercelDeployRecord,
    },
    validateCurrent: (raw): raw is VercelDeployRecord =>
      raw.provider === "vercel" && typeof raw.deployRunId === "string",
  });
}
