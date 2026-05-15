#!/usr/bin/env zx-wrapper
import path from "node:path";
import * as fsp from "node:fs/promises";
import { getFlagStr } from "../lib/cli";
import { findRepoRoot } from "../lib/repo";
import {
  artifactStoreFromRuntimeConfig,
  assertProductionArtifactStore,
} from "./control-plane-artifact-store";
import { loadControlPlaneRuntimeConfig } from "./control-plane-runtime-config";
import { startNixosSharedHostControlPlaneWorkerLoop } from "./nixos-shared-host-control-plane-worker-loop";

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
  const pollMs = Number(getFlagStr("poll-ms", "100").trim() || "100");
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
    objectStore,
  });
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
