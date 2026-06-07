#!/usr/bin/env zx-wrapper
import type { AppStoreConnectDeployment } from "./contract";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve";
import { APP_STORE_CONNECT_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "./app-store-connect-control-plane";
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

export async function runAppStoreConnectServiceFrontDoor(opts: {
  workspaceRoot: string;
  deployment: AppStoreConnectDeployment;
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
  rejectServiceOnlyLocalFlags(opts.hasFlag || (() => false), "app-store-connect");
  if (opts.publishOnly && !opts.sourceRunId) {
    throw new Error(
      opts.rollback
        ? "app-store-connect rollback requires --source-run-id"
        : "app-store-connect --publish-only requires --source-run-id",
    );
  }
  if (opts.publishOnly && opts.artifactDirFlag) {
    throw new Error(
      "app-store-connect --publish-only must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
    );
  }
  const serviceClient = await resolveProtectedSharedServiceClient({
    deployment: opts.deployment,
    controlPlaneUrl: opts.controlPlaneUrl,
    controlPlaneToken: opts.controlPlaneToken,
    allowControlPlaneOverride: opts.allowControlPlaneOverride,
    workspaceRoot: opts.workspaceRoot,
    context: `app-store-connect ${opts.deployment.protectionClass} mutation`,
  });
  const admissionEvidence = serviceSubmissionAdmissionEvidence(opts.admissionEvidence as any);
  return await finalizeProtectedFrontDoorSubmission({
    controlPlaneUrl: serviceClient.controlPlaneUrl,
    controlPlaneToken: serviceClient.controlPlaneToken,
    request: {
      schemaVersion: APP_STORE_CONNECT_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
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
