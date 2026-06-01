import type { CredentialMap } from "./cloud-control-credential-map";
import { validateRemoteHostVerifierTrust } from "./control-plane-credential-host-verifier-trust";
import type { LiveHostVerifierTrustAnchor } from "./control-plane-credential-staging-types";

export function validateLiveEvidence(
  evidence: any,
  label: string,
  credentialMap?: CredentialMap,
  trustAnchor?: LiveHostVerifierTrustAnchor,
): string[] {
  const exclusivityErrors = proofWriteExclusivityErrors(evidence, label);
  if (evidence?.mode !== "live-gated-backend-write") return exclusivityErrors;
  const live = evidence.deploymentOwnedLiveBackendWrite;
  const host = evidence.deploymentOwnedLiveHostVerification;
  const errors: string[] = [...exclusivityErrors];
  if (live?.schemaVersion !== "control-plane-credential-live-backend-write@1") {
    errors.push(`${label} live backend write evidence missing`);
  }
  if (live?.liveGate !== "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1") {
    errors.push(`${label} live backend write evidence is not tied to the live gate`);
  }
  if (live?.backend !== "infisical") errors.push(`${label} live backend must be infisical`);
  if (live?.noSecretValuesPersisted !== true) {
    errors.push(`${label} live backend persistence proof missing`);
  }
  if (live?.source !== "deployment-owned-live-write") {
    errors.push(`${label} live backend write evidence must be deployment-owned`);
  }
  if (!Array.isArray(live?.writtenSecrets) || live.writtenSecrets.length === 0) {
    errors.push(`${label} live backend written secret records missing`);
  }
  if (!isEvidenceRef(live?.evidenceRef)) errors.push(`${label} live backend evidence ref missing`);
  if (host?.source !== "deployment-owned-live-host-verification") {
    errors.push(`${label} live host verification evidence missing`);
  }
  errors.push(...validateLiveHostProvenance(host, label, trustAnchor));
  if (credentialMap) errors.push(...validateLiveBackendMapBinding(live, credentialMap, label));
  return errors;
}

export function proofWriteExclusivityErrors(evidence: any, label: string): string[] {
  if (!evidence?.deploymentOwnedLiveBackendWrite) return [];
  const errors: string[] = [];
  if (evidence.externalReviewedBackendProof) {
    errors.push(`${label} mixed external backend proof/live backend write is not allowed`);
  }
  if (evidence.externalReviewedHostProof) {
    errors.push(`${label} mixed external host proof/live backend write is not allowed`);
  }
  return errors;
}

function validateLiveHostProvenance(
  host: any,
  label: string,
  trustAnchor: LiveHostVerifierTrustAnchor | undefined,
): string[] {
  const errors: string[] = [];
  if (!host) return errors;
  if (host.schemaVersion !== "control-plane-live-host-verification@1") {
    errors.push(`${label} live host verification schema is invalid`);
  }
  if (host.verifier !== "local-filesystem" && host.verifier !== "reviewed-remote-verifier") {
    errors.push(`${label} live host verifier is unsupported`);
  }
  if (typeof host.verifierIdentity !== "string" || !host.verifierIdentity.trim()) {
    errors.push(`${label} live host verifier identity is required`);
  }
  if (
    host.verifier === "reviewed-remote-verifier" &&
    host.provenance?.kind !== "reviewed-remote-verifier"
  ) {
    errors.push(`${label} live host reviewed remote verifier provenance is required`);
  }
  if (host.verifier === "reviewed-remote-verifier") {
    errors.push(...validateRemoteHostVerifierTrust(host, label, trustAnchor));
  }
  if (!isEvidenceRef(host.provenance?.evidenceRef) || !host.provenance?.sourceHostIdentity) {
    errors.push(`${label} live host verifier provenance evidence is required`);
  }
  return errors;
}

function validateLiveBackendMapBinding(live: any, map: CredentialMap, label: string): string[] {
  if (!live) return [];
  const errors: string[] = [];
  const plans = map.entries.filter(
    (entry) => (entry.source as any).kind === "generated-secret-write-plan",
  );
  const expectedPlanIds = plans.map((entry) => (entry.source as any).writePlanRef).sort();
  if (
    JSON.stringify(sortedStrings(live.generatedSecretWritePlanIds)) !==
    JSON.stringify(expectedPlanIds)
  ) {
    errors.push(`${label} live backend write-plan ids do not match current map`);
  }
  const records = Array.isArray(live.writtenSecrets) ? live.writtenSecrets : [];
  const written = new Map(
    records.map((record: any) => [`${record?.file}:${record?.writePlanRef}`, record]),
  );
  if (records.length !== plans.length) {
    errors.push(`${label} live backend written secret records include unexpected entries`);
  }
  for (const entry of plans) {
    const source = entry.source as any;
    const selector = source.selector || {};
    if (
      live.projectId !== selector.projectId ||
      live.environment !== selector.environment ||
      live.secretPath !== selector.secretPath
    ) {
      errors.push(`${label} live backend selector does not match current credential map`);
    }
    if (live.deploymentIdentityEvidenceRef !== source.deploymentIdentityEvidenceRef) {
      errors.push(`${label} live backend identity does not match current credential map`);
    }
    if (
      live.leastPrivilegeScopeEvidenceRef !== source.leastPrivilegeScopeEvidenceRef ||
      JSON.stringify(live.leastPrivilegeScope) !== JSON.stringify(source.leastPrivilegeScope)
    ) {
      errors.push(`${label} live backend least-privilege scope does not match current map`);
    }
    const record = written.get(`${entry.file}:${source.writePlanRef}`) as any;
    if (!record || record.secretName !== selector.secretName) {
      errors.push(`${label} live backend written secret records do not match current map`);
    }
  }
  return [...new Set(errors)];
}

function sortedStrings(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.map(String))].sort() : [];
}

function isEvidenceRef(value: unknown): boolean {
  return typeof value === "string" && /^evidence:\/\//.test(value);
}
