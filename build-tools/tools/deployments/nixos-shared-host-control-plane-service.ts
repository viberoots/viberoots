#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagStr } from "../lib/cli.ts";
import { findRepoRoot } from "../lib/repo.ts";
import { startNixosSharedHostControlPlaneServer } from "./nixos-shared-host-control-plane-server.ts";

async function main() {
  const workspaceRoot = await findRepoRoot(process.cwd());
  const hostRoot = path.resolve(
    getFlagStr("host-root", path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host")),
  );
  const port = Number(getFlagStr("port", "7780").trim() || "7780");
  const host = getFlagStr("host", "127.0.0.1").trim() || "127.0.0.1";
  const token = getFlagStr("token", "").trim() || undefined;
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
