#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";

export type DeploymentSupplyChainGateTiming = "build_admission" | "publish_admission" | "both";
export type DeploymentSupplyChainGateCategory = "vulnerability" | "license" | "other";
export type DeploymentAttestationTrustBehavior = "fail_closed";

export type DeploymentAttestationPolicy = {
  trustedBuilderIdentities: string[];
  acceptedProvenanceFormats: string[];
  artifactBinding: "source_revision_and_build_inputs";
  expiredBehavior: DeploymentAttestationTrustBehavior;
  revokedBehavior: DeploymentAttestationTrustBehavior;
  trustDriftBehavior: DeploymentAttestationTrustBehavior;
  signatureRequired: boolean;
  trustedSignerIdentities: string[];
};

export type DeploymentSbomPolicy = {
  required: boolean;
  acceptedFormats: string[];
};

export type DeploymentSupplyChainGatePolicy = {
  name: string;
  category: DeploymentSupplyChainGateCategory;
  applyAt: DeploymentSupplyChainGateTiming;
};

export type DeploymentAttestationEvidence = {
  builderIdentity: string;
  provenanceFormat: string;
  artifactIdentity: string;
  sourceRevision: string;
  buildInputsFingerprint: string;
  status: "verified" | "expired" | "revoked" | "untrusted" | "invalid";
  verifiedAt: string;
  recordRef?: string;
  signerIdentities?: string[];
  signatureStatus?: "verified" | "missing" | "untrusted";
};

export type DeploymentSbomEvidence = {
  artifactIdentity: string;
  format: string;
  status: "valid" | "invalid";
  verifiedAt: string;
  recordRef?: string;
};

export type DeploymentSupplyChainGateEvidence = {
  name: string;
  category: DeploymentSupplyChainGateCategory;
  applyAt: DeploymentSupplyChainGateTiming;
  status: "passed" | "failed";
  evaluatedAt: string;
  recordRef?: string;
};

export type DeploymentAttestationFact = Omit<DeploymentAttestationEvidence, "status">;
export type DeploymentSbomFact = Omit<DeploymentSbomEvidence, "status">;
export type DeploymentSupplyChainGateFact = Omit<DeploymentSupplyChainGateEvidence, "status">;

function readStringArray(node: GraphNode, key: string): string[] {
  return Array.isArray(node[key])
    ? node[key].filter((value): value is string => typeof value === "string" && value.trim() !== "")
    : [];
}

function readBoolean(node: GraphNode, key: string): boolean {
  return node[key] === true;
}

function readStringRecordList(node: GraphNode, key: string): Record<string, string>[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>)
          .filter(
            ([entryKey, entryValue]) =>
              typeof entryKey === "string" && typeof entryValue === "string",
          )
          .map(([entryKey, entryValue]) => [entryKey.trim(), String(entryValue).trim()])
          .filter(([entryKey, entryValue]) => entryKey && entryValue),
      );
    })
    .filter((entry): entry is Record<string, string> => !!entry);
}

function normalizeList<T>(value: unknown, map: (entry: unknown) => T | undefined): T[] {
  return Array.isArray(value) ? value.map(map).filter((entry): entry is T => !!entry) : [];
}

export function readAttestationPolicy(node: GraphNode): DeploymentAttestationPolicy | undefined {
  const trustedBuilderIdentities = readStringArray(node, "trusted_builder_identities");
  const acceptedProvenanceFormats = readStringArray(node, "accepted_provenance_formats");
  const trustedSignerIdentities = readStringArray(node, "trusted_signer_identities");
  const artifactBinding = String(node.artifact_binding || "").trim();
  const expiredBehavior = String(node.expired_attestation_behavior || "").trim();
  const revokedBehavior = String(node.revoked_attestation_behavior || "").trim();
  const trustDriftBehavior = String(node.attestation_trust_drift_behavior || "").trim();
  const signatureRequired = readBoolean(node, "require_artifact_signatures");
  const enabled =
    trustedBuilderIdentities.length > 0 ||
    acceptedProvenanceFormats.length > 0 ||
    trustedSignerIdentities.length > 0 ||
    signatureRequired ||
    !!artifactBinding ||
    !!expiredBehavior ||
    !!revokedBehavior ||
    !!trustDriftBehavior;
  if (!enabled) return undefined;
  return {
    trustedBuilderIdentities,
    acceptedProvenanceFormats,
    artifactBinding: (artifactBinding ||
      "source_revision_and_build_inputs") as DeploymentAttestationPolicy["artifactBinding"],
    expiredBehavior: (expiredBehavior || "fail_closed") as DeploymentAttestationTrustBehavior,
    revokedBehavior: (revokedBehavior || "fail_closed") as DeploymentAttestationTrustBehavior,
    trustDriftBehavior: (trustDriftBehavior || "fail_closed") as DeploymentAttestationTrustBehavior,
    signatureRequired,
    trustedSignerIdentities,
  };
}

export function readSbomPolicy(node: GraphNode): DeploymentSbomPolicy | undefined {
  const required = readBoolean(node, "sbom_required");
  const acceptedFormats = readStringArray(node, "accepted_sbom_formats");
  if (!required && acceptedFormats.length === 0) return undefined;
  return { required, acceptedFormats };
}

export function readSupplyChainGatePolicies(node: GraphNode): DeploymentSupplyChainGatePolicy[] {
  return readStringRecordList(node, "supply_chain_gates")
    .map((entry) => {
      const name = entry.name || "";
      const category = (entry.category || "") as DeploymentSupplyChainGateCategory;
      const applyAt = (entry.apply_at || "") as DeploymentSupplyChainGateTiming;
      if (!name || !category || !applyAt) return undefined;
      return { name, category, applyAt };
    })
    .filter((entry): entry is DeploymentSupplyChainGatePolicy => !!entry);
}

export function normalizeAttestationEvidence(value: unknown): DeploymentAttestationEvidence[] {
  return normalizeList(value, (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const builderIdentity =
      typeof entry.builderIdentity === "string" ? entry.builderIdentity.trim() : "";
    const provenanceFormat =
      typeof entry.provenanceFormat === "string" ? entry.provenanceFormat.trim() : "";
    const artifactIdentity =
      typeof entry.artifactIdentity === "string" ? entry.artifactIdentity.trim() : "";
    const sourceRevision =
      typeof entry.sourceRevision === "string" ? entry.sourceRevision.trim() : "";
    const buildInputsFingerprint =
      typeof entry.buildInputsFingerprint === "string" ? entry.buildInputsFingerprint.trim() : "";
    const status =
      entry.status === "verified" ||
      entry.status === "expired" ||
      entry.status === "revoked" ||
      entry.status === "untrusted" ||
      entry.status === "invalid"
        ? entry.status
        : "";
    const verifiedAt = typeof entry.verifiedAt === "string" ? entry.verifiedAt.trim() : "";
    if (
      !builderIdentity ||
      !provenanceFormat ||
      !artifactIdentity ||
      !sourceRevision ||
      !buildInputsFingerprint ||
      !status ||
      !verifiedAt
    ) {
      return undefined;
    }
    const signerIdentities = Array.isArray(entry.signerIdentities)
      ? entry.signerIdentities.filter(
          (identity): identity is string => typeof identity === "string" && identity.trim() !== "",
        )
      : [];
    const signatureStatus =
      entry.signatureStatus === "verified" ||
      entry.signatureStatus === "missing" ||
      entry.signatureStatus === "untrusted"
        ? entry.signatureStatus
        : undefined;
    const recordRef = typeof entry.recordRef === "string" ? entry.recordRef.trim() : "";
    return {
      builderIdentity,
      provenanceFormat,
      artifactIdentity,
      sourceRevision,
      buildInputsFingerprint,
      status,
      verifiedAt,
      ...(recordRef ? { recordRef } : {}),
      ...(signerIdentities.length > 0 ? { signerIdentities } : {}),
      ...(signatureStatus ? { signatureStatus } : {}),
    };
  });
}

export function normalizeSbomEvidence(value: unknown): DeploymentSbomEvidence[] {
  return normalizeList(value, (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const artifactIdentity =
      typeof entry.artifactIdentity === "string" ? entry.artifactIdentity.trim() : "";
    const format = typeof entry.format === "string" ? entry.format.trim() : "";
    const status = entry.status === "valid" || entry.status === "invalid" ? entry.status : "";
    const verifiedAt = typeof entry.verifiedAt === "string" ? entry.verifiedAt.trim() : "";
    if (!artifactIdentity || !format || !status || !verifiedAt) return undefined;
    const recordRef = typeof entry.recordRef === "string" ? entry.recordRef.trim() : "";
    return { artifactIdentity, format, status, verifiedAt, ...(recordRef ? { recordRef } : {}) };
  });
}

export function normalizeSupplyChainGateEvidence(
  value: unknown,
): DeploymentSupplyChainGateEvidence[] {
  return normalizeList(value, (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const category =
      entry.category === "vulnerability" ||
      entry.category === "license" ||
      entry.category === "other"
        ? entry.category
        : "";
    const applyAt =
      entry.applyAt === "build_admission" ||
      entry.applyAt === "publish_admission" ||
      entry.applyAt === "both"
        ? entry.applyAt
        : "";
    const status = entry.status === "passed" || entry.status === "failed" ? entry.status : "";
    const evaluatedAt = typeof entry.evaluatedAt === "string" ? entry.evaluatedAt.trim() : "";
    if (!name || !category || !applyAt || !status || !evaluatedAt) return undefined;
    const recordRef = typeof entry.recordRef === "string" ? entry.recordRef.trim() : "";
    return { name, category, applyAt, status, evaluatedAt, ...(recordRef ? { recordRef } : {}) };
  });
}
