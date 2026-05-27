#!/usr/bin/env zx-wrapper
import { pathToFileURL } from "node:url";
import { getFlagBool, getFlagStr, getPositionalsWithValueFlags } from "../lib/cli";
import { findRepoRoot } from "../lib/repo";
import { loadControlPlaneRuntimeConfig } from "./control-plane-runtime-config";
import {
  createControlPlaneCorrelationId,
  writeControlPlaneProcessLog,
} from "./control-plane-process-logging";
import { startControlPlaneServiceFromRuntimeConfig } from "./nixos-shared-host-control-plane-service";
import { startControlPlaneWorkerFromRuntimeConfig } from "./nixos-shared-host-control-plane-worker";

function command(): "service" | "worker" {
  const [mode] = getPositionalsWithValueFlags(["config", "token", "poll-ms", "worker-id"]);
  if (mode !== "service" && mode !== "worker") {
    throw new Error("usage: deployment-control-plane <service|worker> --config <path>");
  }
  return mode;
}

export async function runDeploymentControlPlaneCommand() {
  const mode = command();
  if (getFlagBool("help")) {
    console.log(`usage: deployment-control-plane ${mode} --config <path>`);
    return undefined;
  }
  const correlationId = createControlPlaneCorrelationId(mode);
  const configPath = getFlagStr("config", "").trim();
  if (!configPath) throw new Error(`${mode} mode requires --config <path>`);
  const workspaceRoot = await findRepoRoot(process.cwd());
  const runtimeConfig = await loadControlPlaneRuntimeConfig({
    configPath,
    repoRoot: workspaceRoot,
  });
  writeControlPlaneProcessLog(undefined, {
    event: "process_starting",
    correlationId,
    mode,
    instanceId: runtimeConfig.instanceId,
  });
  if (mode === "service") {
    const explicitToken = getFlagStr("token", "").trim();
    if (explicitToken) {
      throw new Error(
        "production service mode with --config requires service.tokenFile, not --token",
      );
    }
    const service = await startControlPlaneServiceFromRuntimeConfig({
      workspaceRoot,
      runtimeConfig,
    });
    writeControlPlaneProcessLog(undefined, {
      event: "process_ready",
      correlationId,
      mode,
      instanceId: runtimeConfig.instanceId,
    });
    return service;
  }
  const worker = await startControlPlaneWorkerFromRuntimeConfig({
    workspaceRoot,
    runtimeConfig,
    pollMs: Number(getFlagStr("poll-ms", "100").trim() || "100"),
    correlationId,
    ...(getFlagStr("worker-id", "").trim() ? { workerId: getFlagStr("worker-id", "").trim() } : {}),
  });
  writeControlPlaneProcessLog(undefined, {
    event: "process_ready",
    correlationId,
    mode,
    instanceId: runtimeConfig.instanceId,
  });
  return worker;
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
      if (command() === "worker" && !getFlagBool("help")) await new Promise(() => {});
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
