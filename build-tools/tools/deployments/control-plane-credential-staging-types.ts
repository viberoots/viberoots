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
  liveBackendWriteEvidence?: LiveBackendWriteEvidence;
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
  liveBackendWriteEvidence?: LiveBackendWriteEvidence;
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

export type LiveBackendWriteEvidence = {
  schemaVersion: "control-plane-credential-live-backend-write@1";
  checkedAt: string;
  liveGate: "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1";
  backend: "infisical";
  generatedSecretWritePlanIds: string[];
  backendRefs: string[];
  hostCredentialSourceIds: string[];
  noSecretValuesPersisted: true;
  evidenceRef: string;
};
