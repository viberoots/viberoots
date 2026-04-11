#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagStr } from "../lib/cli.ts";
import { findRepoRoot } from "../lib/repo.ts";
import { startNixosSharedHostControlPlaneWorkerLoop } from "./nixos-shared-host-control-plane-worker-loop.ts";

async function main() {
  const workspaceRoot = await findRepoRoot(process.cwd());
  const hostRoot = path.resolve(
    getFlagStr("host-root", path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host")),
  );
  const pollMs = Number(getFlagStr("poll-ms", "100").trim() || "100");
  const backendDatabaseUrl =
    getFlagStr("control-plane-database-url", "").trim() ||
    String(process.env.BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim();
  if (!backendDatabaseUrl) {
    throw new Error(
      "shared control-plane worker requires --control-plane-database-url or BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL",
    );
  }
  startNixosSharedHostControlPlaneWorkerLoop({
    workspaceRoot,
    recordsRoot: path.resolve(getFlagStr("records-root", path.join(hostRoot, "records"))),
    backendDatabaseUrl,
    pollMs,
  });
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
