export const CREDENTIAL_STAGING_SCHEMA = "control-plane-credential-staging@1";
export const CREDENTIAL_ROTATION_SCHEMA = "control-plane-credential-rotation@1";
export const CREDENTIAL_MOUNT_TARGET = "/run/deployment-control-plane/credentials";

export type CredentialStagingEvidence = {
  schemaVersion: typeof CREDENTIAL_STAGING_SCHEMA;
  generatedAt: string;
  mode: "fixture-validation" | "live-gated-backend-write";
  credentialDirectory: string;
  manifestDigest: string;
  credentialMapDigest: string;
  runtimeConfigDigest: string;
  backendRefs: string[];
  generatedSecretWritePlanIds: string[];
  hostCredentialSourceIds: string[];
  staleCredentialDetection: {
    file: string;
    stale: boolean;
    evidenceRef: string;
  }[];
  reloadEvidence: ReloadEvidence;
  hostMountEvidence: HostMountEvidence;
  externalReviewedBackendProof?: ExternalReviewedBackendProof;
  externalReviewedHostProof?: ExternalReviewedHostProof;
  deploymentOwnedLiveBackendWrite?: LiveBackendWriteEvidence;
  deploymentOwnedLiveHostVerification?: LiveHostVerificationEvidence;
  externalPrerequisites: string[];
  ok: boolean;
  errors: string[];
};

export type CredentialRotationEvidence = {
  schemaVersion: typeof CREDENTIAL_ROTATION_SCHEMA;
  generatedAt: string;
  mode: "fixture-validation" | "live-gated-backend-write";
  manifestDigest: string;
  credentialMapDigest: string;
  runtimeConfigDigest: string;
  backendRefs: string[];
  generatedSecretWritePlanIds: string[];
  hostCredentialSourceIds: string[];
  staleCredentialDetection: CredentialStagingEvidence["staleCredentialDetection"];
  nonSecretConfigSemanticsDigest: string;
  rotatedCredentialMapDigest?: string;
  rotatedCredentialMapPath?: string;
  reloadEvidence: ReloadEvidence;
  hostMountEvidence: HostMountEvidence;
  externalReviewedBackendProof?: ExternalReviewedBackendProof;
  externalReviewedHostProof?: ExternalReviewedHostProof;
  deploymentOwnedLiveBackendWrite?: LiveBackendWriteEvidence;
  deploymentOwnedLiveHostVerification?: LiveHostVerificationEvidence;
  ok: boolean;
  errors: string[];
};

export type ReloadEvidence = {
  mode: "fixture-reload-evidence";
  service: { unit: string; action: "restart-recorded"; evidenceRef: string };
  workers: { unit: string; action: "restart-recorded"; evidenceRef: string }[];
};

export type HostMountEvidence = {
  wiringMode: "bind-mounted-credential-directory";
  targetPath: typeof CREDENTIAL_MOUNT_TARGET;
  filenameSet: string[];
  owner: { uid: number; gid: number };
  permissions: string;
  verifiedBy?: "fixture-manifest" | "live-host-check";
  evidenceRef?: string;
};

export type InfisicalLeastPrivilegeScope = {
  projectId: string;
  environment: string;
  secretPath: string;
  allowedSecretNames: string[];
  permissions: ("create" | "read" | "update")[];
};

export type LiveBackendWriteEvidence = {
  schemaVersion: "control-plane-credential-live-backend-write@1";
  checkedAt: string;
  liveGate: "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1";
  backend: "infisical";
  source: "deployment-owned-live-write";
  projectId: string;
  environment: string;
  secretPath: string;
  deploymentIdentityEvidenceRef: string;
  leastPrivilegeScopeEvidenceRef: string;
  leastPrivilegeScope: InfisicalLeastPrivilegeScope;
  generatedSecretWritePlanIds: string[];
  writtenSecrets: { file: string; secretName: string; writePlanRef: string; version?: string }[];
  noSecretValuesPersisted: true;
  evidenceRef: string;
};

export type LiveHostVerificationEvidence = HostMountEvidence & {
  schemaVersion: "control-plane-live-host-verification@1";
  checkedAt: string;
  source: "deployment-owned-live-host-verification";
  verifier: "local-filesystem" | "reviewed-remote-verifier";
  verifierIdentity: string;
  provenance: {
    kind: "local-host-verifier" | "reviewed-remote-verifier";
    evidenceRef: string;
    sourceHostIdentity: string;
    reviewedAt: string;
  };
  awsBindMountVerified?: boolean;
  reviewedVerifierProfile?: LiveHostVerifierProfile;
};

export type LiveHostVerifierProfile = {
  schemaVersion: "control-plane-live-host-verifier-profile@1";
  verifierIdentity: string;
  sourceHostIdentity: string;
  targetPath: typeof CREDENTIAL_MOUNT_TARGET;
  filenameSet: string[];
  awsBindMountVerified: true;
  evidenceDigest: string;
  evidenceRef: string;
  reviewedAt: string;
  expiresAt?: string;
  publicKeyFingerprint?: string;
  signature?: string;
  commandAttestation?: {
    kind: "deployment-owned-verifier-command";
    command: "deployment-control-plane credential-host-verifier";
    commandDigest: string;
    evidenceDigest: string;
    producedBy: string;
    evidenceRef: string;
    reviewedAt: string;
    expiresAt?: string;
  };
  reviewedTrustAnchor?: LiveHostVerifierTrustAnchor;
  publicKey?: {
    kind: "ed25519";
    pem: string;
    fingerprint: string;
  };
};

export type LiveHostVerifierTrustAnchor = {
  schemaVersion: "control-plane-live-host-verifier-trust@1";
  verifierIdentity: string;
  trustedPublicKeys?: {
    kind: "ed25519";
    pem: string;
    fingerprint: string;
  }[];
  trustedCommandDigests?: string[];
  evidenceRef: string;
  reviewedAt: string;
  expiresAt?: string;
};

export type ExternalReviewedBackendProof = {
  source: "external-reviewed-proof";
  evidence: unknown;
};

export type ExternalReviewedHostProof = {
  source: "external-reviewed-proof";
  evidence: unknown;
};
