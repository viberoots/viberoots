#!/usr/bin/env zx-wrapper
import path from "node:path";
import { buildSelectedOutPath } from "../dev/run-runnable-graph.ts";
import { getFlagBool, getFlagStr, hasFlag } from "../lib/cli.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import {
  defaultManagedRoot,
  normalizeHostLogicalPath,
} from "./nixos-shared-host-install-contract.ts";
import { runNixosSharedHostRemoteDeploy } from "./nixos-shared-host-remote-execution.ts";
import {
  createNixosSharedHostRemotePlan,
  type NixosSharedHostRemoteHostApplyMode,
  type NixosSharedHostRemotePlan,
} from "./nixos-shared-host-remote-target.ts";
import type { ClientInput } from "./nixos-shared-host-install-dev-machine.ts";

type RemoteOverrides = Partial<ClientInput>;

function requireNamedFlagValue(name: string): string {
  if (!hasFlag(name)) return "";
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} requires a non-empty value`);
  return value;
}

function collectRemoteOverrides(): RemoteOverrides {
  return {
    ...(hasFlag("destination") ? { destination: requireNamedFlagValue("destination") } : {}),
    ...(hasFlag("remote-repo-path")
      ? { remoteRepoPath: requireNamedFlagValue("remote-repo-path") }
      : {}),
    ...(hasFlag("remote-state-path")
      ? { remoteStatePath: requireNamedFlagValue("remote-state-path") }
      : {}),
    ...(hasFlag("remote-runtime-root")
      ? { remoteRuntimeRoot: requireNamedFlagValue("remote-runtime-root") }
      : {}),
    ...(hasFlag("remote-records-root")
      ? { remoteRecordsRoot: requireNamedFlagValue("remote-records-root") }
      : {}),
    ...(hasFlag("ssh-mode") ? { sshMode: requireNamedFlagValue("ssh-mode") } : {}),
  };
}

function collectProfileModeConflicts(): string[] {
  const conflicts = [
    "host-root",
    "state",
    "records-root",
    "host-config-out",
    "publish-only",
    "rollback",
    "source-run-id",
  ].filter((flag) => hasFlag(flag));
  if (hasFlag("remove")) conflicts.push("remove");
  return conflicts.map((flag) => `--${flag}`);
}

function collectSmokeConnectOverride() {
  const smokeConnectHost = getFlagStr("smoke-connect-host", "").trim();
  const smokeConnectPort = Number(getFlagStr("smoke-connect-port", "").trim() || 0);
  const smokeConnectProtocol = getFlagStr("smoke-connect-protocol", "https:").trim();
  if (!smokeConnectHost || smokeConnectPort <= 0) return undefined;
  return {
    protocol: smokeConnectProtocol === "http:" ? ("http:" as const) : ("https:" as const),
    hostname: smokeConnectHost,
    port: smokeConnectPort,
  };
}

function collectHostApplySelection(): {
  selectedMode: NixosSharedHostRemoteHostApplyMode;
  remoteConfigRoot: string;
  remoteManagedRoot: string;
  hasOverrides: boolean;
} {
  const selectedMode = getFlagBool("apply-host-dry-run")
    ? "dry-run"
    : getFlagBool("apply-host")
      ? "switch"
      : "skip";
  const hasOverrides = hasFlag("remote-config-root") || hasFlag("remote-managed-root");
  const remoteConfigRoot = hasFlag("remote-config-root")
    ? normalizeHostLogicalPath(requireNamedFlagValue("remote-config-root"))
    : "/etc/nixos";
  const remoteManagedRoot = hasFlag("remote-managed-root")
    ? normalizeHostLogicalPath(requireNamedFlagValue("remote-managed-root"))
    : defaultManagedRoot(remoteConfigRoot);
  return {
    selectedMode,
    remoteConfigRoot,
    remoteManagedRoot,
    hasOverrides,
  };
}

async function resolveLocalArtifactDir(
  workspaceRoot: string,
  deployment: NixosSharedHostDeployment,
): Promise<string> {
  const artifactDir = getFlagStr("artifact-dir", "").trim();
  if (artifactDir) return path.resolve(artifactDir);
  const outPath = await buildSelectedOutPath(workspaceRoot, deployment.component.target);
  return path.join(outPath, "dist");
}

function resolveProfileRoot(workspaceRoot: string): string {
  return hasFlag("profile-root")
    ? path.resolve(requireNamedFlagValue("profile-root"))
    : path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host", "clients");
}

async function createPlan(
  workspaceRoot: string,
  deployment: NixosSharedHostDeployment,
  profileName: string,
  overrides: RemoteOverrides,
  hostApply: ReturnType<typeof collectHostApplySelection>,
): Promise<NixosSharedHostRemotePlan> {
  return await createNixosSharedHostRemotePlan({
    deployment,
    profileName,
    profileRoot: resolveProfileRoot(workspaceRoot),
    overrides,
    artifactDir: hasFlag("artifact-dir") ? requireNamedFlagValue("artifact-dir") : undefined,
    hostApply,
  });
}

export async function maybeRunNixosSharedHostRemoteProfile(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  admissionEvidence?: DeploymentAdmissionEvidence;
}): Promise<boolean> {
  const profileRequested = hasFlag("profile") || hasFlag("profile-root");
  const profileName = hasFlag("profile") ? requireNamedFlagValue("profile") : "";
  const planMode = getFlagBool("plan") || getFlagBool("dry-run");
  const overrides = collectRemoteOverrides();
  const retainRemoteArtifact = getFlagBool("retain-remote-artifact");
  const smokeConnectOverride = collectSmokeConnectOverride();
  const hostApply = collectHostApplySelection();
  if (!profileName) {
    if (
      profileRequested ||
      Object.keys(overrides).length > 0 ||
      retainRemoteArtifact ||
      hostApply.selectedMode !== "skip" ||
      hostApply.hasOverrides
    ) {
      throw new Error("remote target selection requires --profile <name>");
    }
    if (planMode) throw new Error("--plan/--dry-run requires --profile <name>");
    return false;
  }
  if (hostApply.selectedMode === "skip" && hostApply.hasOverrides) {
    throw new Error("--remote-config-root/--remote-managed-root require --apply-host");
  }
  const conflicts = collectProfileModeConflicts();
  if (conflicts.length > 0) {
    throw new Error(
      `--profile cannot be combined with local execution flags: ${conflicts.join(", ")}`,
    );
  }
  const plan = await createPlan(
    opts.workspaceRoot,
    opts.deployment,
    profileName,
    overrides,
    hostApply,
  );
  if (planMode) {
    console.log(JSON.stringify(plan, null, 2));
    return true;
  }
  if (hasFlag("deployment-json")) {
    throw new Error(
      "remote profile execution requires --deployment <label>; --deployment-json is plan-only for this reviewed path",
    );
  }
  console.log(
    JSON.stringify(
      await runNixosSharedHostRemoteDeploy({
        deployment: opts.deployment,
        plan,
        localArtifactDir: await resolveLocalArtifactDir(opts.workspaceRoot, opts.deployment),
        retainRemoteArtifact,
        ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
        ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
        hostApply: plan.hostApply,
      }),
      null,
      2,
    ),
  );
  return true;
}
