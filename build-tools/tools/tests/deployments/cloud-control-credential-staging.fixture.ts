import type { CredentialStagingEvidence } from "../../deployments/control-plane-credential-staging-types";

export const CUTOVER_CREDENTIAL_FILES = ["control-plane-token"];

export function credentialStagingEvidence(
  manifestDigest = "sha256:credential-manifest",
  credentialMapDigest = "sha256:credential-map",
): CredentialStagingEvidence {
  return {
    schemaVersion: "control-plane-credential-staging@1",
    generatedAt: new Date().toISOString(),
    mode: "fixture-validation",
    credentialDirectory: "/run/deployment-control-plane/credentials",
    manifestDigest,
    credentialMapDigest,
    runtimeConfigDigest: "sha256:runtime-config",
    backendRefs: ["/deployment-control-plane/control-plane-database-url"],
    generatedSecretWritePlanIds: ["evidence://secret-backend/control-plane-token-name-policy"],
    hostCredentialSourceIds: ["aws-imdsv2-instance-profile"],
    staleCredentialDetection: [
      {
        file: "control-plane-token",
        stale: false,
        evidenceRef: "evidence://credential-rotation/stale-detection/control-plane-token",
      },
    ],
    reloadEvidence: {
      mode: "fixture-reload-evidence",
      service: {
        unit: "deployment-control-plane-service.service",
        action: "restart-recorded",
        evidenceRef: "evidence://credential-staging/reload/service",
      },
      workers: [
        {
          unit: "deployment-control-plane-worker-1.service",
          action: "restart-recorded",
          evidenceRef: "evidence://credential-staging/reload/worker-1",
        },
      ],
    },
    hostMountEvidence: {
      wiringMode: "bind-mounted-credential-directory",
      targetPath: "/run/deployment-control-plane/credentials",
      filenameSet: [...CUTOVER_CREDENTIAL_FILES],
      owner: { uid: 10001, gid: 10001 },
      permissions: "0400",
    },
    externalPrerequisites: [
      "reviewed secret-backend access",
      "reviewed SSH credential provider access",
      "live-gated host mount access",
    ],
    ok: true,
    errors: [],
  };
}
