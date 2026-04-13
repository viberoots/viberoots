#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  resiliencePolicyForProtectionClass,
  type ProtectedDeploymentClass,
} from "./deployment-control-plane-resilience-policy.ts";

type EvidenceLike = {
  requiredChecks?: Array<{ recordRef?: string }>;
  requiredApprovals?: Array<{ recordRef?: string }>;
  prerequisites?: Array<{ healthEvidenceRef?: string }>;
  attestation?: { recordRef?: string };
  sbom?: { recordRef?: string };
  supplyChainGates?: Array<{ recordRef?: string }>;
};

type ArtifactLike = {
  identity: string;
  storedArtifactPath?: string;
  provenancePath?: string;
};

type RetentionInspection = {
  protectionClass: ProtectedDeploymentClass;
  deployRunId: string;
  artifactRetentionDeadline?: string;
  recordRetentionDeadline?: string;
  replayBundleComplete: boolean;
  replayUsable: boolean;
  deletionAllowed: boolean;
  failures: string[];
  missingPaths: string[];
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTimestampFromJson(filePath: string, key: string): Promise<string | undefined> {
  try {
    const value = JSON.parse(await fsp.readFile(filePath, "utf8")) as Record<string, unknown>;
    return typeof value[key] === "string" ? String(value[key]) : undefined;
  } catch {
    return undefined;
  }
}

function addDays(timestamp: string, days: number): string | undefined {
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at)) return undefined;
  return new Date(at + days * 24 * 60 * 60 * 1000).toISOString();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function isFileBackedEvidenceRef(value: string): boolean {
  return path.isAbsolute(value) || value.endsWith(".json");
}

function requiredEvidencePaths(evidence?: EvidenceLike): string[] {
  if (!evidence) return [];
  return uniqueStrings([
    ...(evidence.requiredChecks || []).map((entry) => entry.recordRef || ""),
    ...(evidence.requiredApprovals || []).map((entry) => entry.recordRef || ""),
    ...(evidence.prerequisites || []).map((entry) => entry.healthEvidenceRef || ""),
    evidence.laneGovernance?.recordRef || "",
    evidence.attestation?.recordRef || "",
    evidence.sbom?.recordRef || "",
    ...(evidence.supplyChainGates || []).map((entry) => entry.recordRef || ""),
  ]).filter(isFileBackedEvidenceRef);
}

export async function inspectProtectedSharedRetention(opts: {
  protectionClass: ProtectedDeploymentClass;
  deployRunId: string;
  recordPath: string;
  recordUpdatedAt?: string;
  requireRecordPathInBundle?: boolean;
  replaySnapshotPath: string;
  replayCreatedAt?: string;
  artifacts: ArtifactLike[];
  replayBundlePaths: string[];
  evidence?: EvidenceLike;
  now?: Date;
}): Promise<RetentionInspection> {
  const policy = resiliencePolicyForProtectionClass(opts.protectionClass);
  if (!policy) throw new Error(`unsupported protection class: ${opts.protectionClass}`);
  const now = opts.now || new Date();
  const failures: string[] = [];
  const missingPaths: string[] = [];
  const bundlePaths = uniqueStrings([
    opts.requireRecordPathInBundle === false ? "" : opts.recordPath,
    opts.replaySnapshotPath,
    ...opts.replayBundlePaths,
    ...requiredEvidencePaths(opts.evidence),
    ...opts.artifacts.flatMap((artifact) => [
      artifact.storedArtifactPath || "",
      artifact.provenancePath || "",
    ]),
  ]).map((filePath) => path.resolve(filePath));
  for (const filePath of bundlePaths) {
    if (!(await pathExists(filePath))) missingPaths.push(filePath);
  }
  const replayCreatedAt =
    opts.replayCreatedAt || (await readTimestampFromJson(opts.replaySnapshotPath, "createdAt"));
  const artifactAdmittedAt = await Promise.all(
    opts.artifacts
      .map((artifact) => artifact.provenancePath)
      .filter((value): value is string => !!value)
      .map((filePath) => readTimestampFromJson(filePath, "admittedAt")),
  );
  const retentionAnchor = artifactAdmittedAt.find(Boolean) || replayCreatedAt;
  const artifactRetentionDeadline =
    retentionAnchor && addDays(retentionAnchor, policy.minimumArtifactRetentionDays);
  const artifactWindowExpired =
    !!artifactRetentionDeadline && now.toISOString() > artifactRetentionDeadline;
  if (artifactRetentionDeadline && now.toISOString() > artifactRetentionDeadline) {
    failures.push(
      `required retained artifact window expired for ${opts.deployRunId} at ${artifactRetentionDeadline}`,
    );
  }
  const recordRetentionAnchor = opts.recordUpdatedAt
    ? Date.parse(opts.recordUpdatedAt)
    : (await fsp.stat(opts.recordPath)).mtimeMs;
  const recordRetentionDeadline = new Date(
    recordRetentionAnchor + policy.minimumRecordRetentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const recordWindowExpired = now.toISOString() > recordRetentionDeadline;
  if (!recordWindowExpired) {
    failures.push(
      `authoritative record retention window remains in effect for ${opts.deployRunId} until ${recordRetentionDeadline}`,
    );
  }
  for (const artifact of opts.artifacts) {
    const storedArtifactPath = artifact.storedArtifactPath
      ? path.resolve(artifact.storedArtifactPath)
      : "";
    if (storedArtifactPath && missingPaths.includes(storedArtifactPath)) {
      failures.push(
        `recorded exact artifact is unavailable or removed: ${artifact.identity} (${storedArtifactPath})`,
      );
    }
  }
  if (missingPaths.length > 0) {
    failures.push(
      `replay bundle is incomplete for ${opts.deployRunId}; missing retained paths:\n${missingPaths.join("\n")}`,
    );
  }
  return {
    protectionClass: opts.protectionClass,
    deployRunId: opts.deployRunId,
    ...(artifactRetentionDeadline ? { artifactRetentionDeadline } : {}),
    recordRetentionDeadline,
    replayBundleComplete: missingPaths.length === 0,
    replayUsable: !artifactWindowExpired && missingPaths.length === 0,
    deletionAllowed: artifactWindowExpired && recordWindowExpired,
    failures,
    missingPaths,
  };
}

export async function assertProtectedSharedReplayUsable(opts: {
  protectionClass: ProtectedDeploymentClass;
  deployRunId: string;
  recordPath: string;
  recordUpdatedAt?: string;
  requireRecordPathInBundle?: boolean;
  replaySnapshotPath: string;
  replayCreatedAt?: string;
  artifacts: ArtifactLike[];
  replayBundlePaths: string[];
  evidence?: EvidenceLike;
}): Promise<void> {
  const inspection = await inspectProtectedSharedRetention(opts);
  const failures = inspection.failures.filter(
    (entry) => !entry.startsWith("authoritative record retention window remains in effect"),
  );
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}

export async function assertProtectedSharedDeletionAllowed(opts: {
  protectionClass: ProtectedDeploymentClass;
  deployRunId: string;
  recordPath: string;
  recordUpdatedAt?: string;
  requireRecordPathInBundle?: boolean;
  replaySnapshotPath: string;
  replayCreatedAt?: string;
  artifacts: ArtifactLike[];
  replayBundlePaths: string[];
  evidence?: EvidenceLike;
  now?: Date;
}): Promise<void> {
  const inspection = await inspectProtectedSharedRetention(opts);
  if (!inspection.deletionAllowed) {
    throw new Error(
      `retention policy blocks deleting ${opts.deployRunId}:\n${inspection.failures.join("\n")}`,
    );
  }
}
