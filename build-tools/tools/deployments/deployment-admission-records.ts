#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type {
  DeploymentAdmissionApprovalFact,
  DeploymentAdmissionCheckFact,
  DeploymentAdmissionPolicyEvaluation,
} from "./deployment-admission-evidence.ts";

export type DeploymentRunRecordLike = {
  deployRunId: string;
  deploymentId: string;
  finalOutcome?: string;
  artifactLineageId?: string;
  artifact?: { identity?: string };
  publicUrl?: string;
  healthUrl?: string;
  admittedContext?: {
    source?: { sourceRevision?: string };
    policyEvaluation?: DeploymentAdmissionPolicyEvaluation;
  };
};

export function defaultDeploymentRecordRoots(workspaceRoot: string, recordsRoot: string): string[] {
  return Array.from(
    new Set([
      path.resolve(recordsRoot),
      path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host", "records"),
      path.join(workspaceRoot, ".local", "deployments", "cloudflare-pages", "records"),
      path.join(workspaceRoot, ".local", "deployments", "s3-static", "records"),
      path.join(workspaceRoot, ".local", "deployments", "app-store-connect", "records"),
    ]),
  );
}

async function runRecordPaths(recordsRoot: string): Promise<string[]> {
  const runsDir = path.join(path.resolve(recordsRoot), "runs");
  try {
    const entries = await fsp.readdir(runsDir);
    return entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => path.join(runsDir, entry));
  } catch {
    return [];
  }
}

async function readRecord(recordPath: string): Promise<DeploymentRunRecordLike | undefined> {
  try {
    return JSON.parse(await fsp.readFile(recordPath, "utf8")) as DeploymentRunRecordLike;
  } catch {
    return undefined;
  }
}

export async function latestSuccessfulDeploymentRecord(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  deploymentId: string;
}): Promise<{ record: DeploymentRunRecordLike; recordPath: string } | undefined> {
  const hits: Array<{ record: DeploymentRunRecordLike; recordPath: string; mtimeMs: number }> = [];
  for (const root of defaultDeploymentRecordRoots(opts.workspaceRoot, opts.recordsRoot)) {
    for (const recordPath of await runRecordPaths(root)) {
      const record = await readRecord(recordPath);
      if (
        !record ||
        record.deploymentId !== opts.deploymentId ||
        record.finalOutcome !== "succeeded"
      ) {
        continue;
      }
      const stat = await fsp.stat(recordPath).catch(() => undefined);
      hits.push({ record, recordPath, mtimeMs: stat?.mtimeMs || 0 });
    }
  }
  return hits.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
}

export function sourceAdmissionChecks(
  record?: DeploymentRunRecordLike,
): DeploymentAdmissionCheckFact[] {
  return record?.admittedContext?.policyEvaluation?.requiredChecks || [];
}

export function sourceAdmissionApprovals(
  record?: DeploymentRunRecordLike,
): DeploymentAdmissionApprovalFact[] {
  return record?.admittedContext?.policyEvaluation?.requiredApprovals || [];
}

export function sourceAdmissionBinding(record?: DeploymentRunRecordLike) {
  return record?.admittedContext?.policyEvaluation?.binding;
}
