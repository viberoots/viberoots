#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostDeployment } from "./contract.ts";

export type NixosSharedHostDeployRecord = {
  version: 1;
  runId: string;
  operationKind: "deploy";
  publishMode: "normal";
  lifecycleState: "completed";
  finalOutcome: "succeeded" | "failed";
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  artifactIdentity?: string;
  publisherType: string;
  smokeRunnerType: "nixos-shared-host-static-webapp-smoke";
  publicUrl?: string;
  healthUrl?: string;
  error?: string;
};

export function createNixosSharedHostDeployRunId(): string {
  return `deploy-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function createNixosSharedHostDeployRecord(
  deployment: NixosSharedHostDeployment,
  outcome: Pick<
    NixosSharedHostDeployRecord,
    "runId" | "finalOutcome" | "artifactIdentity" | "publicUrl" | "healthUrl" | "error"
  >,
): NixosSharedHostDeployRecord {
  return {
    version: 1,
    runId: outcome.runId,
    operationKind: "deploy",
    publishMode: "normal",
    lifecycleState: "completed",
    finalOutcome: outcome.finalOutcome,
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    providerTargetIdentity: deployment.providerTarget.sharedDevTargetIdentity,
    ...(outcome.artifactIdentity ? { artifactIdentity: outcome.artifactIdentity } : {}),
    publisherType: deployment.publisher.type,
    smokeRunnerType: "nixos-shared-host-static-webapp-smoke",
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
  const recordPath = path.join(runsDir, `${record.runId}.json`);
  await fsp.mkdir(runsDir, { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return recordPath;
}
