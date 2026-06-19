#!/usr/bin/env zx-wrapper
import { shSingleQuote } from "../lib/shell-quote";
import {
  buildReviewedRemoteRsyncShell,
  buildReviewedRemoteSshArgvPrefix,
} from "./nixos-shared-host-remote-ssh";
import { stagedUploadCompleteMarkerPath } from "./nixos-shared-host-staged-artifact";
import type { NixosSharedHostRemotePlan } from "./nixos-shared-host-remote-target";

export type NixosSharedHostRemoteSmokeConnectOverride = {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
  rejectUnauthorized?: boolean;
};

function commandArgs(args: Array<[string, string]>): string {
  return args.map(([flag, value]) => `--${flag} ${shSingleQuote(value)}`).join(" ");
}

function commandListArgs(flag: string, values: string[]): string {
  return values.map((value) => `--${flag} ${shSingleQuote(value)}`).join(" ");
}

function remoteBashCommand(script: string): string {
  return `bash -lc ${shSingleQuote(script)}`;
}

function remoteToolBinSetup(opts: {
  repoExpr: string;
  varName: string;
  relativePath: string;
  description: string;
}): string[] {
  return [
    `${opts.varName}=""`,
    `for candidate in ${opts.repoExpr}/${opts.relativePath} ${opts.repoExpr}/viberoots/${opts.relativePath} ${opts.repoExpr}/.viberoots/current/${opts.relativePath}; do if [ -e "$candidate" ]; then ${opts.varName}="$candidate"; break; fi; done`,
    `if [ -z "$${opts.varName}" ]; then echo "reviewed remote repo checkout is unusable (missing active viberoots ${opts.description}): $repo" >&2; exit 1; fi`,
  ];
}

function remoteDeployBinSetup(repoExpr: string): string[] {
  return remoteToolBinSetup({
    repoExpr,
    varName: "deploy_bin",
    relativePath: "build-tools/tools/bin/deploy",
    description: "deploy tool",
  });
}

function remoteHostApplyBinSetup(repoExpr: string): string[] {
  return remoteToolBinSetup({
    repoExpr,
    varName: "host_apply_bin",
    relativePath: "build-tools/tools/deployments/nixos-shared-host-host-apply.ts",
    description: "host apply tool",
  });
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
  const prefix = buildReviewedRemoteSshArgvPrefix(process.env, fallback);
  return [...prefix, destination, remoteBashCommand(script)];
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
    'if [ ! -f "$repo/.viberoots/workspace/flake.nix" ] && [ ! -f "$repo/flake.nix" ]; then echo "reviewed remote repo checkout is unusable (missing workspace flake): $repo" >&2; exit 1; fi',
    ...remoteDeployBinSetup('"$repo"'),
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
    `repo=${shSingleQuote(opts.plan.remoteRepoPath)}`,
    ...remoteDeployBinSetup('"$repo"'),
    `cd ${shSingleQuote(opts.plan.remoteRepoPath)}`,
    ...admissionEvidenceSetup,
    `exec direnv exec . "$deploy_bin" ${commandArgs(args)}${admissionEvidenceArg}`,
  ].join("; ");
}

export function buildRemoteHostApplyScriptWithOptions(
  plan: NixosSharedHostRemotePlan,
  opts: { restartServices?: string[] } = {},
): string {
  const args: Array<[string, string]> = [
    ["config-root", plan.hostApply.remoteConfigRoot],
    ["managed-root", plan.hostApply.remoteManagedRoot],
    ["expected-state-path", plan.remoteStatePath],
    ["expected-runtime-root", plan.remoteRuntimeRoot],
    ["expected-records-root", plan.remoteRecordsRoot],
  ];
  const flags = plan.hostApply.selectedMode === "dry-run" ? ["dry-run"] : [];
  const suffix = [
    commandArgs(args),
    flags.map((flag) => `--${flag}`).join(" "),
    commandListArgs("restart-service", opts.restartServices || []),
  ]
    .filter(Boolean)
    .join(" ");
  return [
    "set -euo pipefail",
    `repo=${shSingleQuote(plan.remoteRepoPath)}`,
    ...remoteHostApplyBinSetup('"$repo"'),
    `cd ${shSingleQuote(plan.remoteRepoPath)}`,
    `exec direnv exec . zx-wrapper "$host_apply_bin" ${suffix}`,
  ].join("; ");
}

export const buildRemoteHostApplyScript = buildRemoteHostApplyScriptWithOptions;

export function buildRemoteDeployAdminKeycloakSyncScript(opts: {
  plan: NixosSharedHostRemotePlan;
  deploymentLabel: string;
  realmFile: string;
  actingPrincipal: string;
  adminGroups: string[];
  automationPrincipalIds: string[];
}): string {
  const fixedArgs: Array<[string, string]> = [
    ["deployment", opts.deploymentLabel],
    ["realm-file", opts.realmFile],
    ["acting-principal", opts.actingPrincipal],
  ];
  const suffix = [
    commandArgs(fixedArgs),
    commandListArgs("admin-group", opts.adminGroups),
    commandListArgs("automation-principal", opts.automationPrincipalIds),
  ]
    .filter(Boolean)
    .join(" ");
  return [
    "set -euo pipefail",
    `repo=${shSingleQuote(opts.plan.remoteRepoPath)}`,
    ...remoteDeployBinSetup('"$repo"'),
    `cd ${shSingleQuote(opts.plan.remoteRepoPath)}`,
    `exec direnv exec . "$deploy_bin" admin identity sync ${suffix}`,
  ].join("; ");
}

export function buildRemoteDeployAdminKeycloakGrantUserScript(opts: {
  plan: NixosSharedHostRemotePlan;
  deploymentLabel: string;
  action: string;
  userEmail: string;
  membershipFile: string;
  realmFile: string;
  actingPrincipal: string;
  adminGroups: string[];
  automationPrincipalIds: string[];
}): string {
  const fixedArgs: Array<[string, string]> = [
    ["deployment", opts.deploymentLabel],
    ["action", opts.action],
    ["user-email", opts.userEmail],
    ["membership-file", opts.membershipFile],
    ["realm-file", opts.realmFile],
    ["acting-principal", opts.actingPrincipal],
  ];
  const suffix = [
    commandArgs(fixedArgs),
    commandListArgs("admin-group", opts.adminGroups),
    commandListArgs("automation-principal", opts.automationPrincipalIds),
  ]
    .filter(Boolean)
    .join(" ");
  return [
    "set -euo pipefail",
    `repo=${shSingleQuote(opts.plan.remoteRepoPath)}`,
    ...remoteDeployBinSetup('"$repo"'),
    `cd ${shSingleQuote(opts.plan.remoteRepoPath)}`,
    `exec direnv exec . "$deploy_bin" admin identity grant-user ${suffix}`,
  ].join("; ");
}
