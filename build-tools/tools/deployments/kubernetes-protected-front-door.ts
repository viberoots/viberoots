#!/usr/bin/env zx-wrapper
import { createNixosSharedHostSubmissionId } from "./nixos-shared-host-control-plane-snapshot";
import {
  resolveArtifactDirForCli,
  resolveComponentArtifactDirsForCli,
} from "./deployment-cli-resolve";
import type { KubernetesDeployment } from "./contract";
import {
  resolveProtectedSharedServiceClient,
  serviceClientSelectionEvidence,
} from "./deployment-service-client-selection";
import {
  finalizeProtectedFrontDoorSubmission,
  rejectServiceOnlyLocalFlags,
} from "./deployment-provider-protected-front-door";
import { KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "./kubernetes-control-plane";
import { serviceSubmissionAdmissionEvidence } from "./deployment-service-client-contract";
import { resolveExpectedDeploymentSourceRevision } from "./deployment-source-revision";

export async function runProtectedKubernetesDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
  publishOnly: boolean;
  provisionOnly: boolean;
  rollback: boolean;
  sourceRunId: string;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  remote?: string;
  allowControlPlaneOverride?: boolean;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
  hasFlag: (flag: string) => boolean;
}) {
  rejectServiceOnlyLocalFlags(opts.hasFlag, "kubernetes");
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
    remote: opts.remote,
    allowControlPlaneOverride: opts.allowControlPlaneOverride,
    workspaceRoot: opts.workspaceRoot,
    context: `kubernetes ${opts.deployment.protectionClass} mutation`,
  });
  return await finalizeProtectedFrontDoorSubmission({
    controlPlaneUrl: serviceClient.controlPlaneUrl,
    controlPlaneToken: serviceClient.controlPlaneToken,
    request: {
      schemaVersion: KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
      submissionId: createNixosSharedHostSubmissionId(),
      submittedAt: new Date().toISOString(),
      deployment: opts.deployment,
      operationKind: opts.provisionOnly
        ? "provision_only"
        : opts.rollback
          ? "rollback"
          : opts.publishOnly
            ? "promotion"
            : "deploy",
      ...(!opts.publishOnly && !opts.provisionOnly
        ? opts.deployment.components.length > 1
          ? {
              artifactDirsByComponentId: await resolveComponentArtifactDirsForCli(
                opts.workspaceRoot,
                opts.deployment,
              ),
            }
          : { artifactDir: await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment) }
        : {}),
      ...(expectedSourceRevision ? { expectedSourceRevision } : {}),
      ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
      ...(admissionEvidence ? { admissionEvidence } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      controlPlaneSelection: serviceClientSelectionEvidence(serviceClient),
    },
  });
}
