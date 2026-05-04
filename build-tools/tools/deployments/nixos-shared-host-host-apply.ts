#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFlagBool, getFlagList, getFlagStr, hasFlag } from "../lib/cli";
import { scrubDeploymentSecretEnv } from "./deployment-secret-env";
import {
  defaultManagedRoot,
  hostPath,
  manifestPathFor,
  normalizeHostLogicalPath,
  type NixosSharedHostInstallManifestV1,
} from "./nixos-shared-host-install-contract";
import { statusNixosSharedHost } from "./nixos-shared-host-install-host";
import { pathExists } from "./nixos-shared-host-install-host-support";

const execFileAsync = promisify(execFile);
const APPLY_MAX_BUFFER = 10 * 1024 * 1024;

export type NixosSharedHostHostApplyMode = "switch" | "dry-run";

export type NixosSharedHostHostApplySummary = {
  mode: NixosSharedHostHostApplyMode;
  applied: boolean;
  command: string[];
  configTopology: NixosSharedHostInstallManifestV1["configTopology"];
  configRoot: string;
  managedRoot: string;
  configEntryPath?: string;
  statePath: string;
  runtimeRoot: string;
  recordsRoot: string;
  wiringState: "wired";
  restartedServices?: string[];
};

function commandFailure(step: string, error: any): Error {
  const exitCode =
    typeof error?.code === "number"
      ? error.code
      : typeof error?.exitCode === "number"
        ? error.exitCode
        : 1;
  const details = [
    String(error?.stderr || "").trim(),
    String(error?.stdout || "").trim(),
    `exit=${exitCode}`,
  ]
    .filter(Boolean)
    .join("\n");
  return new Error(`${step}\n${details}`.trim());
}

function requireExistingHostPath(
  hostRoot: string,
  logicalPath: string,
  label: string,
): Promise<void> {
  const physicalPath = hostPath(hostRoot, logicalPath);
  return pathExists(physicalPath).then((exists) => {
    if (!exists) {
      throw new Error(`remote host apply preflight failed: missing ${label}: ${logicalPath}`);
    }
  });
}

async function requireExistingRemotePath(flagName: string, label: string): Promise<void> {
  if (!hasFlag(flagName)) return;
  const raw = getFlagStr(flagName, "").trim();
  if (!raw) {
    throw new Error(`remote host apply preflight failed: --${flagName} requires a non-empty value`);
  }
  const value = normalizeHostLogicalPath(raw);
  if (!(await pathExists(value))) {
    throw new Error(`remote host apply preflight failed: missing ${label}: ${value}`);
  }
}

function selectedMode(): NixosSharedHostHostApplyMode {
  return getFlagBool("dry-run") ? "dry-run" : "switch";
}

function nixosRebuildPrefix(): string[] {
  return typeof process.getuid === "function" && process.getuid() === 0 ? [] : ["sudo"];
}

function privilegedCommandPrefix(): string[] {
  return typeof process.getuid === "function" && process.getuid() === 0 ? [] : ["sudo"];
}

function buildApplyArgv(
  manifest: NixosSharedHostInstallManifestV1,
  mode: NixosSharedHostHostApplyMode,
): string[] {
  const action = mode === "dry-run" ? "dry-activate" : "switch";
  const argv = [...nixosRebuildPrefix(), "nixos-rebuild", action];
  if (manifest.configTopology === "flake") {
    argv.push("--flake", manifest.configRoot);
  } else if (manifest.configEntryPath) {
    argv.push("-I", `nixos-config=${manifest.configEntryPath}`);
  }
  return argv;
}

async function runApply(argv: string[]): Promise<void> {
  const [file, ...args] = argv;
  try {
    await execFileAsync(file, args, {
      encoding: "utf8",
      env: scrubDeploymentSecretEnv(),
      maxBuffer: APPLY_MAX_BUFFER,
    });
  } catch (error: any) {
    throw commandFailure("remote host apply failed", error);
  }
}

function restartServices(): string[] {
  return getFlagList("restart-service")
    .map((service) => service.trim())
    .filter(Boolean)
    .map((service) => {
      if (!/^[A-Za-z0-9_.@-]+$/.test(service)) {
        throw new Error(`remote host apply preflight failed: invalid service name ${service}`);
      }
      return service;
    });
}

async function restartService(service: string): Promise<void> {
  const [file, ...args] = [...privilegedCommandPrefix(), "systemctl", "restart", service];
  try {
    await execFileAsync(file, args, {
      encoding: "utf8",
      env: scrubDeploymentSecretEnv(),
      maxBuffer: APPLY_MAX_BUFFER,
    });
  } catch (error: any) {
    throw commandFailure(`remote host apply failed while restarting ${service}`, error);
  }
}

export async function runNixosSharedHostHostApply(): Promise<NixosSharedHostHostApplySummary> {
  const hostRoot = getFlagStr(
    "server-root",
    String(process.env.NIXOS_SHARED_HOST_SERVER_ROOT || "/"),
  ).trim();
  const configRoot = normalizeHostLogicalPath(getFlagStr("config-root", "/etc/nixos"));
  const managedRoot = hasFlag("managed-root")
    ? normalizeHostLogicalPath(getFlagStr("managed-root", ""))
    : defaultManagedRoot(configRoot);
  const status = await statusNixosSharedHost({
    hostRoot,
    manifestPath: manifestPathFor(managedRoot),
  });
  if (!status.managed || !status.manifest) {
    throw new Error(
      `remote host apply preflight failed: ${managedRoot} is not a managed nixos-shared-host install`,
    );
  }
  if (status.wiringState === "missing") {
    throw new Error("remote host apply preflight failed: managed wiring is missing");
  }
  if (status.wiringState !== "wired") {
    throw new Error("remote host apply preflight failed: managed wiring is not inspectable");
  }
  const manifest = status.manifest;
  await Promise.all([
    requireExistingHostPath(hostRoot, manifest.configRoot, "managed config root"),
    requireExistingHostPath(
      hostRoot,
      manifest.managedEntryPoints.modulePath,
      "managed host module",
    ),
    requireExistingHostPath(
      hostRoot,
      manifest.managedEntryPoints.anchorPath,
      "managed host anchor",
    ),
    requireExistingHostPath(hostRoot, manifest.statePath, "managed platform state"),
    requireExistingRemotePath("expected-state-path", "reviewed remote state path"),
    requireExistingRemotePath("expected-runtime-root", "reviewed remote runtime root"),
    requireExistingRemotePath("expected-records-root", "reviewed remote records root"),
    ...(manifest.configEntryPath
      ? [requireExistingHostPath(hostRoot, manifest.configEntryPath, "managed config entry")]
      : []),
  ]);
  const mode = selectedMode();
  const command = buildApplyArgv(manifest, mode);
  const servicesToRestart = restartServices();
  await runApply(command);
  if (mode === "switch") {
    for (const service of servicesToRestart) {
      await restartService(service);
    }
  }
  return {
    mode,
    applied: mode === "switch",
    command,
    configTopology: manifest.configTopology,
    configRoot: manifest.configRoot,
    managedRoot: manifest.managedRoot,
    ...(manifest.configEntryPath ? { configEntryPath: manifest.configEntryPath } : {}),
    statePath: manifest.statePath,
    runtimeRoot: manifest.runtimeRoot,
    recordsRoot: manifest.recordsRoot,
    wiringState: "wired",
    ...(mode === "switch" && servicesToRestart.length > 0
      ? { restartedServices: servicesToRestart }
      : {}),
  };
}

async function main() {
  console.log(JSON.stringify(await runNixosSharedHostHostApply(), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
