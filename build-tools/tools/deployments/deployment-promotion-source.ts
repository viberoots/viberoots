#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  resolveAppStoreConnectReplaySource,
  type AppStoreConnectReplaySnapshot,
} from "./app-store-connect-replay.ts";
import {
  resolveCloudflarePagesReplaySource,
  type CloudflarePagesReplaySnapshot,
} from "./cloudflare-pages-replay.ts";
import {
  readBackendDeployRecordEnvelopeByDeployRunId,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend.ts";
import {
  resolveGooglePlayReplaySource,
  type GooglePlayReplaySnapshot,
} from "./google-play-replay.ts";
import {
  nixosSharedHostReplayArtifactIdentity,
  resolveNixosSharedHostReplaySource,
  type NixosSharedHostReplaySnapshot,
} from "./nixos-shared-host-replay.ts";
import type { DeploymentPromotionSource } from "./deployment-promotion-types.ts";

export type {
  AppStoreConnectReplaySnapshot,
  CloudflarePagesReplaySnapshot,
  GooglePlayReplaySnapshot,
  NixosSharedHostReplaySnapshot,
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function defaultRecordsRoots(workspaceRoot: string, recordsRoot: string): string[] {
  return Array.from(
    new Set([
      path.resolve(recordsRoot),
      path.join(workspaceRoot, ".local", "deployments", "cloudflare-pages", "records"),
      path.join(workspaceRoot, ".local", "deployments", "app-store-connect", "records"),
      path.join(workspaceRoot, ".local", "deployments", "google-play", "records"),
    ]),
  );
}

function sharedPromotionBackendError(): Error {
  return new Error(
    "shared promotion source lookup requires backendDatabaseUrl or BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL",
  );
}

async function resolvePromotionSourceByPath(
  recordPath: string,
  opts?: { backendDatabaseUrl?: string },
): Promise<DeploymentPromotionSource> {
  const raw = JSON.parse(await fsp.readFile(recordPath, "utf8")) as { provider?: string };
  if (raw.provider === "nixos-shared-host") {
    const backendDatabaseUrl =
      opts?.backendDatabaseUrl ||
      String(process.env.BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim();
    if (!backendDatabaseUrl) {
      throw sharedPromotionBackendError();
    }
    const sourceRecord = raw as { deployRunId?: string };
    if (!sourceRecord.deployRunId) {
      throw new Error(`shared promotion source record is missing deployRunId: ${recordPath}`);
    }
    const source = await resolveNixosSharedHostReplaySource({
      recordsRoot: path.dirname(path.dirname(recordPath)),
      backendDatabaseUrl,
      deployRunId: sourceRecord.deployRunId,
    });
    return {
      record: source.record,
      replaySnapshot: source.replaySnapshot,
      replaySnapshotPath: source.record.replaySnapshotPath || "",
      ...(source.replaySnapshot.publishInput.kind === "exact-artifact"
        ? { artifact: source.replaySnapshot.publishInput.artifact }
        : {}),
      artifactIdentity: nixosSharedHostReplayArtifactIdentity(source.replaySnapshot),
    };
  }
  if (raw.provider === "app-store-connect") {
    const source = await resolveAppStoreConnectReplaySource({ recordPath });
    return {
      record: source.record,
      replaySnapshot: source.replaySnapshot,
      replaySnapshotPath: source.record.replaySnapshotPath || "",
      artifactIdentity: source.replaySnapshot.artifact.identity,
      artifact: source.replaySnapshot.artifact,
    };
  }
  if (raw.provider === "google-play") {
    const source = await resolveGooglePlayReplaySource({ recordPath });
    return {
      record: source.record,
      replaySnapshot: source.replaySnapshot,
      replaySnapshotPath: source.record.replaySnapshotPath || "",
      artifactIdentity: source.replaySnapshot.artifact.identity,
      artifact: source.replaySnapshot.artifact,
    };
  }
  if (raw.provider === "cloudflare-pages") {
    const source = await resolveCloudflarePagesReplaySource({ recordPath });
    return {
      record: source.record,
      replaySnapshot: source.replaySnapshot,
      replaySnapshotPath: source.record.replaySnapshotPath || "",
      artifactIdentity: source.replaySnapshot.artifact.identity,
      artifact: source.replaySnapshot.artifact,
    };
  }
  throw new Error(`unsupported promotion source record: ${recordPath}`);
}

async function resolveSharedHostPromotionSourceFromBackend(opts: {
  recordsRoot: string;
  backendDatabaseUrl: string;
  sourceRunId: string;
}): Promise<DeploymentPromotionSource | undefined> {
  const backend: NixosSharedHostControlPlaneBackendTarget = {
    recordsRoot: path.resolve(opts.recordsRoot),
    databaseUrl: opts.backendDatabaseUrl,
  };
  const envelope = await readBackendDeployRecordEnvelopeByDeployRunId(backend, opts.sourceRunId);
  if (!envelope) return undefined;
  const source = await resolveNixosSharedHostReplaySource({
    recordsRoot: path.resolve(opts.recordsRoot),
    backendDatabaseUrl: opts.backendDatabaseUrl,
    deployRunId: opts.sourceRunId,
  });
  return {
    record: source.record,
    replaySnapshot: source.replaySnapshot,
    replaySnapshotPath: source.record.replaySnapshotPath || "",
    ...(source.replaySnapshot.publishInput.kind === "exact-artifact"
      ? { artifact: source.replaySnapshot.publishInput.artifact }
      : {}),
    artifactIdentity: nixosSharedHostReplayArtifactIdentity(source.replaySnapshot),
  };
}

async function resolveCloudflarePagesPromotionSourceFromBackend(opts: {
  recordsRoot: string;
  backendDatabaseUrl: string;
  sourceRunId: string;
}): Promise<DeploymentPromotionSource | undefined> {
  const backend: NixosSharedHostControlPlaneBackendTarget = {
    recordsRoot: path.resolve(opts.recordsRoot),
    databaseUrl: opts.backendDatabaseUrl,
  };
  const envelope = await readBackendDeployRecordEnvelopeByDeployRunId(backend, opts.sourceRunId);
  if (!envelope || (envelope.record as { provider?: string }).provider !== "cloudflare-pages") {
    return undefined;
  }
  const source = await resolveCloudflarePagesReplaySource({
    recordsRoot: path.resolve(opts.recordsRoot),
    backendDatabaseUrl: opts.backendDatabaseUrl,
    deployRunId: opts.sourceRunId,
  });
  return {
    record: source.record,
    replaySnapshot: source.replaySnapshot,
    replaySnapshotPath: source.record.replaySnapshotPath || "",
    artifactIdentity: source.replaySnapshot.artifact.identity,
    artifact: source.replaySnapshot.artifact,
  };
}

export async function resolveDeploymentPromotionSourceRecordPath(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  sourceRunId: string;
  backendDatabaseUrl?: string;
}): Promise<string | undefined> {
  const sharedHostBackendDatabaseUrl =
    opts.backendDatabaseUrl ||
    String(process.env.BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim();
  if (sharedHostBackendDatabaseUrl) {
    const backend: NixosSharedHostControlPlaneBackendTarget = {
      recordsRoot: path.resolve(opts.recordsRoot),
      databaseUrl: sharedHostBackendDatabaseUrl,
    };
    const backendRecord = await readBackendDeployRecordEnvelopeByDeployRunId(
      backend,
      opts.sourceRunId,
    );
    const backendProvider = (backendRecord?.record as { provider?: string } | undefined)?.provider;
    if (backendProvider === "nixos-shared-host" || backendProvider === "cloudflare-pages") {
      return undefined;
    }
  }
  for (const root of defaultRecordsRoots(opts.workspaceRoot, opts.recordsRoot)) {
    const recordPath = path.join(root, "runs", `${opts.sourceRunId}.json`);
    if (!(await pathExists(recordPath))) continue;
    const raw = JSON.parse(await fsp.readFile(recordPath, "utf8")) as { provider?: string };
    if (raw.provider === "nixos-shared-host") {
      throw sharedPromotionBackendError();
    }
    return path.resolve(recordPath);
  }
  return undefined;
}

export async function resolveDeploymentPromotionSource(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  sourceRunId: string;
  backendDatabaseUrl?: string;
}): Promise<DeploymentPromotionSource> {
  const sharedHostBackendDatabaseUrl =
    opts.backendDatabaseUrl ||
    String(process.env.BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim();
  if (sharedHostBackendDatabaseUrl) {
    const sharedHostSource = await resolveSharedHostPromotionSourceFromBackend({
      recordsRoot: opts.recordsRoot,
      backendDatabaseUrl: sharedHostBackendDatabaseUrl,
      sourceRunId: opts.sourceRunId,
    });
    if (sharedHostSource) return sharedHostSource;
    const cloudflareSource = await resolveCloudflarePagesPromotionSourceFromBackend({
      recordsRoot: opts.recordsRoot,
      backendDatabaseUrl: sharedHostBackendDatabaseUrl,
      sourceRunId: opts.sourceRunId,
    });
    if (cloudflareSource) return cloudflareSource;
  }
  for (const root of defaultRecordsRoots(opts.workspaceRoot, opts.recordsRoot)) {
    const recordPath = path.join(root, "runs", `${opts.sourceRunId}.json`);
    if (await pathExists(recordPath)) {
      const raw = JSON.parse(await fsp.readFile(recordPath, "utf8")) as { provider?: string };
      if (raw.provider === "nixos-shared-host") {
        throw sharedPromotionBackendError();
      }
      return await resolvePromotionSourceByPath(recordPath, {
        backendDatabaseUrl: opts.backendDatabaseUrl,
      });
    }
  }
  throw new Error(`promotion source run not found: ${opts.sourceRunId}`);
}
