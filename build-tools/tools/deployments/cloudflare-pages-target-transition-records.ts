#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { DeploymentTargetException } from "./deployment-target-exceptions.ts";

export const CLOUDFLARE_PAGES_TARGET_TRANSITION_RECORD_SCHEMA =
  "cloudflare-pages-target-transition-record@1";

export type CloudflarePagesTargetTransitionRecord = {
  schemaVersion: typeof CLOUDFLARE_PAGES_TARGET_TRANSITION_RECORD_SCHEMA;
  deployRunId: string;
  operationKind: "retire_target" | "migrate_target";
  runClassification: "retire_target" | "migrate_target";
  finalOutcome: "succeeded";
  deploymentId: string;
  deploymentLabel: string;
  provider: "cloudflare-pages";
  providerTargetIdentity: string;
  oldProviderTargetIdentity: string;
  newProviderTargetIdentity?: string;
  sharedLockScope: string;
  requestedBy: { principalId: string; displayName?: string };
  authorization: {
    principal: { principalId: string; displayName?: string };
    role: string;
    scope: { kind: string; value: string };
  };
  targetException: DeploymentTargetException;
  resultingOwnershipState:
    | { kind: "retired"; ownerDeploymentId: null }
    | { kind: "migrated"; ownerDeploymentId: string; providerTargetIdentity: string };
  controlPlane: {
    submissionId: string;
    submissionPath: string;
    executionSnapshotPath: string;
    lockScope: string;
    workerId: string;
  };
};

export async function writeTransitionRecord(
  recordsRoot: string,
  record: CloudflarePagesTargetTransitionRecord,
): Promise<string> {
  const recordPath = path.join(
    path.resolve(recordsRoot),
    "target-transitions",
    `${record.deployRunId}.json`,
  );
  await fsp.mkdir(path.dirname(recordPath), { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return recordPath;
}
