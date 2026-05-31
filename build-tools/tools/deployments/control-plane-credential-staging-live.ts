import { getFlagBool } from "../lib/cli";
import type { CredentialMap } from "./cloud-control-credential-map";
import { digestCredentialInput } from "./control-plane-credential-staging-evidence";
import { CREDENTIAL_MOUNT_TARGET } from "./control-plane-credential-staging-types";
import type {
  LiveBackendWriteEvidence,
  LiveHostVerificationEvidence,
} from "./control-plane-credential-staging-types";

export type LiveHostMountInput = {
  evidenceRef?: string;
  filenameSet?: string[];
  owner?: { uid?: number; gid?: number };
  permissions?: string;
  targetPath?: string;
};

export function liveRequested(): boolean {
  return getFlagBool("live");
}

export function validateLiveInputs(opts: {
  live: boolean;
  backendEvidence?: LiveBackendWriteEvidence;
  hostMountEvidence?: LiveHostMountInput | LiveHostVerificationEvidence;
  credentialMap: CredentialMap;
  requiredFiles: string[];
  backendRefs: string[];
  writePlanIds: string[];
  hostSourceIds: string[];
}): string[] {
  if (!opts.live && process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING === "1") {
    return ["live credential staging requires explicit --live"];
  }
  if (!opts.live) return [];
  const errors: string[] = [];
  if (process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING !== "1") {
    errors.push("live credential staging requires VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1");
  }
  errors.push(...validateLiveBackendWriteEvidence(opts));
  errors.push(...validateLiveHostMountInput(opts.hostMountEvidence, opts.requiredFiles));
  return errors;
}

export function hostMountEvidence(
  observed: LiveHostMountInput | undefined,
  requiredFiles: string[],
  live: boolean,
) {
  return {
    wiringMode: "bind-mounted-credential-directory" as const,
    targetPath: (observed?.targetPath as typeof CREDENTIAL_MOUNT_TARGET) || CREDENTIAL_MOUNT_TARGET,
    filenameSet: observed?.filenameSet || requiredFiles,
    owner: {
      uid: Number(observed?.owner?.uid ?? 10001),
      gid: Number(observed?.owner?.gid ?? 10001),
    },
    permissions: observed?.permissions || "0400",
    verifiedBy: live ? ("live-host-check" as const) : ("fixture-manifest" as const),
    ...(observed?.evidenceRef ? { evidenceRef: observed.evidenceRef } : {}),
  };
}

function validateLiveBackendWriteEvidence(opts: {
  backendEvidence?: LiveBackendWriteEvidence;
  credentialMap: CredentialMap;
  writePlanIds: string[];
}): string[] {
  const evidence = opts.backendEvidence;
  if (!evidence) return ["live credential staging requires deployment-owned backend write"];
  const errors: string[] = [];
  if (evidence.schemaVersion !== "control-plane-credential-live-backend-write@1") {
    errors.push("live credential backend write evidence schema invalid");
  }
  if (evidence.liveGate !== "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1") {
    errors.push("live credential backend write evidence is not tied to the live gate");
  }
  if (evidence.backend !== "infisical") errors.push("live credential backend must be infisical");
  if (evidence.source !== "deployment-owned-live-write") {
    errors.push("live credential backend evidence must be deployment-owned");
  }
  if (evidence.noSecretValuesPersisted !== true) {
    errors.push("live credential backend evidence must prove no local secret persistence");
  }
  if (!isEvidenceRef(evidence.evidenceRef)) errors.push("live backend evidence ref is required");
  compareSets(
    errors,
    "generated secret write plans",
    evidence.generatedSecretWritePlanIds,
    opts.writePlanIds,
  );
  errors.push(...validateLiveBackendScope(evidence, opts.credentialMap));
  return errors;
}

function validateLiveBackendScope(
  evidence: LiveBackendWriteEvidence,
  map: CredentialMap,
): string[] {
  const errors: string[] = [];
  const plans = map.entries.filter(
    (entry) => (entry.source as any).kind === "generated-secret-write-plan",
  );
  const selectors = plans.map((entry) => (entry.source as any).selector);
  const scopes = plans.map((entry) => (entry.source as any).leastPrivilegeScope);
  if (
    !selectors.every(
      (selector) =>
        selector.projectId === evidence.projectId &&
        selector.environment === evidence.environment &&
        selector.secretPath === evidence.secretPath,
    )
  ) {
    errors.push("live credential backend selector does not match current credential map");
  }
  if (
    !plans.every(
      (entry) =>
        (entry.source as any).deploymentIdentityEvidenceRef ===
        evidence.deploymentIdentityEvidenceRef,
    )
  ) {
    errors.push("live credential backend identity does not match current credential map");
  }
  if (
    !plans.every(
      (entry) =>
        (entry.source as any).leastPrivilegeScopeEvidenceRef ===
        evidence.leastPrivilegeScopeEvidenceRef,
    ) ||
    !scopes.every((scope) => JSON.stringify(scope) === JSON.stringify(evidence.leastPrivilegeScope))
  ) {
    errors.push("live credential backend least-privilege scope does not match current map");
  }
  return errors;
}

function validateLiveHostMountInput(
  evidence: LiveHostMountInput | undefined,
  expected: string[],
): string[] {
  if (!evidence) return ["live credential staging requires deployment-owned host verification"];
  const errors: string[] = [];
  if (
    (evidence as LiveHostVerificationEvidence).source !== "deployment-owned-live-host-verification"
  ) {
    errors.push("live host mount evidence must be deployment-owned");
  }
  errors.push(...validateHostVerifierProvenance(evidence as LiveHostVerificationEvidence));
  if (evidence.targetPath !== CREDENTIAL_MOUNT_TARGET) {
    errors.push(`live host mount target must be ${CREDENTIAL_MOUNT_TARGET}`);
  }
  if (JSON.stringify(sortedStrings(evidence.filenameSet || [])) !== JSON.stringify(expected)) {
    errors.push("live host mount filename set does not match current manifest");
  }
  if (evidence.owner?.uid !== 10001 || evidence.owner?.gid !== 10001) {
    errors.push("live host mount ownership must be uid/gid 10001");
  }
  if (evidence.permissions !== "0400") errors.push("live host mount permissions must be 0400");
  if (!isEvidenceRef(evidence.evidenceRef)) errors.push("live host mount evidence ref is required");
  if ((evidence as LiveHostVerificationEvidence).awsBindMountVerified !== true) {
    errors.push("live host AWS bind-mounted directory wiring is stale");
  }
  return errors;
}

function validateHostVerifierProvenance(evidence: LiveHostVerificationEvidence): string[] {
  const errors: string[] = [];
  if (evidence.schemaVersion !== "control-plane-live-host-verification@1") {
    errors.push("live host verification schema is invalid");
  }
  if (
    evidence.verifier !== "local-filesystem" &&
    evidence.verifier !== "reviewed-remote-verifier"
  ) {
    errors.push("live host verifier identity is unsupported");
  }
  if (typeof evidence.verifierIdentity !== "string" || !evidence.verifierIdentity.trim()) {
    errors.push("live host verifier identity is required");
  }
  const provenance = evidence.provenance;
  if (
    evidence.verifier === "reviewed-remote-verifier" &&
    provenance?.kind !== "reviewed-remote-verifier"
  ) {
    errors.push("live host remote verifier reviewed provenance is required");
  }
  if (evidence.verifier === "reviewed-remote-verifier") {
    errors.push(...validateReviewedVerifierProfile(evidence));
  }
  if (evidence.verifier === "local-filesystem" && provenance?.kind !== "local-host-verifier") {
    errors.push("live host local verifier provenance is required");
  }
  if (!isEvidenceRef(provenance?.evidenceRef) || !provenance?.sourceHostIdentity) {
    errors.push("live host verifier provenance evidence is required");
  }
  if (!Number.isFinite(Date.parse(String(provenance?.reviewedAt || "")))) {
    errors.push("live host verifier provenance reviewedAt is invalid");
  }
  return errors;
}

function validateReviewedVerifierProfile(evidence: LiveHostVerificationEvidence): string[] {
  const profile = evidence.reviewedVerifierProfile;
  const errors: string[] = [];
  if (profile?.schemaVersion !== "control-plane-live-host-verifier-profile@1") {
    return ["live host reviewed verifier profile is required"];
  }
  if (profile.verifierIdentity !== evidence.verifierIdentity) {
    errors.push("live host reviewed verifier identity does not match evidence");
  }
  if (profile.sourceHostIdentity !== evidence.provenance?.sourceHostIdentity) {
    errors.push("live host reviewed verifier source host does not match evidence");
  }
  if (!isEvidenceRef(profile.evidenceRef) || !profile.signature?.startsWith("sig:")) {
    errors.push("live host reviewed verifier signature is required");
  }
  const digest = digestCredentialInput({ ...evidence, reviewedVerifierProfile: undefined });
  if (profile.evidenceDigest !== digest) {
    errors.push("live host reviewed verifier profile digest does not match evidence");
  }
  return errors;
}

function compareSets(errors: string[], label: string, actual: unknown, expected: string[]): void {
  if (JSON.stringify(sortedStrings(actual)) !== JSON.stringify(sortedStrings(expected))) {
    errors.push(`live credential backend ${label} do not match current credential map`);
  }
}

function sortedStrings(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.map(String))].sort() : [];
}

function isEvidenceRef(value: unknown): boolean {
  return typeof value === "string" && /^evidence:\/\//.test(value);
}
