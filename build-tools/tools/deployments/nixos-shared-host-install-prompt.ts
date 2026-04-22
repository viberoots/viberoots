#!/usr/bin/env zx-wrapper
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

export type ServerInstallPromptInput = {
  serverRoot?: string;
  configRoot?: string;
  configEntryPath?: string;
  managedRoot?: string;
  statePath?: string;
  runtimeRoot?: string;
  recordsRoot?: string;
  configTopology?: NixosSharedHostConfigTopology | "";
  installMode?: NixosSharedHostInstallMode | "";
};

export type ClientPromptInput = {
  profileName?: string;
  destination?: string;
  remoteRepoPath?: string;
  remoteStatePath?: string;
  remoteRuntimeRoot?: string;
  remoteRecordsRoot?: string;
  sshMode?: string;
  controlPlaneUrl?: string;
  controlPlaneTokenEnv?: string;
};

function defaultRemoteRepoPath(_repoRoot: string): string {
  return "/srv/common";
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

function serverPromptRules(): JsonPromptRuleSet {
  return {
    order: [
      "configRoot",
      "installMode",
      "configEntryPath",
      "configTopology",
      "serverRoot",
      "managedRoot",
      "statePath",
      "runtimeRoot",
      "recordsRoot",
    ],
    labels: {
      configRoot: "Config root",
      installMode: "Install mode (managed-manual-wire, managed-dropin, or emit-only)",
      configEntryPath: "Config entry path",
      configTopology: "Config topology (plain or flake)",
      serverRoot: "Server root",
      managedRoot: "Managed root",
      statePath: "State path",
      runtimeRoot: "Runtime root",
      recordsRoot: "Records root",
    },
    required: ["configRoot", "installMode"],
    defaults: {
      serverRoot: "/",
      configRoot: "/etc/nixos",
      installMode: "managed-manual-wire",
    },
    requiredWhen: [],
    defaultTemplates: {},
  };
}

function clientPromptRules(repoRoot: string): JsonPromptRuleSet {
  return {
    order: [
      "profileName",
      "destination",
      "remoteRepoPath",
      "remoteStatePath",
      "remoteRuntimeRoot",
      "remoteRecordsRoot",
      "sshMode",
      "controlPlaneUrl",
      "controlPlaneTokenEnv",
    ],
    labels: {
      profileName: "Profile name",
      destination: "Destination",
      remoteRepoPath: "Remote repo path",
      remoteStatePath: "Remote state path",
      remoteRuntimeRoot: "Remote runtime root",
      remoteRecordsRoot: "Remote records root",
      sshMode: "SSH mode",
      controlPlaneUrl: "Control-plane URL",
      controlPlaneTokenEnv: "Control-plane token env",
    },
    required: [
      "profileName",
      "remoteRepoPath",
      "remoteStatePath",
      "remoteRuntimeRoot",
      "remoteRecordsRoot",
      "sshMode",
      "controlPlaneUrl",
    ],
    defaults: {
      profileName: "default",
      remoteRepoPath: defaultRemoteRepoPath(repoRoot),
      remoteStatePath: defaultStatePath(),
      remoteRuntimeRoot: defaultRuntimeRoot(),
      remoteRecordsRoot: defaultRecordsRoot(),
      sshMode: "ssh",
      controlPlaneUrl: "http://127.0.0.1:7780",
      controlPlaneTokenEnv: "BNX_DEPLOY_CONTROL_PLANE_TOKEN",
    },
    defaultTemplates: {
      destination: "${profileName}",
    },
  };
}

export async function maybePromptServerInstallInput(
  input: ServerInstallPromptInput,
  opts?: { interactive?: boolean; runner?: PromptRunner },
): Promise<ServerInstallPromptInput> {
  return await maybePromptInput(input, serverPromptRules(), opts);
}

export async function maybePromptClientInstallInput(
  repoRoot: string,
  input: ClientPromptInput,
  opts?: { interactive?: boolean; runner?: PromptRunner },
): Promise<ClientPromptInput> {
  return await maybePromptInput(input, clientPromptRules(repoRoot), opts);
}
