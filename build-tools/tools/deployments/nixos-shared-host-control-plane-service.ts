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
import { startNixosSharedHostControlPlaneServer } from "./nixos-shared-host-control-plane-server";
import type { ControlPlaneRuntimeConfig } from "./control-plane-runtime-config-types";

export async function startControlPlaneServiceFromRuntimeConfig(opts: {
  workspaceRoot: string;
  runtimeConfig: ControlPlaneRuntimeConfig;
}) {
  const objectStore = await artifactStoreFromRuntimeConfig(opts.runtimeConfig);
  assertProductionArtifactStore({ objectStore });
  const token = (await fsp.readFile(opts.runtimeConfig.service.tokenFile, "utf8")).trim();
  return await startNixosSharedHostControlPlaneServer({
    workspaceRoot: opts.workspaceRoot,
    paths: {
      statePath: path.join(opts.runtimeConfig.storage.runtimeRoot, "platform-state.json"),
      hostRoot: opts.runtimeConfig.storage.runtimeRoot,
      recordsRoot: opts.runtimeConfig.storage.recordsRoot,
      artifactStagingRoot: opts.runtimeConfig.storage.artifactStagingRoot,
    },
    backendDatabaseUrl: (await fsp.readFile(opts.runtimeConfig.database.urlFile, "utf8")).trim(),
    host: opts.runtimeConfig.service.host,
    port: opts.runtimeConfig.service.port,
    objectStore,
    instanceId: opts.runtimeConfig.instanceId,
    webUi: opts.runtimeConfig.webUi,
    mcp: opts.runtimeConfig.mcp,
    authProvider: opts.runtimeConfig.authProvider,
    miniMigrationPreflight: opts.runtimeConfig.miniMigrationPreflight,
    reviewedSourceCredentials: opts.runtimeConfig.reviewedSource,
    ...(token ? { token } : {}),
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
  const hostRoot = path.resolve(
    getFlagStr("host-root", path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host")),
  );
  const artifactStagingRoot = path.resolve(
    getFlagStr("artifact-staging-root", path.join(hostRoot, ".deploy-artifacts")),
  );
  const port = Number(getFlagStr("port", "7780").trim() || "7780");
  const host = getFlagStr("host", "127.0.0.1").trim() || "127.0.0.1";
  if (runtimeConfig && !getFlagStr("host-root", "").trim()) {
    if (getFlagStr("token", "").trim()) {
      throw new Error(
        "production service mode with --config requires service.tokenFile, not --token",
      );
    }
    const server = await startControlPlaneServiceFromRuntimeConfig({
      workspaceRoot,
      runtimeConfig,
    });
    console.log(JSON.stringify({ url: server.url }, null, 2));
    return server;
  }
  const backendDatabaseUrl =
    getFlagStr("control-plane-database-url", "").trim() ||
    (runtimeConfig ? (await fsp.readFile(runtimeConfig.database.urlFile, "utf8")).trim() : "") ||
    String(process.env.VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim();
  if (!backendDatabaseUrl) {
    throw new Error(
      "shared control-plane service requires --control-plane-database-url or VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL",
    );
  }
  const token =
    getFlagStr("token", "").trim() ||
    String(process.env.VBR_DEPLOY_CONTROL_PLANE_TOKEN || "").trim() ||
    undefined;
  assertProductionArtifactStore({ objectStore });
  const server = await startNixosSharedHostControlPlaneServer({
    workspaceRoot,
    paths: {
      statePath: path.resolve(getFlagStr("state", path.join(hostRoot, "platform-state.json"))),
      hostRoot,
      recordsRoot: path.resolve(getFlagStr("records-root", path.join(hostRoot, "records"))),
      artifactStagingRoot,
      ...(getFlagStr("host-config-out", "").trim()
        ? { hostConfigPath: path.resolve(getFlagStr("host-config-out", "").trim()) }
        : {}),
    },
    backendDatabaseUrl,
    host,
    port,
    ...(token ? { token } : {}),
    objectStore,
  });
  console.log(JSON.stringify({ url: server.url }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
