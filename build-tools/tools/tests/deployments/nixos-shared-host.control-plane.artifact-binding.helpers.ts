#!/usr/bin/env zx-wrapper
import {
  artifactBindingEnvelope,
  createArtifactBindingProof,
  expectedNixosSharedHostArtifactIdentities,
} from "../../deployments/deployment-artifact-binding.ts";
import { deploymentServicePrincipalForToken } from "../../deployments/deployment-artifact-challenges.ts";
import { serviceSubmissionAdmissionEvidence } from "../../deployments/deployment-service-client-contract.ts";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract.ts";
import { createNixosSharedHostSubmissionId } from "../../deployments/nixos-shared-host-control-plane-snapshot.ts";
import { readJson } from "./nixos-shared-host.control-plane.helpers.ts";

export async function submitServiceRequest(opts: {
  url: string;
  deployment: any;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
}) {
  const expected = await expectedNixosSharedHostArtifactIdentities({
    deployment: opts.deployment,
    ...(opts.artifactDir ? { artifactDir: opts.artifactDir } : {}),
    ...(opts.artifactDirsByComponentId
      ? { artifactDirsByComponentId: opts.artifactDirsByComponentId }
      : {}),
  });
  const request = {
    schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
    submissionId: createNixosSharedHostSubmissionId(),
    submittedAt: new Date().toISOString(),
    deployment: opts.deployment,
    operationKind: "deploy",
    ...(opts.artifactDir ? { artifactDir: opts.artifactDir } : {}),
    ...(opts.artifactDirsByComponentId
      ? { artifactDirsByComponentId: opts.artifactDirsByComponentId }
      : {}),
    ...expected,
    ...(serviceSubmissionAdmissionEvidence(opts.admissionEvidence as any)
      ? { admissionEvidence: serviceSubmissionAdmissionEvidence(opts.admissionEvidence as any) }
      : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  };
  const challenge = await readJson<any>(
    await fetch(new URL("/api/v1/submission-challenges/artifact", opts.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
  const principal = deploymentServicePrincipalForToken();
  return await readJson<any>(
    await fetch(new URL("/api/v1/submissions", opts.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...request,
        artifactBindingProof: createArtifactBindingProof(
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
        ),
      }),
    }),
  );
}
