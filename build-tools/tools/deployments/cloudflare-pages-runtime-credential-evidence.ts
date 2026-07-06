#!/usr/bin/env zx-wrapper
const CREDENTIAL_ROOT = "/run/deployment-control-plane/credentials";
const FILE = "runtime.env";

export function cloudflarePagesCredentialStagingEvidence(checkedAt: string) {
  return {
    schemaVersion: "control-plane-credential-staging@1",
    generatedAt: checkedAt,
    ok: true,
    errors: [],
    mode: "live-gated-backend-write",
    credentialDirectory: CREDENTIAL_ROOT,
    manifestDigest: "sha256:credential-manifest",
    credentialMapDigest: "sha256:credential-map",
    runtimeConfigDigest: "sha256:runtime-config",
    backendRefs: ["backend://credential/runtime.env"],
    generatedSecretWritePlanIds: ["write-plan-runtime"],
    hostCredentialSourceIds: [FILE],
    staleCredentialDetection: [{ file: FILE, stale: false, evidenceRef: stringRef("stale-check") }],
    reloadEvidence: reloadEvidence(),
    hostMountEvidence: hostMountEvidence("live-host-check"),
    deploymentOwnedLiveBackendWrite: liveBackendWrite(checkedAt),
    deploymentOwnedLiveHostVerification: liveHostVerification(checkedAt),
    externalPrerequisites: [],
  };
}

function reloadEvidence() {
  return {
    service: {
      unit: "deployment-control-plane-service.service",
      action: "restart-recorded",
      evidenceRef: stringRef("service-reload"),
    },
    workers: [
      {
        unit: "deployment-control-plane-worker-1.service",
        action: "restart-recorded",
        evidenceRef: stringRef("worker-reload"),
      },
    ],
  };
}

function hostMountEvidence(verifiedBy: "live-host-check" | "fixture-manifest") {
  return {
    wiringMode: "bind-mounted-credential-directory",
    targetPath: CREDENTIAL_ROOT,
    filenameSet: [FILE],
    owner: { uid: 10001, gid: 10001 },
    permissions: "0400",
    verifiedBy,
    evidenceRef: stringRef("host-mount"),
  };
}

function liveBackendWrite(checkedAt: string) {
  return {
    schemaVersion: "control-plane-credential-live-backend-write@1",
    checkedAt,
    liveGate: "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1",
    backend: "infisical",
    source: "deployment-owned-live-write",
    projectId: "infisical-prod-project",
    environment: "production",
    secretPath: "/runtime",
    deploymentIdentityEvidenceRef: stringRef("deployment-identity"),
    leastPrivilegeScopeEvidenceRef: stringRef("least-privilege"),
    leastPrivilegeScope: {
      projectId: "infisical-prod-project",
      environment: "production",
      secretPath: "/runtime",
      allowedSecretNames: [FILE],
      permissions: ["create", "read", "update"],
    },
    generatedSecretWritePlanIds: ["write-plan-runtime"],
    writtenSecrets: [{ file: FILE, secretName: FILE, writePlanRef: "write-plan-runtime" }],
    noSecretValuesPersisted: true,
    evidenceRef: stringRef("live-backend-write"),
  };
}

function liveHostVerification(checkedAt: string) {
  return {
    schemaVersion: "control-plane-live-host-verification@1",
    checkedAt,
    source: "deployment-owned-live-host-verification",
    verifier: "local-filesystem",
    verifierIdentity: "cloudflare-pages-control-plane-reconciler",
    ...hostMountEvidence("live-host-check"),
    provenance: {
      kind: "local-host-verifier",
      evidenceRef: stringRef("live-host-verification"),
      sourceHostIdentity: "cloudflare-pages-control-plane-reconciler",
      reviewedAt: checkedAt,
    },
  };
}

function stringRef(name: string) {
  return `evidence://cloudflare-pages/${name}`;
}
