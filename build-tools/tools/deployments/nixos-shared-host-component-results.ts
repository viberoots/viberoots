#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeploymentComponent } from "./contract";
import type { DeploymentSmokeOutcome } from "./deployment-smoke-policy";
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts";

export type NixosSharedHostComponentPublishState = {
  finalOutcome: "succeeded" | "publish_failed" | "not_started";
  mode: "published" | "reused_live_identity";
  releasePath?: string;
  activatedPath?: string;
  liveArtifactIdentity?: string;
};

export type NixosSharedHostComponentSmokeState = {
  finalOutcome:
    | "succeeded"
    | "smoke_failed_after_publish"
    | "smoke_failed_nonblocking"
    | "omitted_by_exception"
    | "not_run";
  publicUrl?: string;
  healthUrl?: string;
  smokeOutcome?: DeploymentSmokeOutcome;
  smokeError?: string;
};

export type NixosSharedHostComponentResult = {
  componentId: string;
  providerTargetIdentity: string;
  artifactIdentity?: string;
  artifact?: NixosSharedHostAdmittedArtifact;
  publicUrl?: string;
  healthUrl?: string;
  finalOutcome:
    | "succeeded"
    | "publish_failed"
    | "smoke_failed_after_publish"
    | "smoke_failed_nonblocking"
    | "not_started";
  publishState?: NixosSharedHostComponentPublishState;
  smokeState?: NixosSharedHostComponentSmokeState;
};

export function baseNixosSharedHostComponentResult(
  component: Pick<NixosSharedHostDeploymentComponent, "id" | "providerTarget">,
  artifact?: NixosSharedHostAdmittedArtifact,
): NixosSharedHostComponentResult {
  return {
    componentId: component.id,
    providerTargetIdentity: component.providerTarget.sharedDevTargetIdentity || "",
    ...(artifact ? { artifact, artifactIdentity: artifact.identity } : {}),
    finalOutcome: "not_started",
  };
}

export function withNixosSharedHostPublishState(
  result: NixosSharedHostComponentResult,
  publishState: NixosSharedHostComponentPublishState,
): NixosSharedHostComponentResult {
  return {
    ...result,
    publishState,
    finalOutcome: publishState.finalOutcome,
  };
}

export function withNixosSharedHostSmokeState(
  result: NixosSharedHostComponentResult,
  smokeState: NixosSharedHostComponentSmokeState,
): NixosSharedHostComponentResult {
  return {
    ...result,
    smokeState,
    ...(smokeState.publicUrl ? { publicUrl: smokeState.publicUrl } : {}),
    ...(smokeState.healthUrl ? { healthUrl: smokeState.healthUrl } : {}),
    finalOutcome:
      smokeState.finalOutcome === "smoke_failed_after_publish"
        ? "smoke_failed_after_publish"
        : smokeState.finalOutcome === "smoke_failed_nonblocking"
          ? "smoke_failed_nonblocking"
          : result.finalOutcome,
  };
}

export function buildNixosSharedHostPublishFailureResults(opts: {
  published: NixosSharedHostComponentResult[];
  failedComponent: Pick<NixosSharedHostDeploymentComponent, "id" | "providerTarget">;
  failedArtifact?: NixosSharedHostAdmittedArtifact;
  remainingComponents: Array<Pick<NixosSharedHostDeploymentComponent, "id" | "providerTarget">>;
  artifactById: Map<string, NixosSharedHostAdmittedArtifact>;
}): NixosSharedHostComponentResult[] {
  return [
    ...opts.published.map((result) =>
      withNixosSharedHostSmokeState(result, { finalOutcome: "not_run" }),
    ),
    withNixosSharedHostPublishState(
      baseNixosSharedHostComponentResult(opts.failedComponent, opts.failedArtifact),
      {
        finalOutcome: "publish_failed",
        mode: "published",
      },
    ),
    ...opts.remainingComponents.map((component) =>
      baseNixosSharedHostComponentResult(component, opts.artifactById.get(component.id)),
    ),
  ];
}
