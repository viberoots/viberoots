#!/usr/bin/env zx-wrapper
import { shSingleQuote } from "../lib/shell-quote.ts";
import {
  buildReviewedRemoteRsyncShell,
  buildReviewedRemoteSshArgvPrefix,
} from "./nixos-shared-host-remote-ssh.ts";
import { stagedUploadCompleteMarkerPath } from "./nixos-shared-host-staged-artifact.ts";
import type { NixosSharedHostRemotePlan } from "./nixos-shared-host-remote-target.ts";

export type NixosSharedHostRemoteSmokeConnectOverride = {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
  rejectUnauthorized?: boolean;
};

function commandArgs(args: Array<[string, string]>): string {
  return args.map(([flag, value]) => `--${flag} ${shSingleQuote(value)}`).join(" ");
}

function commandFlags(flags: string[]): string {
  return flags.map((flag) => `--${flag}`).join(" ");
}

function remoteBashCommand(script: string): string {
  return `bash -lc ${shSingleQuote(script)}`;
}

export function buildRemoteSshArgv(destination: string, script: string): string[] {
  return [...buildReviewedRemoteSshArgvPrefix(process.env), destination, remoteBashCommand(script)];
}

export function buildRemoteArtifactStageArgv(
  localArtifactDir: string,
  destination: string,
  remoteArtifactPath: string,
): string[] {
  const source = localArtifactDir.endsWith("/") ? localArtifactDir : `${localArtifactDir}/`;
  const remoteTarget = `${destination}:${remoteArtifactPath.endsWith("/") ? remoteArtifactPath : `${remoteArtifactPath}/`}`;
  const rsyncShell = buildReviewedRemoteRsyncShell(process.env);
  return [
    "rsync",
    "-az",
    "--delete",
    ...(rsyncShell ? ["-e", rsyncShell] : []),
    source,
    remoteTarget,
  ];
}

export function buildRemoteSshArgvWithFallback(
  destination: string,
  script: string,
  fallback?: { identityFile?: string; knownHostsFile?: string },
): string[] {
  return [
    ...buildReviewedRemoteSshArgvPrefix(process.env, fallback),
    destination,
    remoteBashCommand(script),
  ];
}

export function buildRemoteArtifactStageArgvWithFallback(
  localArtifactDir: string,
  destination: string,
  remoteArtifactPath: string,
  fallback?: { identityFile?: string; knownHostsFile?: string },
): string[] {
  const source = localArtifactDir.endsWith("/") ? localArtifactDir : `${localArtifactDir}/`;
  const remoteTarget = `${destination}:${remoteArtifactPath.endsWith("/") ? remoteArtifactPath : `${remoteArtifactPath}/`}`;
  const rsyncShell = buildReviewedRemoteRsyncShell(process.env, fallback);
  return [
    "rsync",
    "-az",
    "--delete",
    ...(rsyncShell ? ["-e", rsyncShell] : []),
    source,
    remoteTarget,
  ];
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
  return [
    "set -euo pipefail",
    `final=${shSingleQuote(remoteArtifactPath)}`,
    'tmp="${final}.uploading"',
    'if [ -e "$final" ]; then echo "finalized staged artifact already exists: $final" >&2; exit 1; fi',
    'rm -rf -- "$tmp"',
    'mkdir -p -- "$tmp"',
  ].join("; ");
}

export function buildRemoteStageFinalizeScript(remoteArtifactPath: string): string {
  const marker = stagedUploadCompleteMarkerPath(remoteArtifactPath);
  return [
    "set -euo pipefail",
    `final=${shSingleQuote(remoteArtifactPath)}`,
    'tmp="${final}.uploading"',
    `marker=${shSingleQuote(marker)}`,
    'test -d "$tmp"',
    'mv -- "$tmp" "$final"',
    'chmod -R a-w "$final"',
    'printf \'{"schemaVersion":"nixos-shared-host-staged-upload@1"}\\n\' > "$marker"',
  ].join("; ");
}

export function buildRemoteCleanupScript(remoteArtifactPath: string): string {
  return [
    "set -euo pipefail",
    `for path in ${shSingleQuote(remoteArtifactPath)} ${shSingleQuote(`${remoteArtifactPath}.uploading`)}; do if [ -e "$path" ]; then chmod -R u+w "$path"; fi; done`,
    `rm -rf -- ${shSingleQuote(remoteArtifactPath)} ${shSingleQuote(`${remoteArtifactPath}.uploading`)} ${shSingleQuote(stagedUploadCompleteMarkerPath(remoteArtifactPath))}`,
  ].join("; ");
}

export function buildRemoteDeployScript(opts: {
  plan: NixosSharedHostRemotePlan;
  deploymentLabel: string;
  remoteArtifactPath: string;
  admissionEvidenceJson?: string;
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
  const admissionEvidenceSetup = opts.admissionEvidenceJson
    ? [
        'admission_evidence_json="$(mktemp)"',
        `printf '%s\\n' ${shSingleQuote(opts.admissionEvidenceJson)} > "$admission_evidence_json"`,
        "trap 'rm -f \"$admission_evidence_json\"' EXIT",
      ]
    : [];
  const admissionEvidenceArg = opts.admissionEvidenceJson
    ? ' --admission-evidence-json "$admission_evidence_json"'
    : "";
  return [
    "set -euo pipefail",
    `cd ${shSingleQuote(opts.plan.remoteRepoPath)}`,
    ...admissionEvidenceSetup,
    `exec direnv exec . build-tools/tools/bin/deploy ${commandArgs(args)}${admissionEvidenceArg}`,
  ].join("; ");
}

export function buildRemoteHostApplyScript(plan: NixosSharedHostRemotePlan): string {
  const args: Array<[string, string]> = [
    ["config-root", plan.hostApply.remoteConfigRoot],
    ["managed-root", plan.hostApply.remoteManagedRoot],
    ["expected-state-path", plan.remoteStatePath],
    ["expected-runtime-root", plan.remoteRuntimeRoot],
    ["expected-records-root", plan.remoteRecordsRoot],
  ];
  const flags = plan.hostApply.selectedMode === "dry-run" ? ["dry-run"] : [];
  const suffix = [commandArgs(args), commandFlags(flags)].filter(Boolean).join(" ");
  return [
    "set -euo pipefail",
    `cd ${shSingleQuote(plan.remoteRepoPath)}`,
    `exec direnv exec . zx-wrapper build-tools/tools/deployments/nixos-shared-host-host-apply.ts ${suffix}`,
  ].join("; ");
}
