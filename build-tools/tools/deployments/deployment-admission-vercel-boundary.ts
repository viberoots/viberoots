#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import { releaseActionRefs } from "./deployment-release-actions";

export function requireVercelBuiltInExecutionBoundary(deployment: DeploymentTarget) {
  if (deployment.publisher.type !== "vercel-prebuilt") {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `protected/shared admission rejects non-built-in vercel publisher ${deployment.publisher.type}`,
    );
  }
  if (deployment.releaseActions.length > 0) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `protected/shared admission rejects vercel deployment-local release_actions: ${releaseActionRefs(deployment.releaseActions).join(", ")}`,
    );
  }
}
