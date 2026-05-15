#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { VercelDeployment } from "./contract";
import { readVersionedJson } from "./deployment-schema-compat";
import {
  assertReplayAdmissionMatchesRecord,
  requireReplayAdmittedContext,
} from "./deployment-replay-admission";
import type { VercelAdmittedContext } from "./vercel-admission";
import { readVercelDeployRecord } from "./vercel-records";
import { restoreDurableArtifactObjectReferences } from "./control-plane-artifact-durable-refs";
import type { ControlPlaneArtifactObject } from "./control-plane-artifact-store-types";

export const VERCEL_REPLAY_SNAPSHOT_SCHEMA = "vercel-replay-snapshot@1";

export type VercelReplaySnapshot = {
  schemaVersion: typeof VERCEL_REPLAY_SNAPSHOT_SCHEMA;
  deployRunId: string;
  createdAt: string;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  deployment: VercelDeployment;
  artifact: { identity: string; outputDir?: string; object?: ControlPlaneArtifactObject };
  providerReleaseId: string;
  publicUrl: string;
  aliasAssigned: boolean;
  providerConfigFingerprint: string;
  admittedContext: VercelAdmittedContext;
};

export function vercelReplaySnapshotPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(path.resolve(recordsRoot), "replay", deployRunId, "snapshot.json");
}

export async function writeVercelReplaySnapshot(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: VercelDeployment;
  artifact: { identity: string; outputDir?: string; object?: ControlPlaneArtifactObject };
  providerReleaseId: string;
  publicUrl: string;
  aliasAssigned: boolean;
  providerConfigFingerprint: string;
  admittedContext: VercelAdmittedContext;
}): Promise<string> {
  const replaySnapshotPath = vercelReplaySnapshotPathFor(opts.recordsRoot, opts.deployRunId);
  const admittedContext = requireReplayAdmittedContext({
    provider: "vercel",
    admittedContext: opts.admittedContext,
  });
  const snapshot: VercelReplaySnapshot = {
    schemaVersion: VERCEL_REPLAY_SNAPSHOT_SCHEMA,
    deployRunId: opts.deployRunId,
    createdAt: new Date().toISOString(),
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    deployment: opts.deployment,
    artifact: restoreDurableArtifactObjectReferences(structuredClone(opts.artifact)),
    providerReleaseId: opts.providerReleaseId,
    publicUrl: opts.publicUrl,
    aliasAssigned: opts.aliasAssigned,
    providerConfigFingerprint: opts.providerConfigFingerprint,
    admittedContext,
  };
  await fsp.mkdir(path.dirname(replaySnapshotPath), { recursive: true });
  await fsp.writeFile(replaySnapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  return replaySnapshotPath;
}

export type VercelReplaySource = {
  record: Awaited<ReturnType<typeof readVercelDeployRecord>>;
  recordPath: string;
  replaySnapshot: VercelReplaySnapshot;
};

export async function resolveVercelReplaySource(opts: {
  recordsRoot: string;
  deployRunId: string;
}): Promise<VercelReplaySource> {
  const recordPath = path.join(path.resolve(opts.recordsRoot), "runs", `${opts.deployRunId}.json`);
  const record = await readVercelDeployRecord(recordPath);
  if (!record.replaySnapshotPath) {
    throw new Error(`vercel deploy record is missing replaySnapshotPath: ${record.deployRunId}`);
  }
  if (record.finalOutcome !== "succeeded") {
    throw new Error(
      `vercel replay source run is not successful: ${record.deployRunId} (${record.finalOutcome})`,
    );
  }
  const replaySnapshot = await readVersionedJson(record.replaySnapshotPath, {
    kind: "vercel replay snapshot",
    currentSchemaVersion: VERCEL_REPLAY_SNAPSHOT_SCHEMA,
    validateCurrent: (raw): raw is VercelReplaySnapshot =>
      typeof raw.deployRunId === "string" && typeof raw.providerReleaseId === "string",
  });
  requireReplayAdmittedContext({
    provider: "vercel",
    admittedContext: replaySnapshot.admittedContext,
  });
  assertReplayAdmissionMatchesRecord({
    provider: "vercel",
    record,
    replaySnapshot,
  });
  return { record, recordPath, replaySnapshot };
}
