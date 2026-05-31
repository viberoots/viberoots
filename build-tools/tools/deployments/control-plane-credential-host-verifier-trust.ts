import crypto from "node:crypto";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";
import {
  CREDENTIAL_MOUNT_TARGET,
  type LiveHostVerificationEvidence,
  type LiveHostVerifierProfile,
  type LiveHostVerifierTrustAnchor,
} from "./control-plane-credential-staging-types";

export function validateRemoteHostVerifierTrust(
  host: LiveHostVerificationEvidence,
  label: string,
  trustAnchor?: LiveHostVerifierTrustAnchor,
): string[] {
  const profile = host.reviewedVerifierProfile;
  const errors = validateProfileBinding(host, profile, label);
  if (!profile) return errors;
  const digest = remoteHostEvidenceDigest(host);
  if (profile.evidenceDigest !== digest) {
    errors.push(`${label} live host reviewed verifier profile digest does not match evidence`);
  }
  if (isStale(profile.reviewedAt, profile.expiresAt)) {
    errors.push(`${label} live host reviewed verifier provenance is stale`);
  }
  const anchorErrors = validateTrustAnchor(profile, trustAnchor, label);
  const signed = validatePublicKeySignature(profile, digest, label, trustAnchor);
  const attested = validateCommandAttestation(profile, digest, label, trustAnchor);
  if (!profile.signature && !profile.commandAttestation) {
    errors.push(
      `${label} live host reviewed verifier signature or command attestation is required`,
    );
  }
  return [...errors, ...anchorErrors, ...signed, ...attested];
}

export function remoteHostEvidenceDigest(host: LiveHostVerificationEvidence): string {
  return fingerprintValue({ ...host, reviewedVerifierProfile: undefined });
}

function validateProfileBinding(
  host: LiveHostVerificationEvidence,
  profile: LiveHostVerifierProfile | undefined,
  label: string,
): string[] {
  if (profile?.schemaVersion !== "control-plane-live-host-verifier-profile@1") {
    return [`${label} live host reviewed verifier profile is required`];
  }
  const errors: string[] = [];
  if (profile.verifierIdentity !== host.verifierIdentity) {
    errors.push(`${label} live host reviewed verifier identity does not match evidence`);
  }
  if (profile.sourceHostIdentity !== host.provenance?.sourceHostIdentity) {
    errors.push(`${label} live host reviewed verifier source host does not match evidence`);
  }
  if (profile.targetPath !== host.targetPath || profile.targetPath !== CREDENTIAL_MOUNT_TARGET) {
    errors.push(`${label} live host reviewed verifier target path does not match evidence`);
  }
  if (JSON.stringify(sorted(profile.filenameSet)) !== JSON.stringify(sorted(host.filenameSet))) {
    errors.push(`${label} live host reviewed verifier filename set does not match evidence`);
  }
  if (profile.awsBindMountVerified !== true || host.awsBindMountVerified !== true) {
    errors.push(`${label} live host reviewed verifier AWS bind mount proof is required`);
  }
  if (!isEvidenceRef(profile.evidenceRef)) {
    errors.push(`${label} live host reviewed verifier evidence ref is required`);
  }
  return errors;
}

function validatePublicKeySignature(
  profile: LiveHostVerifierProfile,
  digest: string,
  label: string,
  trustAnchor: LiveHostVerifierTrustAnchor | undefined,
): string[] {
  if (!profile.signature) return [];
  const errors: string[] = [];
  const key = trustedPublicKey(profile, trustAnchor);
  if (!key) {
    errors.push(`${label} live host reviewed verifier public key trust anchor is required`);
    return errors;
  }
  try {
    const ok = crypto.verify(
      null,
      Buffer.from(digest),
      key.pem,
      Buffer.from(profile.signature, "base64url"),
    );
    if (!ok) errors.push(`${label} live host reviewed verifier signature verification failed`);
  } catch {
    errors.push(`${label} live host reviewed verifier signature verification failed`);
  }
  return errors;
}

function validateCommandAttestation(
  profile: LiveHostVerifierProfile,
  digest: string,
  label: string,
  trustAnchor: LiveHostVerifierTrustAnchor | undefined,
): string[] {
  const attestation = profile.commandAttestation;
  if (!attestation) return [];
  const errors: string[] = [];
  const trustedDigests = trustAnchor?.trustedCommandDigests || [];
  if (!trustedDigests.includes(attestation.commandDigest)) {
    errors.push(`${label} live host verifier command trust anchor is required`);
  }
  if (attestation.kind !== "deployment-owned-verifier-command") {
    errors.push(`${label} live host verifier command attestation kind is invalid`);
  }
  if (attestation.command !== "deployment-control-plane credential-host-verifier") {
    errors.push(`${label} live host verifier command provenance is invalid`);
  }
  if (!attestation.commandDigest?.startsWith("sha256:") || !attestation.producedBy?.trim()) {
    errors.push(`${label} live host verifier command provenance is incomplete`);
  }
  if (attestation.evidenceDigest !== digest) {
    errors.push(`${label} live host verifier command attestation digest does not match evidence`);
  }
  if (!isEvidenceRef(attestation.evidenceRef)) {
    errors.push(`${label} live host verifier command attestation evidence ref is required`);
  }
  if (isStale(attestation.reviewedAt, attestation.expiresAt)) {
    errors.push(`${label} live host verifier command attestation is stale`);
  }
  return errors;
}

function validateTrustAnchor(
  profile: LiveHostVerifierProfile,
  anchor: LiveHostVerifierTrustAnchor | undefined,
  label: string,
): string[] {
  if (anchor?.schemaVersion !== "control-plane-live-host-verifier-trust@1") {
    return [`${label} live host reviewed verifier trust anchor is required`];
  }
  const errors: string[] = [];
  if (anchor.verifierIdentity !== profile.verifierIdentity) {
    errors.push(`${label} live host reviewed verifier trust anchor identity does not match`);
  }
  if (!isEvidenceRef(anchor.evidenceRef)) {
    errors.push(`${label} live host reviewed verifier trust anchor evidence ref is required`);
  }
  if (isStale(anchor.reviewedAt, anchor.expiresAt)) {
    errors.push(`${label} live host reviewed verifier trust anchor is stale`);
  }
  for (const key of anchor.trustedPublicKeys || []) {
    if (key.kind !== "ed25519") {
      errors.push(`${label} live host reviewed verifier public key kind is unsupported`);
    }
    if (key.fingerprint !== fingerprintPublicKey(key.pem)) {
      errors.push(`${label} live host reviewed verifier public key fingerprint is invalid`);
    }
  }
  return errors;
}

function trustedPublicKey(
  profile: LiveHostVerifierProfile,
  trustAnchor: LiveHostVerifierTrustAnchor | undefined,
): { pem: string } | undefined {
  const keys = trustAnchor?.trustedPublicKeys || [];
  return keys.find((key) => key.fingerprint === profile.publicKeyFingerprint);
}

function isStale(reviewedAt: unknown, expiresAt: unknown): boolean {
  const reviewed = Date.parse(String(reviewedAt || ""));
  if (!Number.isFinite(reviewed)) return true;
  const expires = expiresAt ? Date.parse(String(expiresAt)) : reviewed + 24 * 60 * 60_000;
  return !Number.isFinite(expires) || Date.now() > expires;
}

function sorted(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.map(String))].sort() : [];
}

function isEvidenceRef(value: unknown): boolean {
  return typeof value === "string" && /^evidence:\/\//.test(value);
}

function fingerprintPublicKey(pem: string): string {
  return `sha256:${crypto.createHash("sha256").update(pem).digest("hex")}`;
}
