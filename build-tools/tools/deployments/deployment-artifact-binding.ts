#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import path from "node:path";
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  artifactIdentityForNixosSharedHostDir,
  type NixosSharedHostAdmittedArtifact,
} from "./nixos-shared-host-artifacts.ts";
import {
  compositeNixosSharedHostArtifactIdentity,
  type NixosSharedHostResolvedComponentArtifact,
} from "./nixos-shared-host-component-artifacts.ts";
import { nixosSharedHostDeploymentTargetIdentity } from "./nixos-shared-host-components.ts";
import type { NixosSharedHostControlPlaneOperationKind } from "./nixos-shared-host-control-plane-contract.ts";
import type { NixosSharedHostControlPlaneSourceSelection } from "./nixos-shared-host-control-plane-snapshot.ts";

export const DEPLOYMENT_ARTIFACT_BINDING_PROOF_SCHEMA = "deployment-artifact-binding-proof@1";
export const DEPLOYMENT_ARTIFACT_CHALLENGE_SCHEMA = "deployment-artifact-challenge@1";
export const DEPLOYMENT_ARTIFACT_BINDING_ALGORITHM = "hmac-sha256";

export type DeploymentExpectedArtifactIdentities = {
  expectedArtifactIdentity?: string;
  expectedComponentArtifactIdentities?: Record<string, string>;
  expectedCompositeArtifactIdentity?: string;
};

export type DeploymentArtifactBindingProvenance = {
  challengeId: string;
  principalId: string;
  keyId: string;
  proofAlgorithm: typeof DEPLOYMENT_ARTIFACT_BINDING_ALGORITHM;
  canonicalEnvelopeFingerprint: string;
  expectedIdentities: DeploymentExpectedArtifactIdentities;
  admittedIdentities: DeploymentExpectedArtifactIdentities;
  verificationDecision: "accepted";
  verifiedAt: string;
  admittedStoredArtifactReference?: string;
};

export type DeploymentArtifactBindingProof = {
  schemaVersion: typeof DEPLOYMENT_ARTIFACT_BINDING_PROOF_SCHEMA;
  challengeId: string;
  algorithm: typeof DEPLOYMENT_ARTIFACT_BINDING_ALGORITHM;
  keyId: string;
  canonicalPayloadFingerprint: string;
  mac: string;
};

export type DeploymentArtifactChallengeResponse = {
  schemaVersion: typeof DEPLOYMENT_ARTIFACT_CHALLENGE_SCHEMA;
  challengeId: string;
  nonce: string;
  expiresAt: string;
  algorithm: typeof DEPLOYMENT_ARTIFACT_BINDING_ALGORITHM;
  keyId: string;
  bindingFingerprint: string;
};

export type DeploymentArtifactChallengeRequest = DeploymentExpectedArtifactIdentities & {
  schemaVersion: string;
  deployment: NixosSharedHostDeployment;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  publishBehavior?: string;
  sourceRunId?: string;
  source?: NixosSharedHostControlPlaneSourceSelection;
  rollback?: boolean;
  idempotencyKey?: string;
  proofKeyId?: string;
  proofAlgorithm?: string;
};

export type DeploymentArtifactBindingEnvelope = DeploymentArtifactChallengeRequest & {
  principalId: string;
  keyId: string;
  providerTargetIdentity: string;
  challengeId: string;
  nonce: string;
  finalizedStagedArtifactReference?: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function artifactBindingFingerprint(value: unknown): string {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

export function artifactBindingKeyId(secret: string): string {
  return `deployment-client:${crypto.createHash("sha256").update(secret).digest("hex").slice(0, 16)}`;
}

export function createArtifactBindingProof(
  envelope: DeploymentArtifactBindingEnvelope,
  secret: string,
): DeploymentArtifactBindingProof {
  const canonicalPayloadFingerprint = artifactBindingFingerprint(envelope);
  const mac = crypto.createHmac("sha256", secret).update(canonicalPayloadFingerprint).digest("hex");
  return {
    schemaVersion: DEPLOYMENT_ARTIFACT_BINDING_PROOF_SCHEMA,
    challengeId: envelope.challengeId,
    algorithm: DEPLOYMENT_ARTIFACT_BINDING_ALGORITHM,
    keyId: envelope.keyId,
    canonicalPayloadFingerprint,
    mac,
  };
}

export function verifyArtifactBindingProof(opts: {
  proof?: DeploymentArtifactBindingProof;
  envelope: DeploymentArtifactBindingEnvelope;
  secret: string;
}) {
  if (!opts.proof) throw new Error("artifact-binding proof is required");
  if (opts.proof.schemaVersion !== DEPLOYMENT_ARTIFACT_BINDING_PROOF_SCHEMA) {
    throw new Error("artifact-binding proof has unsupported schema");
  }
  if (opts.proof.algorithm !== DEPLOYMENT_ARTIFACT_BINDING_ALGORITHM) {
    throw new Error("artifact-binding proof uses unsupported algorithm");
  }
  if (opts.proof.keyId !== opts.envelope.keyId) {
    throw new Error("artifact-binding proof key id does not match the challenge");
  }
  if (opts.proof.challengeId !== opts.envelope.challengeId) {
    throw new Error("artifact-binding proof challenge id does not match the challenge");
  }
  const expected = createArtifactBindingProof(opts.envelope, opts.secret);
  if (opts.proof.canonicalPayloadFingerprint !== expected.canonicalPayloadFingerprint) {
    throw new Error("artifact-binding proof canonical payload fingerprint mismatch");
  }
  if (
    opts.proof.mac.length !== expected.mac.length ||
    !crypto.timingSafeEqual(Buffer.from(opts.proof.mac), Buffer.from(expected.mac))
  ) {
    throw new Error("artifact-binding proof verification failed");
  }
}

export async function expectedNixosSharedHostArtifactIdentities(opts: {
  deployment: NixosSharedHostDeployment;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
}): Promise<DeploymentExpectedArtifactIdentities> {
  if (opts.artifactDirsByComponentId) {
    const expectedComponentArtifactIdentities: Record<string, string> = {};
    const componentArtifacts: NixosSharedHostResolvedComponentArtifact[] = [];
    for (const component of opts.deployment.components) {
      const artifactDir = opts.artifactDirsByComponentId[component.id];
      if (!artifactDir) throw new Error(`missing artifact dir for component "${component.id}"`);
      const identity = await artifactIdentityForNixosSharedHostDir(
        path.resolve(artifactDir),
        component.kind,
      );
      expectedComponentArtifactIdentities[component.id] = identity;
      componentArtifacts.push({
        componentId: component.id,
        artifact: { kind: component.kind, identity } as NixosSharedHostAdmittedArtifact,
      });
    }
    return {
      expectedComponentArtifactIdentities,
      expectedCompositeArtifactIdentity:
        compositeNixosSharedHostArtifactIdentity(componentArtifacts),
    };
  }
  if (!opts.artifactDir) return {};
  return {
    expectedArtifactIdentity: await artifactIdentityForNixosSharedHostDir(
      path.resolve(opts.artifactDir),
      opts.deployment.component.kind,
    ),
  };
}

export function baseArtifactChallengeRequest(
  request: DeploymentArtifactChallengeRequest,
): DeploymentArtifactChallengeRequest {
  return {
    schemaVersion: request.schemaVersion,
    deployment: request.deployment,
    operationKind: request.operationKind,
    publishBehavior: request.publishBehavior || "deploy",
    ...(request.sourceRunId ? { sourceRunId: request.sourceRunId } : {}),
    ...(request.source ? { source: request.source } : {}),
    ...(request.rollback ? { rollback: true } : {}),
    ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
    ...expectedFields(request),
  };
}

export function expectedFields(
  value: DeploymentExpectedArtifactIdentities,
): DeploymentExpectedArtifactIdentities {
  return {
    ...(value.expectedArtifactIdentity
      ? { expectedArtifactIdentity: value.expectedArtifactIdentity }
      : {}),
    ...(value.expectedComponentArtifactIdentities
      ? { expectedComponentArtifactIdentities: value.expectedComponentArtifactIdentities }
      : {}),
    ...(value.expectedCompositeArtifactIdentity
      ? { expectedCompositeArtifactIdentity: value.expectedCompositeArtifactIdentity }
      : {}),
  };
}

export function artifactBindingEnvelope(opts: {
  request: DeploymentArtifactChallengeRequest;
  principalId: string;
  keyId: string;
  challengeId: string;
  nonce: string;
  finalizedStagedArtifactReference?: string;
}): DeploymentArtifactBindingEnvelope {
  return {
    ...baseArtifactChallengeRequest(opts.request),
    principalId: opts.principalId,
    keyId: opts.keyId,
    providerTargetIdentity: nixosSharedHostDeploymentTargetIdentity(opts.request.deployment),
    challengeId: opts.challengeId,
    nonce: opts.nonce,
    ...(opts.finalizedStagedArtifactReference
      ? { finalizedStagedArtifactReference: opts.finalizedStagedArtifactReference }
      : {}),
  };
}
