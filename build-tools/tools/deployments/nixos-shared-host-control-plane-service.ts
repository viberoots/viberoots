#!/usr/bin/env zx-wrapper
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getFlagStr } from "../lib/cli.ts";
import { findRepoRoot } from "../lib/repo.ts";
import { startNixosSharedHostControlPlaneServer } from "./nixos-shared-host-control-plane-server.ts";

export function resolveControlPlaneServiceToken(opts: {
  tokenFlag: string;
  env?: NodeJS.ProcessEnv;
}): string | undefined {
  return (
    opts.tokenFlag.trim() ||
    String((opts.env || process.env).BNX_DEPLOY_CONTROL_PLANE_TOKEN || "").trim() ||
    undefined
  );
}

async function main() {
  const workspaceRoot = await findRepoRoot(process.cwd());
  const hostRoot = path.resolve(
    getFlagStr("host-root", path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host")),
  );
  const artifactStagingRoot = path.resolve(
    getFlagStr("artifact-staging-root", path.join(hostRoot, ".deploy-artifacts")),
  );
  const port = Number(getFlagStr("port", "7780").trim() || "7780");
  const host = getFlagStr("host", "127.0.0.1").trim() || "127.0.0.1";
  const token = resolveControlPlaneServiceToken({ tokenFlag: getFlagStr("token", "") });
  const backendDatabaseUrl =
    getFlagStr("control-plane-database-url", "").trim() ||
    String(process.env.BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim();
  if (!backendDatabaseUrl) {
    throw new Error(
      "shared control-plane service requires --control-plane-database-url or BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL",
    );
  }
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
  });
  console.log(JSON.stringify({ url: server.url }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
