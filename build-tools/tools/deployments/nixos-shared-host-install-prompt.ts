#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  completeJsonPromptObject,
  mergeFlatPromptObjects,
  promptOptionsFromRuleSet,
  type JsonPromptObject,
  type JsonPromptRuleSet,
} from "../json-prompt-lib.ts";
import {
  defaultRecordsRoot,
  defaultRuntimeRoot,
  defaultStatePath,
  type NixosSharedHostConfigTopology,
  type NixosSharedHostInstallMode,
} from "./nixos-shared-host-install-contract.ts";

type PromptRunner = (
  input: JsonPromptObject,
  rules: JsonPromptRuleSet,
) => Promise<JsonPromptObject>;

export type HostInstallPromptInput = {
  hostRoot?: string;
  configRoot?: string;
  configEntryPath?: string;
  managedRoot?: string;
  statePath?: string;
  runtimeRoot?: string;
  recordsRoot?: string;
  configTopology?: NixosSharedHostConfigTopology | "";
  installMode?: NixosSharedHostInstallMode | "";
};

export type DevMachinePromptInput = {
  profileName?: string;
  destination?: string;
  remoteRepoPath?: string;
  remoteStatePath?: string;
  remoteRuntimeRoot?: string;
  remoteRecordsRoot?: string;
  sshMode?: string;
};

function defaultRemoteRepoPath(repoRoot: string): string {
  return `/srv/${path.basename(repoRoot)}`;
}

async function maybePromptInput<T extends Record<string, unknown>>(
  input: T,
  rules: JsonPromptRuleSet,
  opts?: { interactive?: boolean; runner?: PromptRunner },
): Promise<T> {
  const promptInput = mergeFlatPromptObjects(input);
  if (opts?.runner) return (await opts.runner(promptInput, rules)) as T;
  return (await completeJsonPromptObject(
    promptInput,
    promptOptionsFromRuleSet(promptInput, rules),
    {
      interactive: opts?.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
    },
  )) as T;
}

function hostPromptRules(): JsonPromptRuleSet {
  return {
    order: [
      "configRoot",
      "installMode",
      "configEntryPath",
      "configTopology",
      "hostRoot",
      "managedRoot",
      "statePath",
      "runtimeRoot",
      "recordsRoot",
    ],
    labels: {
      configRoot: "Config root",
      installMode: "Install mode (managed-dropin or emit-only)",
      configEntryPath: "Config entry path",
      configTopology: "Config topology (plain or flake)",
      hostRoot: "Host root",
      managedRoot: "Managed root",
      statePath: "State path",
      runtimeRoot: "Runtime root",
      recordsRoot: "Records root",
    },
    required: ["configRoot", "installMode"],
    defaults: {
      configRoot: "/etc/nixos",
      installMode: "managed-dropin",
    },
    requiredWhen: [
      {
        if: { installMode: "managed-dropin" },
        require: ["configEntryPath"],
      },
    ],
    defaultTemplates: {
      configEntryPath: "${configRoot}/configuration.nix",
    },
  };
}

function devMachinePromptRules(repoRoot: string): JsonPromptRuleSet {
  return {
    order: [
      "profileName",
      "destination",
      "remoteRepoPath",
      "remoteStatePath",
      "remoteRuntimeRoot",
      "remoteRecordsRoot",
      "sshMode",
    ],
    labels: {
      profileName: "Profile name",
      destination: "Destination",
      remoteRepoPath: "Remote repo path",
      remoteStatePath: "Remote state path",
      remoteRuntimeRoot: "Remote runtime root",
      remoteRecordsRoot: "Remote records root",
      sshMode: "SSH mode",
    },
    required: [
      "profileName",
      "destination",
      "remoteRepoPath",
      "remoteStatePath",
      "remoteRuntimeRoot",
      "remoteRecordsRoot",
      "sshMode",
    ],
    defaults: {
      profileName: "default",
      remoteRepoPath: defaultRemoteRepoPath(repoRoot),
      remoteStatePath: defaultStatePath(),
      remoteRuntimeRoot: defaultRuntimeRoot(),
      remoteRecordsRoot: defaultRecordsRoot(),
      sshMode: "ssh",
    },
    defaultTemplates: {
      destination: "${profileName}",
    },
  };
}

export async function maybePromptHostInstallInput(
  input: HostInstallPromptInput,
  opts?: { interactive?: boolean; runner?: PromptRunner },
): Promise<HostInstallPromptInput> {
  return await maybePromptInput(input, hostPromptRules(), opts);
}

export async function maybePromptDevMachineInstallInput(
  repoRoot: string,
  input: DevMachinePromptInput,
  opts?: { interactive?: boolean; runner?: PromptRunner },
): Promise<DevMachinePromptInput> {
  return await maybePromptInput(input, devMachinePromptRules(repoRoot), opts);
}
