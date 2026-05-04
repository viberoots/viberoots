#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract";
import type { DeploymentReleaseAction } from "./deployment-release-actions";
import { withFailedStep } from "./nixos-shared-host-deploy-failure";
import {
  runNixosSharedHostReleaseActionPhase,
  type NixosSharedHostReleaseActionExecutionPath,
} from "./nixos-shared-host-release-actions";

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
    executionPath: NixosSharedHostReleaseActionExecutionPath = "success",
  ) =>
    runNixosSharedHostReleaseActionPhase({ ...opts, phase, ...extra, executionPath }).catch(
      (error) => {
        throw withFailedStep(`release_actions.${phase}`, error);
      },
    );
}
