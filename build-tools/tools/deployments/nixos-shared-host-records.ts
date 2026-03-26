#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  NIXOS_SHARED_HOST_PROVIDER,
  type NixosSharedHostDeployment,
  type NixosSharedHostProviderTarget,
} from "./contract.ts";

export const NIXOS_SHARED_HOST_RECORD_SCHEMA = "deploy-record@2026-03-25";

export type NixosSharedHostRunClassification = "deploy" | "explicit_removal";
export type NixosSharedHostFinalOutcome =
  | "succeeded"
  | "provision_failed"
  | "publish_failed"
  | "smoke_failed_after_publish";
export type NixosSharedHostFailedStep = "provision" | "publish" | "smoke";

export type NixosSharedHostDeployRecord = {
  schemaVersion: typeof NIXOS_SHARED_HOST_RECORD_SCHEMA;
  deployRunId: string;
  operationKind: "deploy";
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
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  artifact?: {
    identity: string;
  };
  failedStep?: NixosSharedHostFailedStep;
  provisionerType?: string;
  publisherType?: string;
  smokeRunnerType?: "nixos-shared-host-static-webapp-smoke";
  publicUrl?: string;
  healthUrl?: string;
  error?: string;
};

type NixosSharedHostRecordOutcome = {
  deployRunId: string;
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
    operationKind: "deploy",
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
    providerTargetIdentity: deployment.providerTarget.sharedDevTargetIdentity,
    ...(outcome.parentRunId ? { parentRunId: outcome.parentRunId } : {}),
    ...(outcome.releaseLineageId ? { releaseLineageId: outcome.releaseLineageId } : {}),
    ...(outcome.artifactLineageId ? { artifactLineageId: outcome.artifactLineageId } : {}),
    ...(outcome.artifactIdentity ? { artifact: { identity: outcome.artifactIdentity } } : {}),
    ...(outcome.failedStep ? { failedStep: outcome.failedStep } : {}),
    ...(deployment.provisioner ? { provisionerType: deployment.provisioner.type } : {}),
    ...(outcome.runClassification === "deploy"
      ? {
          publisherType: deployment.publisher.type,
          smokeRunnerType: "nixos-shared-host-static-webapp-smoke" as const,
        }
      : {}),
    ...(outcome.publicUrl ? { publicUrl: outcome.publicUrl } : {}),
    ...(outcome.healthUrl ? { healthUrl: outcome.healthUrl } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
  };
}

export async function writeNixosSharedHostDeployRecord(
  recordsRoot: string,
  record: NixosSharedHostDeployRecord,
): Promise<string> {
  const runsDir = path.join(recordsRoot, "runs");
  const recordPath = path.join(runsDir, `${record.deployRunId}.json`);
  await fsp.mkdir(runsDir, { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return recordPath;
}
