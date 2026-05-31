#!/usr/bin/env zx-wrapper
import { pathToFileURL } from "node:url";
import { getFlagBool, getFlagStr, getPositionalsWithValueFlags } from "../lib/cli";
import { findRepoRoot } from "../lib/repo";
import { loadControlPlaneRuntimeConfig } from "./control-plane-runtime-config";
import type {
  ControlPlaneProcessMode,
  ControlPlaneRuntimeConfig,
} from "./control-plane-runtime-config-types";
import {
  createControlPlaneCorrelationId,
  writeControlPlaneProcessLog,
} from "./control-plane-process-logging";
import { startControlPlaneServiceFromRuntimeConfig } from "./nixos-shared-host-control-plane-service";
import { startControlPlaneWorkerFromRuntimeConfig } from "./nixos-shared-host-control-plane-worker";
import { runCloudControlSetupCommand } from "./cloud-control-setup";
import { runCloudControlCutoverCommand } from "./cloud-control-cutover-cli";
import { runCloudControlSetupDoctorCommand } from "./cloud-control-setup-doctor";
import { runCredentialPreflightCommand } from "./control-plane-credential-preflight";
import { runControlPlaneManagedDependenciesCli } from "./control-plane-managed-dependencies";
import { runControlPlaneImagePublicationCommand } from "./control-plane-image-publication-cli";

function command():
  | "service"
  | "worker"
  | "setup"
  | "cutover"
  | "setup-doctor"
  | "credential-preflight"
  | "image-publication"
  | "managed-dependencies" {
  const [mode] = getPositionalsWithValueFlags([
    "artifact-backend",
    "artifact-backend-evidence",
    "artifact-bucket",
    "artifact-credential-mode",
    "artifact-iam-role-arn",
    "artifact-least-privilege-policy-digest",
    "artifact-region",
    "aws-topology-evidence",
    "auth-callback-host",
    "auth-callback-path",
    "config",
    "bundle-dir",
    "credential-directory",
    "deployment-id",
    "host-mode",
    "image",
    "instance-id",
    "out",
    "poll-ms",
    "profile",
    "process-mode",
    "public-url",
    "evidence",
    "expected-host-profile",
    "expected-region",
    "max-age-minutes",
    "operation",
    "image-build-identity",
    "image-publication-evidence",
    "image-tarball",
    "ingress-command-evidence",
    "published-digest",
    "registry-profile",
    "selected-capability",
    "reviewed-source-mode",
    "service-replicas",
    "skopeo",
    "source-revision",
    "tag",
    "token",
    "worker-id",
    "worker-replicas",
  ]);
  if (
    mode !== "service" &&
    mode !== "worker" &&
    mode !== "setup" &&
    mode !== "cutover" &&
    mode !== "setup-doctor" &&
    mode !== "credential-preflight" &&
    mode !== "image-publication" &&
    mode !== "managed-dependencies"
  ) {
    throw new Error(
      "usage: deployment-control-plane <service|worker|setup|image-publication|setup-doctor|credential-preflight|managed-dependencies|cutover>",
    );
  }
  return mode;
}

export async function runDeploymentControlPlaneCommand() {
  const mode = command();
  if (getFlagBool("help")) {
    console.log(`usage: deployment-control-plane ${mode} --config <path>`);
    return undefined;
  }
  if (mode === "setup") {
    await runCloudControlSetupCommand();
    return undefined;
  }
  if (mode === "cutover") {
    await runCloudControlCutoverCommand();
    return undefined;
  }
  if (mode === "setup-doctor") {
    await runCloudControlSetupDoctorCommand();
    return undefined;
  }
  if (mode === "credential-preflight") {
    await runCredentialPreflightCommand();
    return undefined;
  }
  if (mode === "image-publication") {
    await runControlPlaneImagePublicationCommand();
    return undefined;
  }
  if (mode === "managed-dependencies") {
    await runControlPlaneManagedDependenciesCli();
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
  const processMode = selectedProcessMode(runtimeConfig);
  assertProcessAllowed(mode, processMode);
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

function selectedProcessMode(runtimeConfig: ControlPlaneRuntimeConfig): ControlPlaneProcessMode {
  const override = getFlagStr("process-mode", "").trim();
  if (!override) return runtimeConfig.processMode;
  if (!["fully-enabled", "service-only", "worker-only", "fully-disabled"].includes(override)) {
    throw new Error(`unsupported process mode ${override}`);
  }
  return override as ControlPlaneProcessMode;
}

function assertProcessAllowed(mode: "service" | "worker", processMode: ControlPlaneProcessMode) {
  if (processMode === "fully-disabled") throw new Error("control-plane process mode is disabled");
  if (mode === "service" && processMode === "worker-only") {
    throw new Error("service mode is disabled by processMode worker-only");
  }
  if (mode === "worker" && processMode === "service-only") {
    throw new Error("worker mode is disabled by processMode service-only");
  }
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
