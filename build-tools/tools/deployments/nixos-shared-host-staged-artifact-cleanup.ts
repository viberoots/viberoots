#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { redactDeploymentAuthText } from "./deployment-auth-redaction.ts";
import {
  stagedUploadCompleteMarkerPath,
  stagedUploadTempPath,
} from "./nixos-shared-host-staged-artifact.ts";
import {
  queryBackend,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db.ts";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract.ts";

export type StagedArtifactCleanupReason =
  | "challenge_rejected"
  | "submit_rejected"
  | "remote_client_rejected";

type CleanupRef = {
  artifactDir: string;
  submissionId?: string;
  deploymentId?: string;
  reason: StagedArtifactCleanupReason;
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

function stagingRootFor(paths: NixosSharedHostControlPlanePaths): string {
  return path.resolve(paths.artifactStagingRoot || path.join(paths.hostRoot, ".deploy-artifacts"));
}

function insideRoot(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function chmodWritable(filePath: string): Promise<void> {
  let stat;
  try {
    stat = await fsp.lstat(filePath);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) return;
  await fsp.chmod(filePath, stat.mode | 0o700).catch(() => {});
  if (!stat.isDirectory()) return;
  for (const entry of await fsp.readdir(filePath)) {
    await chmodWritable(path.join(filePath, entry));
  }
}

async function canonicalCleanupPath(filePath: string): Promise<string> {
  try {
    return await fsp.realpath(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function janitorMetadata(ref: CleanupRef, root: string, error: unknown) {
  const resolved = path.resolve(ref.artifactDir);
  const errorCode =
    error && typeof error === "object" && "code" in error ? String((error as any).code) : "error";
  return {
    schemaVersion: "nixos-shared-host-staged-artifact-janitor@1",
    reason: ref.reason,
    ...(ref.submissionId ? { submissionId: ref.submissionId } : {}),
    ...(ref.deploymentId ? { deploymentId: ref.deploymentId } : {}),
    stagedReference: {
      rootBasename: path.basename(root),
      basename: path.basename(resolved),
      sha256: crypto.createHash("sha256").update(resolved).digest("hex"),
    },
    cleanupError: redactDeploymentAuthText(`cleanup failed (${errorCode})`),
  };
}

export async function writeStagedArtifactJanitorRecord(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  ref: CleanupRef;
  stagingRoot: string;
  error: unknown;
}) {
  const now = new Date().toISOString();
  await queryBackend(
    opts.backend,
    `INSERT INTO artifact_cleanup_janitor_records
       (record_id, submission_id, deployment_id, reason, document_json, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      `janitor-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      opts.ref.submissionId || null,
      opts.ref.deploymentId || null,
      opts.ref.reason,
      JSON.stringify(janitorMetadata(opts.ref, opts.stagingRoot, opts.error)),
      now,
    ],
  );
  await queryBackend(
    opts.backend,
    `DELETE FROM artifact_cleanup_janitor_records
     WHERE record_id NOT IN (
       SELECT record_id FROM artifact_cleanup_janitor_records
       ORDER BY created_at DESC
       LIMIT 100
     )`,
  );
}

async function removeCleanupTarget(root: string, target: string): Promise<void> {
  const canonical = await canonicalCleanupPath(target);
  if (!insideRoot(root, canonical)) return;
  if (await pathExists(canonical)) await chmodWritable(canonical);
  await fsp.rm(canonical, { recursive: true, force: true });
}

async function cleanupOne(ref: CleanupRef, root: string): Promise<"removed" | "skipped"> {
  const finalPath = await canonicalCleanupPath(ref.artifactDir);
  if (!insideRoot(root, finalPath)) return "skipped";
  const targets = [
    ref.artifactDir,
    stagedUploadTempPath(ref.artifactDir),
    stagedUploadCompleteMarkerPath(ref.artifactDir),
  ];
  for (const target of targets) {
    await removeCleanupTarget(root, target);
  }
  return "removed";
}

export async function cleanupRejectedStagedArtifacts(opts: {
  paths: NixosSharedHostControlPlanePaths;
  backend: NixosSharedHostControlPlaneBackendTarget;
  refs: CleanupRef[];
}) {
  const stagingRoot = stagingRootFor(opts.paths);
  await fsp.mkdir(stagingRoot, { recursive: true });
  const root = await fsp.realpath(stagingRoot);
  for (const ref of opts.refs) {
    try {
      await cleanupOne(ref, root);
    } catch (error) {
      await writeStagedArtifactJanitorRecord({
        backend: opts.backend,
        ref,
        stagingRoot: root,
        error,
      });
    }
  }
}
