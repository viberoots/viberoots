import type { CredentialStagingEvidence } from "../../deployments/control-plane-credential-staging-types";
import { digestCredentialInput } from "../../deployments/control-plane-credential-staging-evidence";

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

export function liveCredentialStagingEvidence(
  manifestDigest = "sha256:credential-manifest",
  credentialMapDigest = "sha256:credential-map",
  options: {
    requiredFiles?: string[];
    credentialMap?: { entries?: any[] };
  } = {},
): CredentialStagingEvidence {
  const files = options.requiredFiles || CUTOVER_CREDENTIAL_FILES;
  const generatedPlans = (options.credentialMap?.entries || []).filter(
    (entry: any) => entry?.source?.kind === "generated-secret-write-plan",
  );
  const firstPlan = generatedPlans[0]?.source;
  const selector = firstPlan?.selector || {
    projectId: "project-review",
    environment: "production",
    secretPath: "/deployment-control-plane/generated",
    secretName: "control-plane-token",
  };
  const leastPrivilegeScope = firstPlan?.leastPrivilegeScope || {
    projectId: selector.projectId,
    environment: selector.environment,
    secretPath: selector.secretPath,
    allowedSecretNames: [selector.secretName],
    permissions: ["create", "read", "update"],
  };
  const host = liveHostEvidence(files);
  return {
    ...credentialStagingEvidence(manifestDigest, credentialMapDigest),
    hostMountEvidence: {
      ...credentialStagingEvidence(manifestDigest, credentialMapDigest).hostMountEvidence,
      filenameSet: [...files],
    },
    staleCredentialDetection: files.map((file) => ({
      file,
      stale: false,
      evidenceRef: `evidence://credential-rotation/stale-detection/${file}`,
    })),
    mode: "live-gated-backend-write",
    deploymentOwnedLiveBackendWrite: {
      schemaVersion: "control-plane-credential-live-backend-write@1",
      checkedAt: new Date().toISOString(),
      liveGate: "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1",
      backend: "infisical",
      source: "deployment-owned-live-write",
      projectId: selector.projectId,
      environment: selector.environment,
      secretPath: selector.secretPath,
      deploymentIdentityEvidenceRef:
        firstPlan?.deploymentIdentityEvidenceRef ||
        "evidence://infisical/universal-auth-machine-identity",
      leastPrivilegeScopeEvidenceRef:
        firstPlan?.leastPrivilegeScopeEvidenceRef ||
        "evidence://infisical/least-privilege-secret-paths",
      leastPrivilegeScope,
      generatedSecretWritePlanIds:
        generatedPlans.length > 0
          ? generatedPlans.map((entry: any) => entry.source.writePlanRef)
          : ["evidence://secret-backend/control-plane-token-name-policy"],
      writtenSecrets:
        generatedPlans.length > 0
          ? generatedPlans.map((entry: any) => ({
              file: entry.file,
              secretName: entry.source.selector.secretName,
              writePlanRef: entry.source.writePlanRef,
            }))
          : [
              {
                file: "control-plane-token",
                secretName: "control-plane-token",
                writePlanRef: "evidence://secret-backend/control-plane-token-name-policy",
              },
            ],
      noSecretValuesPersisted: true,
      evidenceRef: "evidence://credential-staging/deployment-owned-live-backend-write",
    },
    deploymentOwnedLiveHostVerification: host,
  };
}

function liveHostEvidence(files = CUTOVER_CREDENTIAL_FILES) {
  const evidence = {
    wiringMode: "bind-mounted-credential-directory" as const,
    targetPath: "/run/deployment-control-plane/credentials" as const,
    filenameSet: [...files],
    owner: { uid: 10001, gid: 10001 },
    permissions: "0400",
    verifiedBy: "live-host-check" as const,
    evidenceRef: "evidence://credential-staging/deployment-owned-live-host-verification",
    schemaVersion: "control-plane-live-host-verification@1" as const,
    checkedAt: new Date().toISOString(),
    source: "deployment-owned-live-host-verification" as const,
    verifier: "reviewed-remote-verifier" as const,
    verifierIdentity: "reviewed-aws-ec2-credential-host-verifier",
    provenance: {
      kind: "reviewed-remote-verifier" as const,
      evidenceRef: "evidence://credential-staging/reviewed-remote-host-verifier",
      sourceHostIdentity: "aws-ec2:i-cloud-review",
      reviewedAt: new Date().toISOString(),
    },
    awsBindMountVerified: true,
  };
  return {
    ...evidence,
    reviewedVerifierProfile: {
      schemaVersion: "control-plane-live-host-verifier-profile@1" as const,
      verifierIdentity: evidence.verifierIdentity,
      sourceHostIdentity: evidence.provenance.sourceHostIdentity,
      evidenceDigest: digestCredentialInput({ ...evidence, reviewedVerifierProfile: undefined }),
      evidenceRef: "evidence://credential-staging/reviewed-remote-host-verifier-profile",
      signature: "sig:reviewed-host-verifier-profile",
    },
  };
}
