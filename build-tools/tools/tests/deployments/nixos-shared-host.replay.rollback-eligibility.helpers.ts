#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostDeployment } from "../../deployments/contract";
import { syncBackendDeployRecord } from "../../deployments/nixos-shared-host-control-plane-backend";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane";
import { resolveNixosSharedHostReplaySelection } from "../../deployments/nixos-shared-host-replay";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

export type ReplayPaths = {
  statePath: string;
  hostRoot: string;
  recordsRoot: string;
};

export async function writeReplayArtifact(
  root: string,
  marker: string,
  includeHealthz = true,
): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${marker}</html>\n`, "utf8");
  if (includeHealthz) {
    await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
  }
}

export function replaySmokeConnect(port: number) {
  return { protocol: "https:" as const, hostname: "127.0.0.1", port, rejectUnauthorized: false };
}

export function replayPaths(tmp: string): ReplayPaths {
  return {
    statePath: path.join(tmp, "platform-state.json"),
    hostRoot: path.join(tmp, "host"),
    recordsRoot: path.join(tmp, "records"),
  };
}

export function replayDeploymentFixture(): NixosSharedHostDeployment {
  return nixosSharedHostDeploymentFixture({
    runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
  });
}

export function resolveReplaySelection(opts: {
  deployment: NixosSharedHostDeployment;
  recordsRoot: string;
  backendDatabaseUrl: string;
  sourceRunId: string;
  rollback: boolean;
}) {
  return resolveNixosSharedHostReplaySelection(opts);
}

export async function syncReplayRecord(
  paths: ReplayPaths,
  backendDatabaseUrl: string,
  recordPath: string,
) {
  await syncBackendDeployRecord(
    { recordsRoot: paths.recordsRoot, databaseUrl: backendDatabaseUrl },
    recordPath,
  );
}

export async function syncReplayRunId(
  paths: ReplayPaths,
  backendDatabaseUrl: string,
  deployRunId: string,
) {
  await syncReplayRecord(
    paths,
    backendDatabaseUrl,
    path.join(paths.recordsRoot, "runs", `${deployRunId}.json`),
  );
}

export async function submitReplaySourceRun(opts: {
  workspaceRoot: string;
  operationKind: "deploy" | "explicit_removal" | "retry" | "rollback";
  deployment: NixosSharedHostDeployment;
  artifactDir?: string;
  artifact?: unknown;
  componentArtifacts?: unknown;
  paths: ReplayPaths;
  publishBehavior?: "publish-only";
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  source?: unknown;
  admissionEvidence: unknown;
  smokeConnectOverride?: unknown;
  backendDatabaseUrl: string;
}) {
  const result = await submitNixosSharedHostControlPlaneRun({
    workspaceRoot: opts.workspaceRoot,
    operationKind: opts.operationKind,
    deployment: opts.deployment,
    ...(opts.artifactDir ? { artifactDir: opts.artifactDir } : {}),
    ...(opts.artifact ? { artifact: opts.artifact } : {}),
    ...(opts.componentArtifacts ? { componentArtifacts: opts.componentArtifacts } : {}),
    paths: opts.paths,
    ...(opts.publishBehavior ? { publishBehavior: opts.publishBehavior } : {}),
    ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
    ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
    ...(opts.artifactLineageId ? { artifactLineageId: opts.artifactLineageId } : {}),
    ...(opts.source ? { source: opts.source } : {}),
    admissionEvidence: opts.admissionEvidence,
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  });
  await syncReplayRecord(opts.paths, opts.backendDatabaseUrl, result.recordPath);
  return result;
}

export async function submitReplaySelectionRun(opts: {
  workspaceRoot: string;
  selection: any;
  paths: ReplayPaths;
  admissionEvidence: unknown;
  smokeConnectOverride?: unknown;
  backendDatabaseUrl: string;
}) {
  return await submitReplaySourceRun({
    workspaceRoot: opts.workspaceRoot,
    operationKind: opts.selection.operationKind,
    deployment: opts.selection.deployment,
    ...(opts.selection.artifact ? { artifact: opts.selection.artifact } : {}),
    ...(opts.selection.componentArtifacts
      ? { componentArtifacts: opts.selection.componentArtifacts }
      : {}),
    publishBehavior: "publish-only",
    parentRunId: opts.selection.parentRunId,
    artifactLineageId: opts.selection.artifactLineageId,
    ...(opts.selection.releaseLineageId
      ? { releaseLineageId: opts.selection.releaseLineageId }
      : {}),
    source: {
      record: opts.selection.sourceRecord,
      replaySnapshot: opts.selection.sourceReplaySnapshot,
    },
    paths: opts.paths,
    admissionEvidence: opts.admissionEvidence,
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    backendDatabaseUrl: opts.backendDatabaseUrl,
  } as any);
}
