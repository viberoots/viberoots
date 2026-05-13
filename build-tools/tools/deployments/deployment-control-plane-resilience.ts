#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree } from "../lib/copy-tree";
import {
  resiliencePolicyForProtectionClass,
  type ProtectedDeploymentClass,
} from "./deployment-control-plane-resilience-policy";
import { validateRestoredCurrentStageState } from "./deployment-control-plane-restore-validation";

export const DEPLOYMENT_CONTROL_PLANE_RESILIENCE_STATUS_SCHEMA =
  "deployment-control-plane-resilience-status@1";

export type DeploymentControlPlaneResilienceStatus = {
  schemaVersion: typeof DEPLOYMENT_CONTROL_PLANE_RESILIENCE_STATUS_SCHEMA;
  protectionClass: ProtectedDeploymentClass;
  updatedAt: string;
  latestBackup?: {
    backupId: string;
    createdAt: string;
    backupPath: string;
  };
  latestRestoreTest?: {
    backupId: string;
    testedAt: string;
    backupPath: string;
    restoreRoot: string;
    restoredRunCount: number;
    restoredSubmissionCount: number;
    restoredCurrentStageStateCount: number;
    retainedArtifactReferenceCount: number;
    status: "passed" | "failed";
    error?: string;
  };
};

function resilienceDir(recordsRoot: string): string {
  return path.join(path.resolve(recordsRoot), "control-plane", "resilience");
}

function latestStatusPath(recordsRoot: string): string {
  return path.join(resilienceDir(recordsRoot), "latest.json");
}

function backupId(): string {
  return `backup-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function countJsonFiles(dir: string): Promise<number> {
  if (!(await pathExists(dir))) return 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const counts = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return await countJsonFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".json") ? 1 : 0;
    }),
  );
  return counts.reduce((sum, count) => sum + count, 0);
}

async function readStatus(
  recordsRoot: string,
): Promise<DeploymentControlPlaneResilienceStatus | undefined> {
  const filePath = latestStatusPath(recordsRoot);
  return (await pathExists(filePath))
    ? (JSON.parse(await fsp.readFile(filePath, "utf8")) as DeploymentControlPlaneResilienceStatus)
    : undefined;
}

async function writeStatus(
  recordsRoot: string,
  status: DeploymentControlPlaneResilienceStatus,
): Promise<void> {
  const filePath = latestStatusPath(recordsRoot);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(status, null, 2) + "\n", "utf8");
}

async function ensureParentOutsideRecordsRoot(
  recordsRoot: string,
  backupRoot: string,
): Promise<void> {
  const resolvedRecordsRoot = path.resolve(recordsRoot);
  const resolvedBackupRoot = path.resolve(backupRoot);
  if (
    resolvedBackupRoot === resolvedRecordsRoot ||
    resolvedBackupRoot.startsWith(`${resolvedRecordsRoot}${path.sep}`)
  ) {
    throw new Error("backup-root must be outside records-root to avoid recursive self-backup");
  }
}

export async function createDeploymentControlPlaneBackup(opts: {
  recordsRoot: string;
  backupRoot: string;
  protectionClass: ProtectedDeploymentClass;
}) {
  if (!resiliencePolicyForProtectionClass(opts.protectionClass)) {
    throw new Error(`unsupported protection class: ${opts.protectionClass}`);
  }
  await ensureParentOutsideRecordsRoot(opts.recordsRoot, opts.backupRoot);
  const id = backupId();
  const backupPath = path.join(path.resolve(opts.backupRoot), id);
  await copyTree(path.resolve(opts.recordsRoot), backupPath, { cloneMode: "try", force: true });
  const previous = await readStatus(opts.recordsRoot);
  const createdAt = new Date().toISOString();
  const status: DeploymentControlPlaneResilienceStatus = {
    schemaVersion: DEPLOYMENT_CONTROL_PLANE_RESILIENCE_STATUS_SCHEMA,
    protectionClass: opts.protectionClass,
    updatedAt: createdAt,
    latestBackup: {
      backupId: id,
      createdAt,
      backupPath,
    },
    ...(previous?.latestRestoreTest ? { latestRestoreTest: previous.latestRestoreTest } : {}),
  };
  await writeStatus(opts.recordsRoot, status);
  return { backupId: id, backupPath, status };
}

export async function runDeploymentControlPlaneRestoreTest(opts: {
  recordsRoot: string;
  backupRoot: string;
  restoreRoot: string;
  protectionClass: ProtectedDeploymentClass;
}) {
  const {
    backupId,
    backupPath,
    status: backupStatus,
  } = await createDeploymentControlPlaneBackup(opts);
  const restoreRoot = path.resolve(opts.restoreRoot);
  await fsp.rm(restoreRoot, { recursive: true, force: true });
  await copyTree(backupPath, restoreRoot, { cloneMode: "try", force: true });
  const runsDir = path.join(restoreRoot, "runs");
  const submissionsDir = path.join(restoreRoot, "control-plane", "submissions");
  const restoredRunCount = await countJsonFiles(runsDir);
  const restoredSubmissionCount = await countJsonFiles(submissionsDir);
  const stageStateValidation = await validateRestoredCurrentStageState({
    recordsRoot: opts.recordsRoot,
    restoreRoot,
  });
  const restoreError = stageStateValidation.failures.join("; ");
  const status: DeploymentControlPlaneResilienceStatus = {
    ...backupStatus,
    updatedAt: new Date().toISOString(),
    latestRestoreTest: {
      backupId,
      testedAt: new Date().toISOString(),
      backupPath,
      restoreRoot,
      restoredRunCount,
      restoredSubmissionCount,
      restoredCurrentStageStateCount: stageStateValidation.restoredCurrentStageStateCount,
      retainedArtifactReferenceCount: stageStateValidation.retainedArtifactReferenceCount,
      status: restoreError ? "failed" : "passed",
      ...(restoreError ? { error: restoreError } : {}),
    },
  };
  await writeStatus(opts.recordsRoot, status);
  return status;
}

export async function readDeploymentControlPlaneResilienceStatus(recordsRoot: string) {
  return await readStatus(recordsRoot);
}
