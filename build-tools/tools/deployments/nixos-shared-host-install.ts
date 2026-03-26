#!/usr/bin/env zx-wrapper
import path from "node:path";
import { findRepoRoot } from "../lib/repo.ts";
import { getFlagBool, getFlagStr, getPositionals } from "../lib/cli.ts";
import {
  defaultManagedRoot,
  defaultRecordsRoot,
  defaultRuntimeRoot,
  defaultStatePath,
  manifestPathFor,
  type NixosSharedHostConfigTopology,
  type NixosSharedHostInstallMode,
} from "./nixos-shared-host-install-contract.ts";
import {
  installNixosSharedHostDevMachine,
  readDevMachineInstallInputFromStdin,
} from "./nixos-shared-host-install-dev-machine.ts";
import {
  installNixosSharedHost,
  statusNixosSharedHost,
  uninstallNixosSharedHost,
} from "./nixos-shared-host-install-host.ts";

function requireSubcommands(): [string, string] {
  const [scope = "", action = ""] = getPositionals();
  if (!scope || !action) {
    throw new Error(
      "usage: nixos-shared-host-install <host|dev-machine> <install|uninstall|status>",
    );
  }
  return [scope, action];
}

function maybeTopology(): NixosSharedHostConfigTopology | undefined {
  const value = getFlagStr("config-topology", "").trim();
  if (!value) return undefined;
  if (value !== "flake" && value !== "plain") {
    throw new Error(`unsupported --config-topology "${value}"`);
  }
  return value;
}

async function repoFingerprint(repoRoot: string): Promise<string> {
  const rev = await $({ cwd: repoRoot, stdio: "pipe" })`git rev-parse HEAD`.nothrow();
  const head = String(rev.stdout || "").trim();
  return head || `workspace:${repoRoot}`;
}

function requireHostConfigRoot(): string {
  const value = getFlagStr("config-root", "").trim();
  if (!value) throw new Error("missing required --config-root");
  return value;
}

async function runHostCommand(action: string, repoRoot: string) {
  const hostRoot = path.resolve(getFlagStr("host-root", "/"));
  const configRoot = action === "install" ? requireHostConfigRoot() : getFlagStr("config-root", "");
  const managedRoot = getFlagStr(
    "managed-root",
    configRoot ? defaultManagedRoot(configRoot) : "",
  ).trim();
  const manifestPath = getFlagStr(
    "manifest-path",
    managedRoot ? manifestPathFor(managedRoot) : "",
  ).trim();
  if (action === "install") {
    const installMode = (getFlagStr("install-mode", "emit-only").trim() ||
      "emit-only") as NixosSharedHostInstallMode;
    if (installMode !== "emit-only" && installMode !== "managed-dropin") {
      throw new Error(`unsupported --install-mode "${installMode}"`);
    }
    const result = await installNixosSharedHost({
      hostRoot,
      repoRoot,
      configRoot,
      configTopology: maybeTopology(),
      configEntryPath: getFlagStr("config-entry-path", "").trim() || undefined,
      managedRoot: managedRoot || undefined,
      statePath: getFlagStr("state-path", defaultStatePath()).trim(),
      runtimeRoot: getFlagStr("runtime-root", defaultRuntimeRoot()).trim(),
      recordsRoot: getFlagStr("records-root", defaultRecordsRoot()).trim(),
      installMode,
      toolFingerprint: await repoFingerprint(repoRoot),
      dryRun: getFlagBool("dry-run"),
    });
    console.log(JSON.stringify({ managed: true, ...result }, null, 2));
    return;
  }
  if (!manifestPath)
    throw new Error("missing required --manifest-path or --managed-root/--config-root");
  if (action === "uninstall") {
    console.log(
      JSON.stringify(
        await uninstallNixosSharedHost({
          hostRoot,
          manifestPath,
          dryRun: getFlagBool("dry-run"),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (action === "status") {
    console.log(JSON.stringify(await statusNixosSharedHost({ hostRoot, manifestPath }), null, 2));
    return;
  }
  throw new Error(`unsupported host action "${action}"`);
}

async function runDevMachineInstall(repoRoot: string) {
  const stdinInput = await readDevMachineInstallInputFromStdin();
  const fromFlag = (name: string, fallback = "") => getFlagStr(name, fallback).trim();
  const result = await installNixosSharedHostDevMachine({
    outputRoot: path.resolve(
      getFlagStr(
        "output-root",
        path.join(repoRoot, ".local", "deployments", "nixos-shared-host", "dev-machines"),
      ),
    ),
    toolFingerprint: await repoFingerprint(repoRoot),
    input: {
      profileName: fromFlag("profile", String(stdinInput.profileName || "default")),
      destination: fromFlag("destination", String(stdinInput.destination || "")),
      remoteRepoPath: fromFlag("remote-repo-path", String(stdinInput.remoteRepoPath || "")),
      remoteStatePath: fromFlag("remote-state-path", String(stdinInput.remoteStatePath || "")),
      remoteRuntimeRoot: fromFlag(
        "remote-runtime-root",
        String(stdinInput.remoteRuntimeRoot || ""),
      ),
      remoteRecordsRoot: fromFlag(
        "remote-records-root",
        String(stdinInput.remoteRecordsRoot || ""),
      ),
      sshMode: fromFlag("ssh-mode", String(stdinInput.sshMode || "ssh")),
    },
    dryRun: getFlagBool("dry-run"),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const repoRoot = await findRepoRoot(process.cwd());
  const [scope, action] = requireSubcommands();
  if (scope === "host") return await runHostCommand(action, repoRoot);
  if (scope === "dev-machine" && action === "install") return await runDevMachineInstall(repoRoot);
  throw new Error(`unsupported command "${scope} ${action}"`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
