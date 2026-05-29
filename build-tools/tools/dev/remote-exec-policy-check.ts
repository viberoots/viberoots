#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import { getArgvTokens } from "../lib/cli";
import type { NixBuilderPolicy } from "../lib/nix-builder-policy";

export type RemoteExecMode = "local" | "hybrid" | "remote" | "remote-only-conformance";

export type RemoteExecTargetMetadata = {
  target: string;
  ruleFamily?: string;
  labels?: string[];
  runFromProjectRoot?: boolean;
  useProjectRelativePaths?: boolean;
  localResources?: string[];
  requiredLocalResources?: string[];
  networkAccess?: boolean;
  commandInputsDeclared?: boolean;
  requiresWorkspaceRootLookup?: boolean;
  sourceSnapshotRootDeclared?: boolean;
  sourceSnapshotManifestDeclared?: boolean;
  declaredGraphPath?: boolean;
  ambientPathDependency?: boolean;
  nixBuilderPolicy?: unknown;
  remoteBuilderSmokePolicy?: unknown;
};

export type RemoteExecPolicyFinding = {
  target: string;
  message: string;
};

const REMOTE_LOCAL_ONLY = "remote:local-only";
const REMOTE_READY = "remote:ready";
const EXTERNAL_MUTATING_LOCKED = "remote:external-mutating-locked";
const DEPLOYMENT_DOMAIN = "domain:deployment";
const REMOTE_MODES = new Set(["hybrid", "remote", "remote-only-conformance"]);
const ALLOWED_REMOTE_READY_FAMILIES = new Set([
  "zx_test",
  "node_nix_test",
  "go_nix_test",
  "python_nix_test",
  "cpp_nix_test",
]);
const RESOURCE_PROFILE_LABELS = new Map([
  ["verify:resource-limited", ["linux-x86_64-large", "linux-aarch64-large"]],
]);

function labelsOf(target: RemoteExecTargetMetadata): string[] {
  return Array.isArray(target.labels) ? target.labels : [];
}

function isRemoteMode(mode: RemoteExecMode): boolean {
  return REMOTE_MODES.has(mode);
}

function finding(target: RemoteExecTargetMetadata, message: string): RemoteExecPolicyFinding {
  return { target: target.target || "<unknown>", message };
}

function isNixBuilderPolicy(value: unknown): value is NixBuilderPolicy {
  return value === "local_only" || value === "inherit_config" || value === "force_builders_file";
}

export function validateRemoteExecTargets(opts: {
  mode: RemoteExecMode;
  targets: RemoteExecTargetMetadata[];
  lockCapabilities?: string[];
  allowedProfiles?: string[];
}): RemoteExecPolicyFinding[] {
  const lockCaps = new Set(opts.lockCapabilities || []);
  const allowedProfiles = new Set(opts.allowedProfiles || []);
  const findings: RemoteExecPolicyFinding[] = [];
  for (const target of opts.targets) {
    const labels = labelsOf(target);
    if (isRemoteMode(opts.mode) && labels.includes(REMOTE_LOCAL_ONLY)) {
      findings.push(finding(target, `${REMOTE_LOCAL_ONLY} cannot be selected in remote mode`));
    }
    if (isRemoteMode(opts.mode) && !labels.includes(REMOTE_READY)) {
      findings.push(finding(target, "remote mode requires explicit remote:ready readiness"));
      continue;
    }
    if (labels.includes(DEPLOYMENT_DOMAIN) && !labels.includes(REMOTE_LOCAL_ONLY)) {
      findings.push(finding(target, "deployment-domain targets must remain remote:local-only"));
    }
    if (labels.includes(EXTERNAL_MUTATING_LOCKED) && !lockCaps.has("external-mutating")) {
      findings.push(finding(target, "external mutating target requires external-mutating lock"));
    }
    if (!labels.includes(REMOTE_READY)) continue;
    if (target.ruleFamily && !ALLOWED_REMOTE_READY_FAMILIES.has(target.ruleFamily)) {
      findings.push(finding(target, `remote:ready is not allowed on ${target.ruleFamily}`));
    }
    if (!target.runFromProjectRoot || !target.useProjectRelativePaths) {
      findings.push(finding(target, "remote:ready requires project-relative execution flags"));
    }
    for (const label of labels) {
      const profiles = RESOURCE_PROFILE_LABELS.get(label);
      if (!profiles) continue;
      if (profiles.every((profile) => !allowedProfiles.has(profile))) {
        findings.push(finding(target, `${label} has no compatible remote profile`));
      }
    }
    if (
      (target.localResources || []).length > 0 ||
      (target.requiredLocalResources || []).length > 0
    ) {
      findings.push(finding(target, "local resources block remote-only conformance"));
    }
    if (target.networkAccess) {
      findings.push(finding(target, "network access requires modeled remote egress policy"));
    }
    if (!target.commandInputsDeclared) {
      findings.push(finding(target, "remote-ready external-runner tests require command inputs"));
    }
    if (
      target.requiresWorkspaceRootLookup &&
      (!target.sourceSnapshotRootDeclared ||
        !target.sourceSnapshotManifestDeclared ||
        !target.declaredGraphPath)
    ) {
      findings.push(
        finding(
          target,
          "remote-ready WORKSPACE_ROOT lookups require declared source snapshot and graph paths",
        ),
      );
    }
    if (target.ambientPathDependency) {
      findings.push(
        finding(target, "ambient PATH dependency declarations block remote-ready execution"),
      );
    }
    if (!isNixBuilderPolicy(target.nixBuilderPolicy)) {
      findings.push(finding(target, "remote:ready requires typed Nix builder policy evidence"));
      continue;
    }
    if (target.nixBuilderPolicy === "local_only") {
      findings.push(finding(target, "remote:ready cannot disable Nix builders"));
    }
    if (
      (target.nixBuilderPolicy === "inherit_config" ||
        target.nixBuilderPolicy === "force_builders_file") &&
      target.remoteBuilderSmokePolicy === undefined
    ) {
      findings.push(
        finding(target, `${target.nixBuilderPolicy} requires matching remote-builder smoke`),
      );
    }
    if (
      (target.nixBuilderPolicy === "inherit_config" ||
        target.nixBuilderPolicy === "force_builders_file") &&
      target.remoteBuilderSmokePolicy !== undefined &&
      !isNixBuilderPolicy(target.remoteBuilderSmokePolicy)
    ) {
      findings.push(finding(target, "remote:ready requires typed remote-builder smoke evidence"));
    }
    if (
      (target.nixBuilderPolicy === "inherit_config" ||
        target.nixBuilderPolicy === "force_builders_file") &&
      isNixBuilderPolicy(target.remoteBuilderSmokePolicy) &&
      target.remoteBuilderSmokePolicy !== target.nixBuilderPolicy
    ) {
      findings.push(
        finding(target, `${target.nixBuilderPolicy} requires matching remote-builder smoke`),
      );
    }
  }
  return findings;
}

export function assertRemoteTargetsAllowed(opts: {
  mode: RemoteExecMode;
  targets: RemoteExecTargetMetadata[];
  lockCapabilities?: string[];
  allowedProfiles?: string[];
}): void {
  const findings = validateRemoteExecTargets({
    mode: opts.mode,
    targets: opts.targets,
    lockCapabilities: opts.lockCapabilities,
    allowedProfiles: opts.allowedProfiles,
  });
  if (findings.length > 0) {
    throw new Error(findings.map((f) => `${f.target}: ${f.message}`).join("\n"));
  }
}

function parseCli(): {
  mode: RemoteExecMode;
  metadataJson: string;
  profiles: string[];
  locks: string[];
} {
  const tokens = getArgvTokens();
  const value = (name: string) => {
    const prefixed = tokens.find((t) => t.startsWith(`${name}=`));
    if (prefixed) return prefixed.slice(name.length + 1);
    const i = tokens.indexOf(name);
    return i >= 0 ? String(tokens[i + 1] || "") : "";
  };
  const mode = (value("--mode") || "remote") as RemoteExecMode;
  return {
    mode,
    metadataJson: value("--metadata-json"),
    profiles: value("--profiles").split(",").filter(Boolean),
    locks: value("--locks").split(",").filter(Boolean),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseCli();
  if (!args.metadataJson) throw new Error("--metadata-json is required");
  const targets = JSON.parse(fs.readFileSync(args.metadataJson, "utf8"));
  const findings = validateRemoteExecTargets({
    mode: args.mode,
    targets,
    lockCapabilities: args.locks,
    allowedProfiles: args.profiles,
  });
  if (findings.length > 0) {
    for (const item of findings) process.stderr.write(`${item.target}: ${item.message}\n`);
    process.exit(2);
  }
}
