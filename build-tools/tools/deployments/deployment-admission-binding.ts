#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import type { DeploymentTarget } from "./contract.ts";
import { providerTargetIdentityFor } from "./contract.ts";
import type { DeploymentAdmissionBinding } from "./deployment-admission-evidence.ts";

export type DeploymentAdmissionOperationKind =
  | "deploy"
  | "promotion"
  | "retry"
  | "rollback"
  | "preview";

type BindingOpts = {
  deployment: DeploymentTarget;
  sourceRevision?: string;
  sourceRunId?: string;
  artifactIdentity?: string;
  artifactLineageId?: string;
  provisionerPlanFingerprint?: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function fingerprintFor(value: unknown): string {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

export function createDeploymentAdmissionBinding(opts: BindingOpts): DeploymentAdmissionBinding {
  const targetIdentity = providerTargetIdentityFor(opts.deployment);
  const payloadFingerprint = fingerprintFor({
    deploymentId: opts.deployment.deploymentId,
    lanePolicyFingerprint: opts.deployment.lanePolicy.fingerprint,
    admissionPolicyFingerprint: opts.deployment.admissionPolicy.fingerprint,
    targetIdentity,
    sourceRevision: opts.sourceRevision || "",
    sourceRunId: opts.sourceRunId || "",
    artifactIdentity: opts.artifactIdentity || "",
    artifactLineageId: opts.artifactLineageId || "",
    provisionerPlanFingerprint: opts.provisionerPlanFingerprint || "",
  });
  return {
    payloadFingerprint,
    targetIdentity,
    ...(opts.sourceRevision ? { sourceRevision: opts.sourceRevision } : {}),
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
    ...(opts.artifactIdentity ? { artifactIdentity: opts.artifactIdentity } : {}),
    ...(opts.artifactLineageId ? { artifactLineageId: opts.artifactLineageId } : {}),
    ...(opts.provisionerPlanFingerprint
      ? { provisionerPlanFingerprint: opts.provisionerPlanFingerprint }
      : {}),
  };
}

export function requiredCheckSubjectsFor(
  operationKind: DeploymentAdmissionOperationKind,
  binding: DeploymentAdmissionBinding,
): string[] {
  const primary =
    operationKind === "deploy"
      ? [binding.sourceRevision]
      : operationKind === "promotion"
        ? [binding.artifactLineageId, binding.artifactIdentity, binding.sourceRunId]
        : operationKind === "preview"
          ? [binding.artifactLineageId, binding.artifactIdentity, binding.sourceRunId]
          : [binding.artifactLineageId, binding.artifactIdentity, binding.sourceRunId];
  return Array.from(
    new Set(
      [...primary, binding.sourceRevision]
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    ),
  );
}
