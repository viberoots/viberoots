#!/usr/bin/env zx-wrapper
import type { NixosSharedHostRemotePlan } from "./nixos-shared-host-remote-target";

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
      serviceSubmission: {
        mode: "control-plane-service",
        ...(plan
          ? {
              controlPlaneUrl: plan.serviceClient.controlPlaneUrl,
              ...(plan.serviceClient.controlPlaneTokenEnv
                ? { controlPlaneTokenEnv: plan.serviceClient.controlPlaneTokenEnv }
                : {}),
            }
          : {}),
      },
      hostApply: {
        supported: false,
        requestedMode: ctx.requestedHostApplyMode,
      },
      commands: {
        plan:
          `nixos-shared-host-jenkins-deploy --deployment ${ctx.deploymentLabel} ` +
          `--profile ${ctx.profileName} --artifact-dir <artifact-dir> --plan`,
        deploy:
          `nixos-shared-host-jenkins-deploy --deployment ${ctx.deploymentLabel} ` +
          `--profile ${ctx.profileName} --artifact-dir <artifact-dir> ` +
          "--admission-evidence-json <ci-evidence.json> --idempotency-key <stable-ci-key>",
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
