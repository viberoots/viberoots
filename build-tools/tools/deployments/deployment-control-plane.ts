#!/usr/bin/env zx-wrapper
import { pathToFileURL } from "node:url";
import { getFlagStr, getPositionalsWithValueFlags } from "../lib/cli";
import { findRepoRoot } from "../lib/repo";
import { loadControlPlaneRuntimeConfig } from "./control-plane-runtime-config";
import { startControlPlaneServiceFromRuntimeConfig } from "./nixos-shared-host-control-plane-service";
import { startControlPlaneWorkerFromRuntimeConfig } from "./nixos-shared-host-control-plane-worker";

function command(): string {
  const [mode] = getPositionalsWithValueFlags(["config", "token", "poll-ms", "worker-id"]);
  if (mode !== "service" && mode !== "worker") {
    throw new Error("usage: deployment-control-plane <service|worker> --config <path>");
  }
  return mode;
}

export async function runDeploymentControlPlaneCommand() {
  const mode = command();
  const configPath = getFlagStr("config", "").trim();
  if (!configPath) throw new Error(`${mode} mode requires --config <path>`);
  const workspaceRoot = await findRepoRoot(process.cwd());
  const runtimeConfig = await loadControlPlaneRuntimeConfig({
    configPath,
    repoRoot: workspaceRoot,
  });
  if (mode === "service") {
    return await startControlPlaneServiceFromRuntimeConfig({
      workspaceRoot,
      runtimeConfig,
      ...(getFlagStr("token", "").trim() ? { token: getFlagStr("token", "").trim() } : {}),
    });
  }
  return startControlPlaneWorkerFromRuntimeConfig({
    workspaceRoot,
    runtimeConfig,
    pollMs: Number(getFlagStr("poll-ms", "100").trim() || "100"),
    ...(getFlagStr("worker-id", "").trim() ? { workerId: getFlagStr("worker-id", "").trim() } : {}),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDeploymentControlPlaneCommand()
    .then(async (processHandle: any) => {
      if (processHandle?.url) console.log(JSON.stringify({ url: processHandle.url }, null, 2));
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, async () => {
          await processHandle?.close?.();
          process.exit(0);
        });
      }
      if (command() === "worker") await new Promise(() => {});
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
