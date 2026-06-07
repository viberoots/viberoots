#!/usr/bin/env zx-wrapper
import type { GooglePlayDeployment } from "./contract";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve";
import { GOOGLE_PLAY_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "./google-play-control-plane";
import { serviceSubmissionAdmissionEvidence } from "./deployment-service-client-contract";
import {
  resolveProtectedSharedServiceClient,
  serviceClientSelectionEvidence,
} from "./deployment-service-client-selection";
import {
  finalizeProtectedFrontDoorSubmission,
  rejectServiceOnlyLocalFlags,
} from "./deployment-provider-protected-front-door";
import { createNixosSharedHostSubmissionId } from "./nixos-shared-host-control-plane-snapshot";

export async function runGooglePlayServiceFrontDoor(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  publishOnly: boolean;
  rollback: boolean;
  sourceRunId: string;
  artifactDirFlag: string;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  allowControlPlaneOverride: boolean;
  admissionEvidence?: unknown;
  hasFlag?: (flag: string) => boolean;
}) {
  rejectServiceOnlyLocalFlags(opts.hasFlag || (() => false), "google-play");
  if (opts.publishOnly && !opts.sourceRunId) {
    throw new Error(
      opts.rollback
        ? "google-play rollback requires --source-run-id"
        : "google-play --publish-only requires --source-run-id",
    );
  }
  if (opts.publishOnly && opts.artifactDirFlag) {
    throw new Error(
      "google-play --publish-only must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
    );
  }
  const serviceClient = await resolveProtectedSharedServiceClient({
    deployment: opts.deployment,
    controlPlaneUrl: opts.controlPlaneUrl,
    controlPlaneToken: opts.controlPlaneToken,
    allowControlPlaneOverride: opts.allowControlPlaneOverride,
    workspaceRoot: opts.workspaceRoot,
    context: `google-play ${opts.deployment.protectionClass} mutation`,
  });
  const admissionEvidence = serviceSubmissionAdmissionEvidence(opts.admissionEvidence as any);
  return await finalizeProtectedFrontDoorSubmission({
    controlPlaneUrl: serviceClient.controlPlaneUrl,
    controlPlaneToken: serviceClient.controlPlaneToken,
    request: {
      schemaVersion: GOOGLE_PLAY_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
      submissionId: createNixosSharedHostSubmissionId(),
      submittedAt: new Date().toISOString(),
      deployment: opts.deployment,
      operationKind: opts.rollback ? "rollback" : opts.publishOnly ? "publish_only" : "deploy",
      ...(!opts.publishOnly
        ? {
            artifactPath:
              opts.artifactDirFlag ||
              (await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment)),
          }
        : {}),
      ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
      ...(admissionEvidence ? { admissionEvidence } : {}),
      controlPlaneSelection: serviceClientSelectionEvidence(serviceClient),
    },
  });
}
