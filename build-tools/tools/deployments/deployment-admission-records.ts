#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  readBackendLatestDeployRecordEnvelopeByDeploymentId,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import type {
  DeploymentAdmissionApprovalFact,
  DeploymentAdmissionCheckFact,
  DeploymentAdmissionPolicyEvaluation,
} from "./deployment-admission-evidence";

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
      path.join(workspaceRoot, ".local", "deployments", "kubernetes", "records"),
      path.join(workspaceRoot, ".local", "deployments", "app-store-connect", "records"),
      path.join(workspaceRoot, ".local", "deployments", "google-play", "records"),
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
  provider?: string;
  backendDatabaseUrl?: string;
}): Promise<
  { record: DeploymentRunRecordLike; sourceDeployRunId: string; recordPath?: string } | undefined
> {
  const sharedHostBackendDatabaseUrl =
    opts.backendDatabaseUrl ||
    String(process.env.BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim();
  if (opts.provider === "nixos-shared-host") {
    if (!sharedHostBackendDatabaseUrl) {
      throw new Error(
        "shared admission lookup requires backendDatabaseUrl for backend-only record reads",
      );
    }
    const backend: NixosSharedHostControlPlaneBackendTarget = {
      recordsRoot: path.resolve(opts.recordsRoot),
      databaseUrl: sharedHostBackendDatabaseUrl,
    };
    const hit = await readBackendLatestDeployRecordEnvelopeByDeploymentId(backend, {
      deploymentId: opts.deploymentId,
      finalOutcome: "succeeded",
    });
    if (!hit) return undefined;
    return {
      record: hit.record as DeploymentRunRecordLike,
      sourceDeployRunId: String((hit.record as DeploymentRunRecordLike).deployRunId),
    };
  }
  if (!opts.provider && sharedHostBackendDatabaseUrl) {
    const backend: NixosSharedHostControlPlaneBackendTarget = {
      recordsRoot: path.resolve(opts.recordsRoot),
      databaseUrl: sharedHostBackendDatabaseUrl,
    };
    const hit = await readBackendLatestDeployRecordEnvelopeByDeploymentId(backend, {
      deploymentId: opts.deploymentId,
      finalOutcome: "succeeded",
    });
    if (hit) {
      return {
        record: hit.record as DeploymentRunRecordLike,
        sourceDeployRunId: String((hit.record as DeploymentRunRecordLike).deployRunId),
      };
    }
  }
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
  const latest = hits.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  return latest
    ? {
        record: latest.record,
        sourceDeployRunId: latest.record.deployRunId,
        recordPath: latest.recordPath,
      }
    : undefined;
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
