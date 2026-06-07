#!/usr/bin/env zx-wrapper
import { createNixosSharedHostSubmissionId } from "./nixos-shared-host-control-plane-snapshot";
import type { VercelDeployment } from "./contract";
import {
  resolveProtectedSharedServiceClient,
  serviceClientSelectionEvidence,
} from "./deployment-service-client-selection";
import {
  finalizeProtectedFrontDoorSubmission,
  rejectServiceOnlyLocalFlags,
} from "./deployment-provider-protected-front-door";
import { VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "./vercel-control-plane";
import { serviceSubmissionAdmissionEvidence } from "./deployment-service-client-contract";
import { resolveExpectedDeploymentSourceRevision } from "./deployment-source-revision";

type ProtectedVercelOperation = "deploy" | "preview" | "preview_cleanup" | "retry" | "rollback";

export async function runProtectedVercelDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: VercelDeployment;
  publishOnly: boolean;
  preview: boolean;
  previewCleanup: boolean;
  rollback: boolean;
  sourceRunId: string;
  artifactDirFlag: string;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  allowControlPlaneOverride?: boolean;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
  hasFlag: (flag: string) => boolean;
}) {
  rejectServiceOnlyLocalFlags(opts.hasFlag, "vercel");
  rejectLocalArtifactInputs(opts);
  const operationKind: ProtectedVercelOperation = opts.previewCleanup
    ? "preview_cleanup"
    : opts.rollback
      ? "rollback"
      : opts.publishOnly
        ? "retry"
        : opts.preview
          ? "preview"
          : "deploy";
  if ((operationKind === "retry" || operationKind === "rollback") && !opts.sourceRunId) {
    throw new Error(
      `vercel ${operationKind} requires --source-run-id to replay an admitted exact artifact`,
    );
  }
  if (operationKind === "preview_cleanup" && !opts.sourceRunId) {
    throw new Error("vercel --preview-cleanup requires --source-run-id");
  }
  if (operationKind === "deploy" && !opts.sourceRunId) {
    throw new Error(
      "protected/shared vercel deploy requires --source-run-id selecting an admitted prebuilt artifact; --artifact-dir is not accepted",
    );
  }
  if (operationKind === "preview" && !opts.sourceRunId) {
    throw new Error("protected/shared vercel preview requires --source-run-id");
  }
  const admissionEvidence = serviceSubmissionAdmissionEvidence(opts.admissionEvidence as any);
  const expectedSourceRevision = await resolveExpectedDeploymentSourceRevision({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    admissionEvidence,
  });
  const serviceClient = await resolveProtectedSharedServiceClient({
    deployment: opts.deployment,
    controlPlaneUrl: opts.controlPlaneUrl,
    controlPlaneToken: opts.controlPlaneToken,
    allowControlPlaneOverride: opts.allowControlPlaneOverride,
    workspaceRoot: opts.workspaceRoot,
    context: `vercel ${opts.deployment.protectionClass} mutation`,
  });
  return await finalizeProtectedFrontDoorSubmission({
    controlPlaneUrl: serviceClient.controlPlaneUrl,
    controlPlaneToken: serviceClient.controlPlaneToken,
    request: {
      schemaVersion: VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
      submissionId: createNixosSharedHostSubmissionId(),
      submittedAt: new Date().toISOString(),
      deployment: opts.deployment,
      operationKind,
      ...(expectedSourceRevision ? { expectedSourceRevision } : {}),
      ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
      ...(admissionEvidence ? { admissionEvidence } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      controlPlaneSelection: serviceClientSelectionEvidence(serviceClient),
    },
  });
}

function rejectLocalArtifactInputs(opts: {
  artifactDirFlag: string;
  hasFlag: (flag: string) => boolean;
}) {
  if (
    !opts.artifactDirFlag &&
    !opts.hasFlag("artifact-dir") &&
    !opts.hasFlag("component-artifacts")
  ) {
    return;
  }
  throw new Error(
    "protected/shared vercel deploy does not support --artifact-dir; submit an admitted artifact through the deployment service or use --source-run-id for preview, retry, rollback, and preview cleanup",
  );
}
