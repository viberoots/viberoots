#!/usr/bin/env zx-wrapper
import { redactDeploymentAuthText } from "./deployment-auth-redaction.ts";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract.ts";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend.ts";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract.ts";
import {
  cleanupRejectedStagedArtifacts,
  type StagedArtifactCleanupReason,
} from "./nixos-shared-host-staged-artifact-cleanup.ts";

function rejectedCleanupRefs(
  request: NixosSharedHostControlPlaneSubmitRequest,
  reason: StagedArtifactCleanupReason,
) {
  const refs = [
    ...(request.artifactDir ? [request.artifactDir] : []),
    ...Object.values(request.artifactDirsByComponentId || {}),
  ];
  return refs.map((artifactDir) => ({
    artifactDir,
    reason,
    submissionId: request.submissionId,
    deploymentId: request.deployment.deploymentId,
  }));
}

export async function cleanupRejectedNixosSubmitRequest(opts: {
  request: NixosSharedHostControlPlaneSubmitRequest;
  paths: NixosSharedHostControlPlanePaths;
  backend: NixosSharedHostControlPlaneBackendTarget;
  reason: StagedArtifactCleanupReason;
}) {
  const refs = rejectedCleanupRefs(opts.request, opts.reason);
  if (refs.length === 0) return;
  await cleanupRejectedStagedArtifacts({
    paths: opts.paths,
    backend: opts.backend,
    refs,
  });
}

export async function cleanupThenRethrowRejectedNixosSubmit(opts: {
  error: unknown;
  request: NixosSharedHostControlPlaneSubmitRequest;
  paths: NixosSharedHostControlPlanePaths;
  backend: NixosSharedHostControlPlaneBackendTarget;
  reason: StagedArtifactCleanupReason;
}): Promise<never> {
  try {
    await cleanupRejectedNixosSubmitRequest(opts);
  } catch (cleanupError) {
    const original = opts.error instanceof Error ? opts.error.message : String(opts.error);
    const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    throw new Error(
      redactDeploymentAuthText(
        `${original}\nrejected staged artifact cleanup/janitor failed: ${cleanup}`,
      ),
    );
  }
  throw opts.error;
}
