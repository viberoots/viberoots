#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { NixosSharedHostDeployment } from "./contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import type { DeploymentControlPlaneStatus } from "./deployment-control-plane-contract";
import {
  readNixosSharedHostControlPlaneRecordViaService,
  createNixosSharedHostArtifactChallengeViaService,
  submitNixosSharedHostControlPlaneViaService,
} from "./nixos-shared-host-control-plane-client";
import type { NixosSharedHostControlPlaneOperationKind } from "./nixos-shared-host-control-plane-contract";
import {
  NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type NixosSharedHostControlPlaneSubmitRequest,
} from "./nixos-shared-host-control-plane-api-contract";
import { createNixosSharedHostSubmissionId } from "./nixos-shared-host-control-plane-snapshot";
import {
  artifactBindingEnvelope,
  createArtifactBindingProof,
  expectedNixosSharedHostArtifactIdentities,
  type DeploymentExpectedArtifactIdentities,
} from "./deployment-artifact-binding";
import { deploymentServicePrincipalForToken } from "./deployment-artifact-challenges";
import { terminalControlPlaneRejectionMessage } from "./deployment-provider-protected-front-door";
import { controlPlaneRecordFailureMessage } from "./deployment-control-plane-record-failure";
import {
  clientServiceAdmissionEvidence,
  resolveExpectedDeploymentSourceRevision,
} from "./deployment-source-revision";
import type { DeploymentServiceClientSelectionEvidence } from "./deployment-service-client-selection";

export type NixosSharedHostServiceFrontDoorResponse =
  | { kind: "result"; result: { record: any } }
  | { kind: "status"; status: DeploymentControlPlaneStatus };

function resolvedArtifactDirsByComponentId(artifactDirsByComponentId?: Record<string, string>) {
  if (!artifactDirsByComponentId) return undefined;
  return Object.fromEntries(
    Object.entries(artifactDirsByComponentId).map(([key, value]) => [key, path.resolve(value)]),
  );
}

async function readFinalizedRecord(opts: {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  deployRunId: string;
}) {
  const deadline = Date.now() + 3_000;
  while (true) {
    try {
      return await readNixosSharedHostControlPlaneRecordViaService({
        controlPlaneUrl: opts.controlPlaneUrl,
        ...(opts.controlPlaneToken ? { token: opts.controlPlaneToken } : {}),
        deployRunId: opts.deployRunId,
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("record not found")) throw error;
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function finalizeServiceResponse(
  controlPlaneUrl: string,
  controlPlaneToken: string | undefined,
  status: DeploymentControlPlaneStatus,
) {
  const rejectionMessage = terminalControlPlaneRejectionMessage(status);
  if (rejectionMessage) throw Object.assign(new Error(rejectionMessage), { status });
  if (!status.deployRunId) return { kind: "status" as const, status };
  const record = await readFinalizedRecord({
    controlPlaneUrl,
    ...(controlPlaneToken ? { controlPlaneToken } : {}),
    deployRunId: status.deployRunId,
  });
  if (record.finalOutcome !== "succeeded") {
    throw Object.assign(new Error(controlPlaneRecordFailureMessage(record)), {
      status,
      record,
    });
  }
  return {
    kind: "result" as const,
    result: {
      record,
    },
  };
}

export async function runNixosSharedHostDirectServiceMutation(opts: {
  workspaceRoot?: string;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  deployment: NixosSharedHostDeployment;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  authSessionId?: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  expectedArtifactIdentities?: DeploymentExpectedArtifactIdentities;
  publishBehavior?: "publish-only" | "provision-only";
  sourceRunId?: string;
  rollback?: boolean;
  idempotencyKey?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  controlPlaneSelection?: DeploymentServiceClientSelectionEvidence;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}) {
  const admissionEvidence = clientServiceAdmissionEvidence(opts.admissionEvidence);
  const expectedSourceRevision =
    !opts.sourceRunId && opts.operationKind !== "explicit_removal" && opts.workspaceRoot
      ? await resolveExpectedDeploymentSourceRevision({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          admissionEvidence,
        })
      : undefined;
  const expected =
    opts.expectedArtifactIdentities ||
    (await expectedNixosSharedHostArtifactIdentities({
      deployment: opts.deployment,
      ...(opts.artifactDir ? { artifactDir: opts.artifactDir } : {}),
      ...(opts.artifactDirsByComponentId
        ? { artifactDirsByComponentId: opts.artifactDirsByComponentId }
        : {}),
    }));
  const request: NixosSharedHostControlPlaneSubmitRequest = {
    schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
    submissionId: createNixosSharedHostSubmissionId(),
    submittedAt: new Date().toISOString(),
    deployment: opts.deployment,
    operationKind: opts.operationKind,
    ...(opts.authSessionId ? { authSessionId: opts.authSessionId } : {}),
    ...(opts.artifactDir ? { artifactDir: path.resolve(opts.artifactDir) } : {}),
    ...(resolvedArtifactDirsByComponentId(opts.artifactDirsByComponentId)
      ? {
          artifactDirsByComponentId: resolvedArtifactDirsByComponentId(
            opts.artifactDirsByComponentId,
          ),
        }
      : {}),
    ...expected,
    ...(opts.publishBehavior ? { publishBehavior: opts.publishBehavior } : {}),
    ...(expectedSourceRevision ? { expectedSourceRevision } : {}),
    ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
    ...(opts.rollback ? { rollback: true } : {}),
    ...(admissionEvidence ? { admissionEvidence } : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    ...(opts.controlPlaneSelection ? { controlPlaneSelection: opts.controlPlaneSelection } : {}),
  };
  if (request.artifactDir || request.artifactDirsByComponentId) {
    const challenge = await createNixosSharedHostArtifactChallengeViaService({
      controlPlaneUrl: opts.controlPlaneUrl,
      token: opts.controlPlaneToken,
      request,
    });
    const principal = deploymentServicePrincipalForToken(opts.controlPlaneToken);
    request.artifactBindingProof = createArtifactBindingProof(
      artifactBindingEnvelope({
        request,
        principalId: principal.principalId,
        keyId: challenge.keyId,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        finalizedStagedArtifactReference:
          request.artifactDir || JSON.stringify(request.artifactDirsByComponentId),
      }),
      principal.proofSecret,
    );
  }
  const { final } = await submitNixosSharedHostControlPlaneViaService({
    controlPlaneUrl: opts.controlPlaneUrl,
    token: opts.controlPlaneToken,
    request,
  });
  return await finalizeServiceResponse(opts.controlPlaneUrl, opts.controlPlaneToken, final);
}
