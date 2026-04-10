#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentReleaseAction } from "./deployment-release-actions.ts";
import { withFailedStep } from "./nixos-shared-host-deploy-failure.ts";
import { runNixosSharedHostReleaseActionPhase } from "./nixos-shared-host-release-actions.ts";

export function createNixosSharedHostReleasePhaseRunner(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: NixosSharedHostDeployment;
  operationKind: string;
  publishBehavior: "deploy" | "publish-only" | "provision-only";
  releaseActions: DeploymentReleaseAction[];
}) {
  return async (
    phase: "pre_publish" | "post_publish_pre_smoke" | "post_smoke",
    extra: { artifactIdentity?: string; publicUrl?: string } = {},
  ) =>
    runNixosSharedHostReleaseActionPhase({ ...opts, phase, ...extra }).catch((error) => {
      throw withFailedStep(`release_actions.${phase}`, error);
    });
}
