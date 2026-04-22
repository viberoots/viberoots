#!/usr/bin/env zx-wrapper
import path from "node:path";
import { findRepoRoot } from "../lib/repo.ts";
import { getFlagBool, getFlagStr, getPositionals, hasFlag } from "../lib/cli.ts";
import { mergeFlatPromptObjects } from "../json-prompt-lib.ts";
import {
  defaultManagedRoot,
  defaultRecordsRoot,
  defaultRuntimeRoot,
  defaultStatePath,
  hostPath,
  legacyDefaultManagedRoot,
  manifestPathFor,
  type NixosSharedHostConfigTopology,
  type NixosSharedHostInstallMode,
} from "./nixos-shared-host-install-contract.ts";
import {
  type ClientInput,
  installNixosSharedHostClient,
  listNixosSharedHostClients,
  uninstallNixosSharedHostClient,
} from "./nixos-shared-host-install-dev-machine.ts";
import {
  maybePromptClientInstallInput,
  maybePromptServerInstallInput,
} from "./nixos-shared-host-install-prompt.ts";
import { readStructuredInstallInputFromStdin } from "./nixos-shared-host-install-stdin.ts";
import {
  installNixosSharedHost,
  statusNixosSharedHost,
  uninstallNixosSharedHost,
} from "./nixos-shared-host-install-host.ts";
import { pathExists } from "./nixos-shared-host-install-host-support.ts";

type HostInstallInput = {
  serverRoot: string;
  configRoot: string;
  configEntryPath: string;
  managedRoot: string;
  statePath: string;
  runtimeRoot: string;
  recordsRoot: string;
  configTopology: NixosSharedHostConfigTopology;
  installMode: NixosSharedHostInstallMode;
  dryRun: boolean;
};

function requireSubcommands(): [string, string] {
  const [scope = "", action = ""] = getPositionals();
  if (!scope || !action)
    throw new Error("usage: nixos-shared-host-install <server|client> <install|uninstall|status>");
  return [scope, action];
}

async function repoFingerprint(repoRoot: string): Promise<string> {
  const rev = await $({ cwd: repoRoot, stdio: "pipe" })`git rev-parse HEAD`.nothrow();
  const head = String(rev.stdout || "").trim();
  return head || `workspace:${repoRoot}`;
}

async function runServerCommand(action: string, repoRoot: string) {
  const fromOptionalFlag = (name: string) => {
    const value = getFlagStr(name, "").trim();
    return value ? value : undefined;
  };
  const stdinInput: Partial<HostInstallInput> =
    action === "install"
      ? await readStructuredInstallInputFromStdin<HostInstallInput>("server install")
      : {};
  const fromBool = (name: string, fallback = false) =>
    hasFlag(name) ? getFlagBool(name) : fallback;
  const mergedServerInput = mergeFlatPromptObjects(action === "install" ? stdinInput : undefined, {
    serverRoot: fromOptionalFlag("server-root"),
    configRoot: fromOptionalFlag("config-root"),
    configEntryPath: fromOptionalFlag("config-entry-path"),
    managedRoot: fromOptionalFlag("managed-root"),
    statePath: fromOptionalFlag("state-path"),
    runtimeRoot: fromOptionalFlag("runtime-root"),
    recordsRoot: fromOptionalFlag("records-root"),
    configTopology: fromOptionalFlag("config-topology") as
      | NixosSharedHostConfigTopology
      | undefined,
    installMode: fromOptionalFlag("install-mode") as NixosSharedHostInstallMode | undefined,
  });
  const promptInput =
    action === "install"
      ? await maybePromptServerInstallInput(mergedServerInput)
      : mergedServerInput;
  const hostRoot = path.resolve(String(promptInput.serverRoot || "/"));
  const configRoot = String(promptInput.configRoot || "");
  if (action === "install" && !configRoot) throw new Error("missing required --config-root");
  const managedRoot =
    String(promptInput.managedRoot || "") || (configRoot ? defaultManagedRoot(configRoot) : "");
  let manifestPath = getFlagStr(
    "manifest-path",
    managedRoot ? manifestPathFor(managedRoot) : "",
  ).trim();
  if (action === "install") {
    const installMode = String(promptInput.installMode || "") as NixosSharedHostInstallMode;
    if (
      installMode !== "emit-only" &&
      installMode !== "managed-manual-wire" &&
      installMode !== "managed-dropin"
    ) {
      throw new Error(`unsupported --install-mode "${installMode}"`);
    }
    const topologyValue = String(promptInput.configTopology || "").trim();
    const configTopology =
      topologyValue === "flake" || topologyValue === "plain"
        ? (topologyValue as NixosSharedHostConfigTopology)
        : undefined;
    const result = await installNixosSharedHost({
      hostRoot,
      repoRoot,
      configRoot,
      configTopology,
      configEntryPath: String(promptInput.configEntryPath || "") || undefined,
      managedRoot: managedRoot || undefined,
      statePath: String(promptInput.statePath || defaultStatePath()),
      runtimeRoot: String(promptInput.runtimeRoot || defaultRuntimeRoot()),
      recordsRoot: String(promptInput.recordsRoot || defaultRecordsRoot()),
      installMode,
      toolFingerprint: await repoFingerprint(repoRoot),
      dryRun: fromBool("dry-run", Boolean(stdinInput.dryRun)),
    });
    console.log(JSON.stringify({ managed: true, ...result }, null, 2));
    return;
  }
  if (!manifestPath)
    throw new Error("missing required --manifest-path or --managed-root/--config-root");
  if (
    !hasFlag("manifest-path") &&
    !hasFlag("managed-root") &&
    configRoot &&
    !(await pathExists(hostPath(hostRoot, manifestPath)))
  ) {
    const legacyManifestPath = manifestPathFor(legacyDefaultManagedRoot(configRoot));
    if (await pathExists(hostPath(hostRoot, legacyManifestPath))) {
      manifestPath = legacyManifestPath;
    }
  }
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
  throw new Error(`unsupported server action "${action}"`);
}

async function runClientInstall(repoRoot: string) {
  const stdinInput = await readStructuredInstallInputFromStdin<ClientInput>("client");
  const fromOptionalFlag = (name: string) => {
    const value = getFlagStr(name, "").trim();
    return value ? value : undefined;
  };
  const mergedInstallInput = mergeFlatPromptObjects(stdinInput, {
    profileName: fromOptionalFlag("profile"),
    destination: fromOptionalFlag("destination"),
    remoteRepoPath: fromOptionalFlag("remote-repo-path"),
    remoteStatePath: fromOptionalFlag("remote-state-path"),
    remoteRuntimeRoot: fromOptionalFlag("remote-runtime-root"),
    remoteRecordsRoot: fromOptionalFlag("remote-records-root"),
    sshMode: fromOptionalFlag("ssh-mode"),
    controlPlaneUrl: fromOptionalFlag("control-plane-url"),
    controlPlaneTokenEnv: fromOptionalFlag("control-plane-token-env"),
  });
  const promptInput = await maybePromptClientInstallInput(repoRoot, mergedInstallInput);
  const result = await installNixosSharedHostClient({
    outputRoot: path.resolve(
      getFlagStr(
        "output-root",
        path.join(repoRoot, ".local", "deployments", "nixos-shared-host", "clients"),
      ),
    ),
    toolFingerprint: await repoFingerprint(repoRoot),
    input: {
      profileName: String(promptInput.profileName || ""),
      destination: String(promptInput.destination || ""),
      remoteRepoPath: String(promptInput.remoteRepoPath || ""),
      remoteStatePath: String(promptInput.remoteStatePath || ""),
      remoteRuntimeRoot: String(promptInput.remoteRuntimeRoot || ""),
      remoteRecordsRoot: String(promptInput.remoteRecordsRoot || ""),
      sshMode: String(promptInput.sshMode || ""),
      controlPlaneUrl: String(promptInput.controlPlaneUrl || ""),
      controlPlaneTokenEnv: String(promptInput.controlPlaneTokenEnv || "") || undefined,
    },
    dryRun: getFlagBool("dry-run"),
  });
  console.log(JSON.stringify(result, null, 2));
}

function clientOutputRoot(repoRoot: string): string {
  return path.resolve(
    getFlagStr(
      "output-root",
      path.join(repoRoot, ".local", "deployments", "nixos-shared-host", "clients"),
    ),
  );
}

async function runClientCommand(action: string, repoRoot: string) {
  if (action === "install") return await runClientInstall(repoRoot);
  const outputRoot = clientOutputRoot(repoRoot);
  if (action === "list") {
    console.log(JSON.stringify(await listNixosSharedHostClients({ outputRoot }), null, 2));
    return;
  }
  if (action === "uninstall") {
    const profileName = getFlagStr("profile", "").trim() || undefined;
    console.log(
      JSON.stringify(
        await uninstallNixosSharedHostClient({
          outputRoot,
          profileName,
          all: hasFlag("all"),
          dryRun: getFlagBool("dry-run"),
        }),
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(`unsupported client action "${action}"`);
}

async function main() {
  const repoRoot = await findRepoRoot(process.cwd());
  const [scope, action] = requireSubcommands();
  if (scope === "server") return await runServerCommand(action, repoRoot);
  if (scope === "client") return await runClientCommand(action, repoRoot);
  throw new Error(`unsupported command "${scope} ${action}"`);
}

main().catch((error) => (console.error(error), process.exit(1)));
