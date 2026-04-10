#!/usr/bin/env zx-wrapper
import type { DeploymentRequirementStep } from "./deployment-requirements.ts";
import type { DeploymentReleaseAction } from "./deployment-release-actions.ts";
import type { NixosSharedHostConfig } from "./nixos-shared-host.ts";
import { assertNixosSharedHostReleaseActionPhaseReplayAllowed } from "./nixos-shared-host-release-actions.ts";
import { withFailedStep } from "./nixos-shared-host-deploy-failure.ts";
import { resolveDeploymentSmokeExecutionMode } from "./deployment-smoke-policy.ts";
import { smokeNixosSharedHostPublishedComponents } from "./nixos-shared-host-publish-components.ts";
import { materializeNixosSharedHostRuntime } from "./nixos-shared-host-runtime.ts";

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
  ) => Promise<void>,
  operationKind: "deploy" | "promotion" | "retry" | "rollback",
  releaseActions: DeploymentReleaseAction[],
  phase: keyof typeof RELEASE_PHASE_STEP,
  extra?: { artifactIdentity?: string; publicUrl?: string },
) {
  assertNixosSharedHostReleaseActionPhaseReplayAllowed({
    operationKind,
    phase,
    releaseActions,
  });
  await secretRuntime.enterStep(RELEASE_PHASE_STEP[phase]);
  await runReleasePhase(phase, extra);
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
