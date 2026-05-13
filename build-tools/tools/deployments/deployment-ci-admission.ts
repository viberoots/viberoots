#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { DeploymentTarget } from "./contract";
import type { AdmittedContextLike } from "./deployment-admitted-context";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";

export type DeploymentCiAdmissionEvidence = {
  system: "jenkins" | "ci";
  sourceRevision: string;
  builderIdentity: string;
  artifactIdentity: string;
  artifactRef?: string;
  idempotencyKey?: string;
  sbomRefs?: string[];
  signatureRefs?: string[];
  provenanceRefs?: string[];
};

function text(raw: Record<string, unknown>, key: string): string {
  return typeof raw[key] === "string" ? String(raw[key]).trim() : "";
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
}

export function normalizeCiAdmissionEvidence(
  value: unknown,
): DeploymentCiAdmissionEvidence | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const system = text(raw, "system") === "jenkins" ? "jenkins" : "ci";
  const sourceRevision = text(raw, "sourceRevision");
  const builderIdentity = text(raw, "builderIdentity");
  const artifactIdentity = text(raw, "artifactIdentity");
  if (!sourceRevision || !builderIdentity || !artifactIdentity) return undefined;
  const artifactRef = text(raw, "artifactRef");
  const idempotencyKey = text(raw, "idempotencyKey");
  const sbomRefs = textList(raw.sbomRefs);
  const signatureRefs = textList(raw.signatureRefs);
  const provenanceRefs = textList(raw.provenanceRefs);
  return {
    system,
    sourceRevision,
    builderIdentity,
    artifactIdentity,
    ...(artifactRef ? { artifactRef } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(sbomRefs.length ? { sbomRefs } : {}),
    ...(signatureRefs.length ? { signatureRefs } : {}),
    ...(provenanceRefs.length ? { provenanceRefs } : {}),
  };
}

function assertImmutableArtifactRef(ref: string) {
  if (!ref) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "CI artifact reference must be an immutable digest or retained artifact ref",
    );
  }
  if (ref.startsWith("file://") || path.isAbsolute(ref)) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `CI artifact reference must be retained or immutable, not laptop-local: ${ref}`,
    );
  }
  if (ref.startsWith("sha256:") || ref.includes("@sha256:")) return;
  if (/^(retained-artifact|deployment-artifact|nixos-shared-host):\/\//.test(ref)) return;
  if (/:[^/:@]+$/.test(ref)) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `CI artifact reference must be immutable; mutable image tag is not allowed: ${ref}`,
    );
  }
  throw new DeploymentAdmissionError(
    "no_longer_admitted",
    `CI artifact reference must be an immutable digest or retained artifact ref: ${ref}`,
  );
}

export function assertCiAdmissionEvidence(opts: {
  deployment: DeploymentTarget;
  admittedContext: AdmittedContextLike;
  evidence?: DeploymentCiAdmissionEvidence;
}) {
  if (!opts.evidence) return;
  const expectedSourceRevision = opts.admittedContext.source.sourceRevision;
  if (opts.evidence.sourceRevision !== expectedSourceRevision) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `CI evidence source revision ${opts.evidence.sourceRevision} does not match admitted source revision ${expectedSourceRevision}`,
    );
  }
  const expectedArtifactIdentity = opts.admittedContext.source.artifactIdentity;
  if (expectedArtifactIdentity && opts.evidence.artifactIdentity !== expectedArtifactIdentity) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `CI evidence artifact identity ${opts.evidence.artifactIdentity} does not match admitted artifact identity ${expectedArtifactIdentity}`,
    );
  }
  assertImmutableArtifactRef(opts.evidence.artifactRef || "");
}
