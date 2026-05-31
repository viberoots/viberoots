import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";
import {
  CREDENTIAL_MOUNT_TARGET,
  CREDENTIAL_ROTATION_SCHEMA,
  CREDENTIAL_STAGING_SCHEMA,
  type CredentialRotationEvidence,
  type CredentialStagingEvidence,
} from "./control-plane-credential-staging-types";

export function validateCredentialStagingEvidence(
  evidence: CredentialStagingEvidence | undefined,
  expected: {
    manifestDigest?: string;
    credentialMapDigest?: string;
    requiredFiles?: string[];
    maxAgeMinutes: number;
  },
): string[] {
  if (!evidence) return ["credential staging evidence is required"];
  const errors = baseEvidenceErrors(evidence, expected, CREDENTIAL_STAGING_SCHEMA);
  errors.push(...validateDigestBinding(evidence, expected, "credential staging"));
  errors.push(...validateCredentialReferences(evidence, "credential staging"));
  errors.push(...validateNoStale(evidence.staleCredentialDetection, "credential staging"));
  errors.push(...validateReloadEvidence(evidence.reloadEvidence, "credential staging"));
  errors.push(...validateHostMountEvidence(evidence.hostMountEvidence, expected.requiredFiles));
  errors.push(...validateLiveEvidence(evidence, "credential staging"));
  return errors;
}

export function validateCredentialRotationEvidence(
  evidence: CredentialRotationEvidence | undefined,
  expected: {
    manifestDigest?: string;
    credentialMapDigest?: string;
    requiredFiles?: string[];
    maxAgeMinutes: number;
  },
): string[] {
  if (!evidence) return [];
  const errors = baseEvidenceErrors(evidence, expected, CREDENTIAL_ROTATION_SCHEMA);
  errors.push(...validateDigestBinding(evidence, expected, "credential rotation"));
  errors.push(...validateCredentialReferences(evidence, "credential rotation"));
  errors.push(...validateNoStale(evidence.staleCredentialDetection, "credential rotation"));
  errors.push(...validateReloadEvidence(evidence.reloadEvidence, "credential rotation"));
  errors.push(...validateHostMountEvidence(evidence.hostMountEvidence, expected.requiredFiles));
  errors.push(...validateLiveEvidence(evidence, "credential rotation"));
  if (!evidence.nonSecretConfigSemanticsDigest?.startsWith("sha256:")) {
    errors.push("credential rotation non-secret config digest is missing");
  }
  if (
    evidence.rotatedCredentialMapDigest &&
    !evidence.rotatedCredentialMapDigest.startsWith("sha256:")
  ) {
    errors.push("credential rotation rotated map digest is invalid");
  }
  return errors;
}

export function digestCredentialInput(value: unknown): string {
  return fingerprintValue(value);
}

function baseEvidenceErrors(
  evidence: { schemaVersion?: string; generatedAt?: string; ok?: boolean; errors?: string[] },
  expected: { maxAgeMinutes: number },
  schemaVersion: string,
): string[] {
  const errors: string[] = [];
  if (evidence.schemaVersion !== schemaVersion) errors.push(`${schemaVersion} schema invalid`);
  if (evidence.ok !== true) errors.push(`${schemaVersion} did not pass`);
  const generatedAt = Date.parse(evidence.generatedAt || "");
  if (!Number.isFinite(generatedAt)) errors.push(`${schemaVersion} generatedAt is invalid`);
  if (Number.isFinite(generatedAt) && Date.now() - generatedAt > expected.maxAgeMinutes * 60_000) {
    errors.push(`${schemaVersion} evidence is stale`);
  }
  if (Array.isArray(evidence.errors) && evidence.errors.length > 0) {
    errors.push(...evidence.errors.map((error) => `${schemaVersion}: ${error}`));
  }
  return errors;
}

function validateNoStale(entries: unknown, label: string): string[] {
  if (!Array.isArray(entries) || entries.length === 0) return [`${label} stale detection missing`];
  return entries.flatMap((entry: any) =>
    entry?.stale === true ? [`${label} has active stale credential ${entry.file}`] : [],
  );
}

function validateDigestBinding(
  evidence: { manifestDigest?: string; credentialMapDigest?: string },
  expected: { manifestDigest?: string; credentialMapDigest?: string },
  label: string,
): string[] {
  const errors: string[] = [];
  if (!expected.manifestDigest) errors.push(`${label} expected manifest digest is missing`);
  else if (evidence.manifestDigest !== expected.manifestDigest) {
    errors.push(`${label} evidence manifest digest does not match current manifest`);
  }
  if (!expected.credentialMapDigest)
    errors.push(`${label} expected credential map digest is missing`);
  else if (evidence.credentialMapDigest !== expected.credentialMapDigest) {
    errors.push(`${label} evidence map digest does not match current credential map`);
  }
  return errors;
}

function validateCredentialReferences(evidence: any, label: string): string[] {
  const errors: string[] = [];
  if (!Array.isArray(evidence.backendRefs)) errors.push(`${label} backend refs missing`);
  if (!Array.isArray(evidence.generatedSecretWritePlanIds)) {
    errors.push(`${label} write-plan ids missing`);
  }
  if (!Array.isArray(evidence.hostCredentialSourceIds)) {
    errors.push(`${label} host credential source ids missing`);
  }
  return errors;
}

function validateReloadEvidence(evidence: any, label: string): string[] {
  const errors: string[] = [];
  if (
    evidence?.service?.unit !== "deployment-control-plane-service.service" ||
    evidence?.service?.action !== "restart-recorded" ||
    !isEvidenceRef(evidence?.service?.evidenceRef)
  ) {
    errors.push(`${label} service reload evidence missing`);
  }
  if (!Array.isArray(evidence?.workers) || evidence.workers.length === 0) {
    errors.push(`${label} worker reload evidence missing`);
  } else {
    for (const worker of evidence.workers) {
      if (
        !/^deployment-control-plane-worker-\d+\.service$/.test(String(worker?.unit || "")) ||
        worker?.action !== "restart-recorded" ||
        !isEvidenceRef(worker?.evidenceRef)
      ) {
        errors.push(`${label} worker reload evidence is malformed`);
      }
    }
  }
  return errors;
}

function validateHostMountEvidence(evidence: any, requiredFiles: string[] | undefined): string[] {
  const errors: string[] = [];
  if (evidence?.wiringMode !== "bind-mounted-credential-directory") {
    errors.push("credential host mount wiring must be bind-mounted credential directory");
  }
  if (evidence?.targetPath !== CREDENTIAL_MOUNT_TARGET) {
    errors.push(`credential host mount target must be ${CREDENTIAL_MOUNT_TARGET}`);
  }
  if (!Array.isArray(requiredFiles) || requiredFiles.length === 0) {
    errors.push("credential host mount required filename set is missing");
  }
  if (!Array.isArray(evidence?.filenameSet) || evidence.filenameSet.length === 0) {
    errors.push("credential host mount filename set missing");
  } else if (Array.isArray(requiredFiles) && requiredFiles.length > 0) {
    const actual = sortedStrings(evidence.filenameSet);
    const expected = sortedStrings(requiredFiles);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push("credential host mount filename set does not match current manifest");
    }
  }
  if (evidence?.owner?.uid !== 10001 || evidence?.owner?.gid !== 10001) {
    errors.push("credential host mount ownership must be uid/gid 10001");
  }
  if (evidence?.permissions !== "0400") {
    errors.push("credential host mount permissions must be 0400");
  }
  if (
    evidence?.verifiedBy &&
    evidence.verifiedBy !== "fixture-manifest" &&
    evidence.verifiedBy !== "live-host-check"
  ) {
    errors.push("credential host mount verification mode is unsupported");
  }
  if (evidence?.verifiedBy === "live-host-check" && !isEvidenceRef(evidence.evidenceRef)) {
    errors.push("credential host mount live evidence ref missing");
  }
  return errors;
}

function validateLiveEvidence(evidence: any, label: string): string[] {
  if (evidence?.mode !== "live-gated-backend-write") return [];
  const live = evidence.liveBackendWriteEvidence;
  const errors: string[] = [];
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
  if (!isEvidenceRef(live?.evidenceRef)) errors.push(`${label} live backend evidence ref missing`);
  return errors;
}

function sortedStrings(values: unknown[]): string[] {
  return [...new Set(values.map(String))].sort();
}

function isEvidenceRef(value: unknown): boolean {
  return typeof value === "string" && /^evidence:\/\//.test(value);
}
