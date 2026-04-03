#!/usr/bin/env zx-wrapper
import { shSingleQuote } from "../lib/shell-quote.ts";
import type { NixosSharedHostRemotePlan } from "./nixos-shared-host-remote-target.ts";

export type NixosSharedHostRemoteSmokeConnectOverride = {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
};

function commandArgs(args: Array<[string, string]>): string {
  return args.map(([flag, value]) => `--${flag} ${shSingleQuote(value)}`).join(" ");
}

export function buildRemoteSshArgv(destination: string, script: string): string[] {
  return ["ssh", destination, "bash", "-lc", script];
}

export function buildRemoteArtifactStageArgv(
  localArtifactDir: string,
  destination: string,
  remoteArtifactPath: string,
): string[] {
  const source = localArtifactDir.endsWith("/") ? localArtifactDir : `${localArtifactDir}/`;
  const remoteTarget = `${destination}:${remoteArtifactPath.endsWith("/") ? remoteArtifactPath : `${remoteArtifactPath}/`}`;
  return ["rsync", "-az", "--delete", source, remoteTarget];
}

export function buildRemoteRepoPreflightScript(plan: NixosSharedHostRemotePlan): string {
  const repo = shSingleQuote(plan.remoteRepoPath);
  return [
    "set -euo pipefail",
    `repo=${repo}`,
    'if [ ! -d "$repo" ]; then echo "missing reviewed remote repo checkout: $repo" >&2; exit 1; fi',
    'if [ ! -f "$repo/flake.nix" ]; then echo "reviewed remote repo checkout is unusable (missing flake.nix): $repo" >&2; exit 1; fi',
    'if [ ! -x "$repo/build-tools/tools/bin/deploy" ]; then echo "reviewed remote repo checkout is unusable (missing build-tools/tools/bin/deploy): $repo" >&2; exit 1; fi',
  ].join("; ");
}

export function buildRemoteStagePrepareScript(remoteArtifactPath: string): string {
  return ["set -euo pipefail", `mkdir -p -- ${shSingleQuote(remoteArtifactPath)}`].join("; ");
}

export function buildRemoteCleanupScript(remoteArtifactPath: string): string {
  return ["set -euo pipefail", `rm -rf -- ${shSingleQuote(remoteArtifactPath)}`].join("; ");
}

export function buildRemoteDeployScript(opts: {
  plan: NixosSharedHostRemotePlan;
  deploymentLabel: string;
  remoteArtifactPath: string;
  smokeConnectOverride?: NixosSharedHostRemoteSmokeConnectOverride;
}): string {
  const args: Array<[string, string]> = [
    ["deployment", opts.deploymentLabel],
    ["artifact-dir", opts.remoteArtifactPath],
    ["host-root", opts.plan.remoteRuntimeRoot],
    ["state", opts.plan.remoteStatePath],
    ["records-root", opts.plan.remoteRecordsRoot],
  ];
  if (opts.smokeConnectOverride) {
    args.push(
      ["smoke-connect-host", opts.smokeConnectOverride.hostname],
      ["smoke-connect-port", String(opts.smokeConnectOverride.port)],
      ["smoke-connect-protocol", opts.smokeConnectOverride.protocol],
    );
  }
  return [
    "set -euo pipefail",
    `cd ${shSingleQuote(opts.plan.remoteRepoPath)}`,
    `exec direnv exec . build-tools/tools/bin/deploy ${commandArgs(args)}`,
  ].join("; ");
}
