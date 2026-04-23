#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import type { DeploymentControlPlaneStatus } from "./deployment-control-plane-contract.ts";
import {
  readNixosSharedHostControlPlaneRecordViaService,
  createNixosSharedHostArtifactChallengeViaService,
  submitNixosSharedHostControlPlaneViaService,
} from "./nixos-shared-host-control-plane-client.ts";
import type { NixosSharedHostControlPlaneOperationKind } from "./nixos-shared-host-control-plane-contract.ts";
import {
  NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type NixosSharedHostControlPlaneSubmitRequest,
} from "./nixos-shared-host-control-plane-api-contract.ts";
import { createNixosSharedHostSubmissionId } from "./nixos-shared-host-control-plane-snapshot.ts";
import {
  artifactBindingEnvelope,
  createArtifactBindingProof,
  expectedNixosSharedHostArtifactIdentities,
  type DeploymentExpectedArtifactIdentities,
} from "./deployment-artifact-binding.ts";
import { deploymentServicePrincipalForToken } from "./deployment-artifact-challenges.ts";

export type NixosSharedHostServiceFrontDoorResponse =
  | { kind: "result"; result: { record: any } }
  | { kind: "status"; status: DeploymentControlPlaneStatus };

function resolvedArtifactDirsByComponentId(artifactDirsByComponentId?: Record<string, string>) {
  if (!artifactDirsByComponentId) return undefined;
  return Object.fromEntries(
    Object.entries(artifactDirsByComponentId).map(([key, value]) => [key, path.resolve(value)]),
  );
}

function clientAdmissionEvidence(admissionEvidence?: DeploymentAdmissionEvidence) {
  if (!admissionEvidence) return undefined;
  const { requestedBy: _requestedBy, ...evidence } = admissionEvidence;
  return evidence;
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
  if (!status.deployRunId) return { kind: "status" as const, status };
  const record = await readFinalizedRecord({
    controlPlaneUrl,
    ...(controlPlaneToken ? { controlPlaneToken } : {}),
    deployRunId: status.deployRunId,
  });
  if (record.finalOutcome !== "succeeded") {
    const details =
      typeof record.error === "string" && record.error.trim()
        ? record.error.trim()
        : typeof record.smokeError === "string" && record.smokeError.trim()
          ? record.smokeError.trim()
          : `final outcome: ${String(record.finalOutcome || "unknown")}`;
    throw Object.assign(new Error(`shared control-plane mutation failed: ${details}`), {
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
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}) {
  const admissionEvidence = clientAdmissionEvidence(opts.admissionEvidence);
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
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
    ...(opts.rollback ? { rollback: true } : {}),
    ...(admissionEvidence ? { admissionEvidence } : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
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
