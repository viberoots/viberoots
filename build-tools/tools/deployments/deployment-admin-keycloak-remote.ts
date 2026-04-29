#!/usr/bin/env zx-wrapper
import { getFlagBool, getFlagStr, hasFlag } from "../lib/cli.ts";
import type { DeploymentAuthAction } from "./deployment-auth-groups.ts";
import { deploymentAdminKeycloakArtifactPaths } from "./deployment-admin-keycloak-artifacts.ts";
import { resolveRemoteKeycloakAdminInputs } from "./deployment-admin-keycloak-remote-auth.ts";
import { commandFailure, runCommand } from "./nixos-shared-host-remote-execution-transport.ts";
import {
  buildRemoteDeployAdminKeycloakGrantUserScript,
  buildRemoteDeployAdminKeycloakSyncScript,
  buildRemoteHostApplyScriptWithOptions,
  buildRemoteRepoPreflightScript,
  buildRemoteSshArgvWithFallback,
} from "./nixos-shared-host-remote-shell.ts";
import { createNixosSharedHostRemotePlan } from "./nixos-shared-host-remote-target.ts";
import type { DeploymentTarget, NixosSharedHostDeployment } from "./contract.ts";

const REMOTE_PROFILE_FLAGS = [
  "profile",
  "profile-root",
  "destination",
  "remote-repo-path",
  "remote-state-path",
  "remote-runtime-root",
  "remote-records-root",
  "ssh-mode",
  "apply-host",
  "apply-host-dry-run",
  "remote-config-root",
  "remote-managed-root",
];

function requireNamedFlagValue(name: string): string {
  if (!hasFlag(name)) return "";
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} requires a non-empty value`);
  return value;
}

function parseJson<T>(stdout: string, context: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`${context} returned invalid JSON: ${stdout.trim()}`);
  }
}

function remoteOverrides() {
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

function hostApplySelection() {
  if (getFlagBool("apply-host") && getFlagBool("apply-host-dry-run")) {
    throw new Error("--apply-host and --apply-host-dry-run cannot be combined");
  }
  return {
    selectedMode: getFlagBool("apply-host-dry-run")
      ? ("dry-run" as const)
      : getFlagBool("apply-host")
        ? ("switch" as const)
        : ("skip" as const),
    ...(hasFlag("remote-config-root")
      ? { remoteConfigRoot: requireNamedFlagValue("remote-config-root") }
      : {}),
    ...(hasFlag("remote-managed-root")
      ? { remoteManagedRoot: requireNamedFlagValue("remote-managed-root") }
      : {}),
  };
}

function reviewedRemoteFlagsRequested(): boolean {
  return REMOTE_PROFILE_FLAGS.some((flag) => hasFlag(flag));
}

function requireRemoteProfileName(): string {
  const profileName = getFlagStr("profile", "").trim();
  if (!profileName) throw new Error("reviewed remote identity admin execution requires --profile");
  return profileName;
}

function assertRemoteProfileDeployment(deployment: DeploymentTarget): NixosSharedHostDeployment {
  if (deployment.provider !== "nixos-shared-host") {
    throw new Error(
      `--profile is supported only for reviewed nixos-shared-host deployments, not ${deployment.provider}`,
    );
  }
  return deployment;
}

function assertNoLocalArtifactOverride(flagName: "realm-file" | "membership-file") {
  if (hasFlag(flagName)) {
    throw new Error(`--${flagName} cannot be combined with reviewed remote profile execution`);
  }
}

export function hasDeploymentAdminKeycloakRemoteProfileFlags(): boolean {
  return reviewedRemoteFlagsRequested();
}

export async function runDeploymentAdminKeycloakRemoteProfile(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  command: "sync" | "grant-user";
  action?: DeploymentAuthAction;
  automationPrincipalIds: string[];
}) {
  const deployment = assertRemoteProfileDeployment(opts.deployment);
  const profileName = requireRemoteProfileName();
  assertNoLocalArtifactOverride(opts.command === "sync" ? "realm-file" : "membership-file");
  const plan = await createNixosSharedHostRemotePlan({
    deployment,
    profileName,
    profileRoot: hasFlag("profile-root")
      ? requireNamedFlagValue("profile-root")
      : `${opts.workspaceRoot}/.local/deployments/nixos-shared-host/clients`,
    overrides: remoteOverrides(),
    hostApply: hostApplySelection(),
  });
  const resolvedInputs = await resolveRemoteKeycloakAdminInputs({
    deployment,
    plan,
    command: opts.command,
    ...(opts.action ? { action: opts.action } : {}),
  });
  const artifacts = deploymentAdminKeycloakArtifactPaths({
    configRoot: plan.hostApply.remoteConfigRoot,
    managedRoot: plan.hostApply.remoteManagedRoot,
  });
  console.error(`Remote identity admin: checking reviewed repo on ${plan.destination}...`);
  const preflight = await runCommand(
    buildRemoteSshArgvWithFallback(
      plan.destination,
      buildRemoteRepoPreflightScript(plan),
      plan.reviewedRemoteSshAuth,
    ),
  );
  if (preflight.exitCode !== 0) {
    throw commandFailure(
      `remote repo preflight over SSH failed for "${plan.destination}" while checking ${plan.remoteRepoPath}`,
      preflight,
    );
  }
  console.error(`Remote identity admin: running ${opts.command} on ${plan.destination}...`);
  const mutationScript =
    opts.command === "sync"
      ? buildRemoteDeployAdminKeycloakSyncScript({
          plan,
          deploymentLabel: deployment.label,
          realmFile: artifacts.realmFile,
          actingPrincipal: resolvedInputs.actingPrincipal,
          adminGroups: resolvedInputs.adminGroups,
          automationPrincipalIds: opts.automationPrincipalIds,
        })
      : buildRemoteDeployAdminKeycloakGrantUserScript({
          plan,
          deploymentLabel: deployment.label,
          action: String(opts.action || ""),
          userEmail: String(resolvedInputs.userEmail || ""),
          membershipFile: artifacts.membershipFile,
          actingPrincipal: resolvedInputs.actingPrincipal,
          adminGroups: resolvedInputs.adminGroups,
        });
  const mutationResult = await runCommand(
    buildRemoteSshArgvWithFallback(plan.destination, mutationScript, plan.reviewedRemoteSshAuth),
  );
  if (mutationResult.exitCode !== 0) {
    throw commandFailure(`remote reviewed identity admin ${opts.command} failed`, mutationResult);
  }
  const mutation = parseJson<any>(
    mutationResult.stdout,
    `remote reviewed identity admin ${opts.command}`,
  );
  const hostApply =
    plan.hostApply.selectedMode === "skip"
      ? undefined
      : (() => {
          console.error(
            `Remote identity admin: applying host configuration on ${plan.destination} (${plan.hostApply.selectedMode})...`,
          );
          const argv = buildRemoteSshArgvWithFallback(
            plan.destination,
            buildRemoteHostApplyScriptWithOptions(plan, { restartServices: ["keycloak"] }),
            plan.reviewedRemoteSshAuth,
          );
          return runCommand(argv).then((result) => {
            if (result.exitCode !== 0) throw commandFailure("remote host apply failed", result);
            return parseJson<any>(result.stdout, "remote host apply");
          });
        })();
  return {
    schemaVersion:
      opts.command === "sync"
        ? "deploy-admin-identity-sync-remote@1"
        : "deploy-admin-identity-grant-user-remote@1",
    executionMode: "remote-profile",
    profileName: plan.profileName,
    destination: plan.destination,
    remoteRepoPath: plan.remoteRepoPath,
    remoteArtifacts: artifacts,
    hostApply: {
      requestedMode: plan.hostApply.selectedMode,
      ...(hostApply ? { result: await hostApply } : {}),
    },
    mutation: {
      ...mutation,
      audit: {
        ...(mutation.audit || {}),
        inputResolution: {
          actingPrincipal: {
            principalId: resolvedInputs.actingPrincipal,
            source: resolvedInputs.actingPrincipalSource,
          },
          adminGroups: {
            values: resolvedInputs.adminGroups,
            source: resolvedInputs.adminGroupsSource,
          },
          ...(resolvedInputs.userEmail
            ? {
                targetUser: {
                  userEmail: resolvedInputs.userEmail,
                  source: resolvedInputs.userEmailSource,
                },
              }
            : {}),
        },
        requestedMutation: {
          ...((mutation.audit && mutation.audit.requestedMutation) || {}),
          remoteProfile: plan.profileName,
          remoteDestination: plan.destination,
          requestedHostApplyMode: plan.hostApply.selectedMode,
        },
      },
    },
  };
}
