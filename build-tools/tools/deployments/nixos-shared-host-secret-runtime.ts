#!/usr/bin/env zx-wrapper
import type { DeploymentRequirementStep } from "./deployment-requirements";
import type { DeploymentReleaseAction } from "./deployment-release-actions";
import type { NixosSharedHostConfig } from "./nixos-shared-host";
import {
  assertNixosSharedHostReleaseActionPhaseReplayAllowed,
  hasRunnableNixosSharedHostReleaseActionPhase,
  type NixosSharedHostReleaseActionExecutionPath,
} from "./nixos-shared-host-release-actions";
import { withFailedStep } from "./nixos-shared-host-deploy-failure";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy";
import { smokeNixosSharedHostPublishedComponents } from "./nixos-shared-host-publish-components";
import { materializeNixosSharedHostRuntime } from "./nixos-shared-host-runtime";

type SecretRuntime = {
  enterStep(step: DeploymentRequirementStep): Promise<Record<string, string>>;
};

const RELEASE_PHASE_STEP = {
  pre_publish: "release_actions.pre_publish",
  post_publish_pre_smoke: "release_actions.post_publish_pre_smoke",
  post_smoke: "release_actions.post_smoke",
} as const;

export async function materializeNixosSharedHostRuntimeWithSecrets(
  secretRuntime: SecretRuntime,
  hostRoot: string,
  rendered: NixosSharedHostConfig,
) {
  await secretRuntime.enterStep("provision");
  await materializeNixosSharedHostRuntime(hostRoot, rendered).catch((error) => {
    throw withFailedStep("provision", error);
  });
}

export async function runNixosSharedHostReleasePhaseWithSecrets(
  secretRuntime: SecretRuntime,
  runReleasePhase: (
    phase: keyof typeof RELEASE_PHASE_STEP,
    extra?: { artifactIdentity?: string; publicUrl?: string },
    executionPath?: NixosSharedHostReleaseActionExecutionPath,
  ) => Promise<void>,
  operationKind: "deploy" | "promotion" | "retry" | "rollback",
  releaseActions: DeploymentReleaseAction[],
  phase: keyof typeof RELEASE_PHASE_STEP,
  extra?: { artifactIdentity?: string; publicUrl?: string },
  executionPath: NixosSharedHostReleaseActionExecutionPath = "success",
) {
  assertNixosSharedHostReleaseActionPhaseReplayAllowed({
    operationKind,
    phase,
    releaseActions,
    executionPath,
  });
  if (
    !hasRunnableNixosSharedHostReleaseActionPhase({
      operationKind,
      phase,
      releaseActions,
      executionPath,
    })
  ) {
    return;
  }
  await secretRuntime.enterStep(RELEASE_PHASE_STEP[phase]);
  await runReleasePhase(phase, extra, executionPath);
}

export async function rethrowAfterNixosSharedHostReleasePhaseFailureWithSecrets(
  secretRuntime: SecretRuntime,
  runReleasePhase: (
    phase: keyof typeof RELEASE_PHASE_STEP,
    extra?: { artifactIdentity?: string; publicUrl?: string },
    executionPath?: NixosSharedHostReleaseActionExecutionPath,
  ) => Promise<void>,
  operationKind: "deploy" | "promotion" | "retry" | "rollback",
  releaseActions: DeploymentReleaseAction[],
  phase: keyof typeof RELEASE_PHASE_STEP,
  error: unknown,
  extra?: { artifactIdentity?: string; publicUrl?: string },
) {
  await runNixosSharedHostReleasePhaseWithSecrets(
    secretRuntime,
    runReleasePhase,
    operationKind,
    releaseActions,
    phase,
    extra,
    "failure",
  );
  throw error;
}

export async function smokeNixosSharedHostPublishedComponentsWithSecrets(opts: {
  secretRuntime: SecretRuntime;
  deployment: any;
  published: any;
  smokeConnectOverride?: any;
}) {
  await opts.secretRuntime.enterStep("smoke");
  return await smokeNixosSharedHostPublishedComponents({
    deployment: opts.deployment,
    published: opts.published,
    ...resolveDeploymentSmokeExecutionMode({ deployment: opts.deployment }),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  }).catch((error) => {
    throw withFailedStep((error as any)?.failedStep || "smoke", error);
  });
}
