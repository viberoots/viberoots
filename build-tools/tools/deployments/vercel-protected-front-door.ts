#!/usr/bin/env zx-wrapper
import { createNixosSharedHostSubmissionId } from "./nixos-shared-host-control-plane-snapshot.ts";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve.ts";
import type { VercelDeployment } from "./contract.ts";
import { resolveServiceClientFromCliProfileOrFlags } from "./deployment-service-client-profile.ts";
import {
  finalizeProtectedFrontDoorSubmission,
  rejectServiceOnlyLocalFlags,
} from "./deployment-provider-protected-front-door.ts";
import { VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "./vercel-control-plane.ts";
import { serviceSubmissionAdmissionEvidence } from "./deployment-service-client-contract.ts";
import { resolveExpectedDeploymentSourceRevision } from "./deployment-source-revision.ts";

type ProtectedVercelOperation = "deploy" | "preview" | "preview_cleanup" | "retry" | "rollback";

export async function runProtectedVercelDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: VercelDeployment;
  publishOnly: boolean;
  preview: boolean;
  previewCleanup: boolean;
  rollback: boolean;
  sourceRunId: string;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
  hasFlag: (flag: string) => boolean;
}) {
  rejectServiceOnlyLocalFlags(opts.hasFlag, "vercel");
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
  const admissionEvidence = serviceSubmissionAdmissionEvidence(opts.admissionEvidence as any);
  const expectedSourceRevision = await resolveExpectedDeploymentSourceRevision({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    admissionEvidence,
  });
  const serviceClient = await resolveServiceClientFromCliProfileOrFlags({
    workspaceRoot: opts.workspaceRoot,
    controlPlaneUrl: opts.controlPlaneUrl,
    controlPlaneToken: opts.controlPlaneToken,
    defaultProfileName: opts.deployment.lanePolicy.defaultClientProfile,
    context: `vercel ${opts.deployment.protectionClass} mutation`,
  });
  const requiresArtifact = operationKind === "deploy" || operationKind === "preview";
  return await finalizeProtectedFrontDoorSubmission({
    controlPlaneUrl: serviceClient.controlPlaneUrl,
    controlPlaneToken: serviceClient.controlPlaneToken,
    request: {
      schemaVersion: VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
      submissionId: createNixosSharedHostSubmissionId(),
      submittedAt: new Date().toISOString(),
      deployment: opts.deployment,
      operationKind,
      ...(requiresArtifact
        ? { artifactDir: await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment) }
        : {}),
      ...(expectedSourceRevision ? { expectedSourceRevision } : {}),
      ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
      ...(admissionEvidence ? { admissionEvidence } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    },
  });
}
