#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentReleaseAction } from "./deployment-release-actions.ts";
import { SSR_WEBAPP_COMPONENT } from "./contract.ts";

export const NIXOS_SHARED_HOST_RELEASE_ACTION_RUNNER_IDENTITY =
  "nixos-shared-host-release-actions@1";

export type NixosSharedHostRunnerIdentities = {
  publisher?: string;
  provisioner?: string;
  smoke?: string;
  releaseActions?: string;
};

export type NixosSharedHostRecordedReleaseAction = DeploymentReleaseAction & {
  runnerIdentity: typeof NIXOS_SHARED_HOST_RELEASE_ACTION_RUNNER_IDENTITY;
};

function smokeRunnerIdentityFor(deployment: NixosSharedHostDeployment): string | undefined {
  return deployment.component.kind === SSR_WEBAPP_COMPONENT
    ? "nixos-shared-host-ssr-webapp-smoke"
    : "nixos-shared-host-static-webapp-smoke";
}

export function nixosSharedHostRunnerIdentities(
  deployment: NixosSharedHostDeployment,
  releaseActions: DeploymentReleaseAction[],
): NixosSharedHostRunnerIdentities {
  return {
    publisher: deployment.publisher.type,
    ...(deployment.provisioner ? { provisioner: deployment.provisioner.type } : {}),
    smoke: smokeRunnerIdentityFor(deployment),
    ...(releaseActions.length > 0
      ? { releaseActions: NIXOS_SHARED_HOST_RELEASE_ACTION_RUNNER_IDENTITY }
      : {}),
  };
}

export function recordedReleaseActionPlan(
  actions: DeploymentReleaseAction[],
): NixosSharedHostRecordedReleaseAction[] {
  return actions.map((action) => ({
    ...action,
    runnerIdentity: NIXOS_SHARED_HOST_RELEASE_ACTION_RUNNER_IDENTITY,
  }));
}

export function runnerIdentityCompatibilityErrors(
  expected: NixosSharedHostRunnerIdentities,
  actual?: NixosSharedHostRunnerIdentities,
): string[] {
  if (!actual) return ["stored runner identities are missing"];
  const errors: string[] = [];
  for (const key of Object.keys(expected) as Array<keyof NixosSharedHostRunnerIdentities>) {
    if (!expected[key]) continue;
    if (expected[key] !== actual[key]) {
      errors.push(
        `${key} runner identity mismatch: current=${expected[key]} source=${actual[key] || "<missing>"}`,
      );
    }
  }
  return errors;
}
