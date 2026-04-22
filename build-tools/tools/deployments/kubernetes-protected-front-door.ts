#!/usr/bin/env zx-wrapper
import { createNixosSharedHostSubmissionId } from "./nixos-shared-host-control-plane-snapshot.ts";
import {
  resolveArtifactDirForCli,
  resolveComponentArtifactDirsForCli,
} from "./deployment-cli-resolve.ts";
import type { KubernetesDeployment } from "./contract.ts";
import { resolveServiceClientFromFlags } from "./nixos-shared-host-service-client-config.ts";
import {
  finalizeProtectedFrontDoorSubmission,
  rejectServiceOnlyLocalFlags,
} from "./deployment-provider-protected-front-door.ts";
import { KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "./kubernetes-control-plane.ts";
import { serviceSubmissionAdmissionEvidence } from "./deployment-service-client-contract.ts";

export async function runProtectedKubernetesDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
  publishOnly: boolean;
  provisionOnly: boolean;
  rollback: boolean;
  sourceRunId: string;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
  hasFlag: (flag: string) => boolean;
}) {
  rejectServiceOnlyLocalFlags(opts.hasFlag, "kubernetes");
  const admissionEvidence = serviceSubmissionAdmissionEvidence(opts.admissionEvidence as any);
  const serviceClient = resolveServiceClientFromFlags({
    controlPlaneUrl: opts.controlPlaneUrl,
    controlPlaneToken: opts.controlPlaneToken,
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
      ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
      ...(admissionEvidence ? { admissionEvidence } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    },
  });
}
