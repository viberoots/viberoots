#!/usr/bin/env zx-wrapper
import type { NixosSharedHostRemotePlan } from "./nixos-shared-host-remote-target.ts";

export const JENKINS_DEPLOY_SCHEMA_VERSION = "nixos-shared-host-jenkins-deploy@1";

export type HostApplyMode = "skip" | "switch" | "dry-run";

export class JenkinsDeployError extends Error {
  readonly code: string;
  readonly stderr?: string;

  constructor(code: string, message: string, stderr?: string) {
    super(message);
    this.code = code;
    this.stderr = stderr;
  }
}

export type JenkinsContext = {
  deploymentLabel: string;
  profileName: string;
  artifactDir: string;
  planOnly: boolean;
  requestedHostApplyMode: HostApplyMode;
  sshIdentityFile: string;
  sshKnownHostsFile: string;
  repoRoot: string;
};

export function createJenkinsEnvelope(ctx: JenkinsContext, plan?: NixosSharedHostRemotePlan) {
  return {
    schemaVersion: JENKINS_DEPLOY_SCHEMA_VERSION,
    deploymentLabel: ctx.deploymentLabel,
    profileName: ctx.profileName,
    artifactDir: ctx.artifactDir,
    planOnly: ctx.planOnly,
    jenkinsContract: {
      artifactInputRequired: true,
      transport: {
        mode: "ssh",
        nonInteractive: true,
        batchMode: true,
        strictHostKeyChecking: true,
        identityFile: ctx.sshIdentityFile,
        knownHostsFile: ctx.sshKnownHostsFile,
      },
      hostApply: {
        explicitOptInRequired: true,
        requestedMode: ctx.requestedHostApplyMode,
      },
      ...(plan
        ? {
            remoteRepoCheckout: {
              remoteRepoPath: plan.remoteRepoPath,
              requiredFiles: ["flake.nix", "build-tools/tools/bin/deploy"],
            },
          }
        : {}),
    },
  };
}
