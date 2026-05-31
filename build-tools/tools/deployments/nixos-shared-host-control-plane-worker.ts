#!/usr/bin/env zx-wrapper
import path from "node:path";
import * as fsp from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getFlagStr } from "../lib/cli";
import { findRepoRoot } from "../lib/repo";
import {
  artifactStoreFromRuntimeConfig,
  assertProductionArtifactStore,
} from "./control-plane-artifact-store";
import { loadControlPlaneRuntimeConfig } from "./control-plane-runtime-config";
import type { ControlPlaneRuntimeConfig } from "./control-plane-runtime-config-types";
import type { AwsCredentialProvider } from "./control-plane-aws-imds-credentials";
import { createControlPlaneCredentialDirectory } from "./control-plane-credentials";
import type { ControlPlaneProcessLogger } from "./control-plane-process-logging";
import { startNixosSharedHostControlPlaneWorkerLoop } from "./nixos-shared-host-control-plane-worker-loop";

export async function startControlPlaneWorkerFromRuntimeConfig(opts: {
  workspaceRoot: string;
  runtimeConfig: ControlPlaneRuntimeConfig;
  pollMs?: number;
  workerId?: string;
  logger?: ControlPlaneProcessLogger;
  correlationId?: string;
  artifactCredentialProvider?: AwsCredentialProvider;
}) {
  const objectStore = await artifactStoreFromRuntimeConfig(opts.runtimeConfig, {
    credentialProvider: opts.artifactCredentialProvider,
  });
  const credentialDirectory = createControlPlaneCredentialDirectory(opts.runtimeConfig, {
    repoRoot: opts.workspaceRoot,
  });
  assertProductionArtifactStore({ objectStore });
  return startNixosSharedHostControlPlaneWorkerLoop({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.runtimeConfig.storage.recordsRoot,
    backendDatabaseUrl: (await fsp.readFile(opts.runtimeConfig.database.urlFile, "utf8")).trim(),
    objectStore,
    credentialDirectory,
    reviewedSourceCredentials: opts.runtimeConfig.reviewedSource,
    instanceId: opts.runtimeConfig.instanceId,
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
    ...(opts.pollMs ? { pollMs: opts.pollMs } : {}),
    ...(opts.workerId ? { workerId: opts.workerId } : {}),
  });
}

async function main() {
  const workspaceRoot = await findRepoRoot(process.cwd());
  const configPath = getFlagStr("config", "").trim();
  const runtimeConfig = configPath
    ? await loadControlPlaneRuntimeConfig({ configPath, repoRoot: workspaceRoot })
    : undefined;
  const objectStore = runtimeConfig
    ? await artifactStoreFromRuntimeConfig(runtimeConfig)
    : undefined;
  const workerId = getFlagStr("worker-id", "").trim() || undefined;
  const pollMs = Number(getFlagStr("poll-ms", "100").trim() || "100");
  if (runtimeConfig && !getFlagStr("host-root", "").trim()) {
    startControlPlaneWorkerFromRuntimeConfig({
      workspaceRoot,
      runtimeConfig,
      pollMs,
      workerId,
    });
    await new Promise(() => {});
    return;
  }
  const hostRoot = path.resolve(
    getFlagStr("host-root", path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host")),
  );
  const backendDatabaseUrl =
    getFlagStr("control-plane-database-url", "").trim() ||
    (runtimeConfig ? (await fsp.readFile(runtimeConfig.database.urlFile, "utf8")).trim() : "") ||
    String(process.env.VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim();
  if (!backendDatabaseUrl) {
    throw new Error(
      "shared control-plane worker requires --control-plane-database-url or VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL",
    );
  }
  assertProductionArtifactStore({ objectStore });
  startNixosSharedHostControlPlaneWorkerLoop({
    workspaceRoot,
    recordsRoot: path.resolve(getFlagStr("records-root", path.join(hostRoot, "records"))),
    backendDatabaseUrl,
    pollMs,
    workerId,
    objectStore,
  });
  await new Promise(() => {});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
