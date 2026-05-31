import assert from "node:assert/strict";
import { test } from "node:test";
import { credentialMap } from "../../deployments/cloud-control-credential-map";
import { validateCredentialStagingEvidence } from "../../deployments/control-plane-credential-staging-evidence";
import {
  input as setupInput,
  liveHostVerifierProfile,
} from "./control-plane-credential-live.fixture";

test("persisted staging evidence rejects live backend drift from current map", () => {
  const map = credentialMap(setupInput(), ["control-plane-token"]);
  const source = map.entries[0]!.source as any;
  const evidence = stagingEvidence(source, {
    generatedSecretWritePlanIds: [source.writePlanRef, "evidence://extra-plan"],
    projectId: "wrong-project",
    leastPrivilegeScope: { ...source.leastPrivilegeScope, environment: "other" },
    writtenSecrets: [
      {
        file: "control-plane-token",
        secretName: source.secretName,
        writePlanRef: source.writePlanRef,
      },
      { file: "extra", secretName: "extra", writePlanRef: "evidence://extra-plan" },
    ],
  });
  const errors = validateCredentialStagingEvidence(evidence as any, expectation(map)).join("\n");
  assert.match(errors, /selector/);
  assert.match(errors, /least-privilege scope/);
  assert.match(errors, /write-plan ids/);
  assert.match(errors, /written secret records/);
});

test("persisted staging evidence rejects remote host proof without reviewed provenance", () => {
  const map = credentialMap(setupInput(), ["control-plane-token"]);
  const source = map.entries[0]!.source as any;
  const evidence = stagingEvidence(source);
  delete (evidence.deploymentOwnedLiveHostVerification as any).provenance;
  assert.match(
    validateCredentialStagingEvidence(evidence as any, expectation(map)).join("\n"),
    /provenance/,
  );
});

test("cutover live requirement rejects fixture credential staging", () => {
  const map = credentialMap(setupInput(), ["control-plane-token"]);
  const fixture = {
    ...stagingEvidence(map.entries[0]!.source as any),
    mode: "fixture-validation",
    deploymentOwnedLiveBackendWrite: undefined,
    deploymentOwnedLiveHostVerification: undefined,
  };
  assert.match(
    validateCredentialStagingEvidence(fixture as any, {
      ...expectation(map),
      requireLive: true,
    }).join("\n"),
    /deployment-owned live evidence/,
  );
});

test("persisted fixture staging rejects mixed external proof and live write evidence", () => {
  const map = credentialMap(setupInput(), ["control-plane-token"]);
  const fixture = {
    ...stagingEvidence(map.entries[0]!.source as any),
    mode: "fixture-validation",
    externalReviewedBackendProof: {
      source: "external-reviewed-proof",
      evidence: { reviewed: true },
    },
  };
  assert.match(
    validateCredentialStagingEvidence(fixture as any, expectation(map)).join("\n"),
    /external proof cannot masquerade as live backend write evidence/,
  );
});

function expectation(map: ReturnType<typeof credentialMap>) {
  return {
    manifestDigest: "sha256:manifest",
    credentialMapDigest: "sha256:map",
    requiredFiles: ["control-plane-token"],
    credentialMap: map,
    maxAgeMinutes: 60,
  };
}

function stagingEvidence(source: any, liveOverrides: Record<string, unknown> = {}) {
  const live = {
    schemaVersion: "control-plane-credential-live-backend-write@1" as const,
    checkedAt: new Date().toISOString(),
    liveGate: "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1" as const,
    backend: "infisical" as const,
    source: "deployment-owned-live-write" as const,
    projectId: source.selector.projectId,
    environment: source.selector.environment,
    secretPath: source.selector.secretPath,
    deploymentIdentityEvidenceRef: source.deploymentIdentityEvidenceRef,
    leastPrivilegeScopeEvidenceRef: source.leastPrivilegeScopeEvidenceRef,
    leastPrivilegeScope: source.leastPrivilegeScope,
    generatedSecretWritePlanIds: [source.writePlanRef],
    writtenSecrets: [
      {
        file: "control-plane-token",
        secretName: source.secretName,
        writePlanRef: source.writePlanRef,
      },
    ],
    noSecretValuesPersisted: true as const,
    evidenceRef: "evidence://credential-staging/deployment-owned-live-backend-write",
    ...liveOverrides,
  };
  return {
    schemaVersion: "control-plane-credential-staging@1",
    generatedAt: new Date().toISOString(),
    mode: "live-gated-backend-write",
    credentialDirectory: "/run/deployment-control-plane/credentials",
    manifestDigest: "sha256:manifest",
    credentialMapDigest: "sha256:map",
    runtimeConfigDigest: "sha256:runtime",
    backendRefs: [],
    generatedSecretWritePlanIds: [source.writePlanRef],
    hostCredentialSourceIds: [],
    staleCredentialDetection: [
      { file: "control-plane-token", stale: false, evidenceRef: "evidence://stale/token" },
    ],
    reloadEvidence: reloadEvidence(),
    hostMountEvidence: remoteHostEvidence(),
    deploymentOwnedLiveBackendWrite: live,
    deploymentOwnedLiveHostVerification: remoteHostEvidence(),
    externalPrerequisites: [],
    ok: true,
    errors: [],
  };
}

function reloadEvidence() {
  return {
    service: {
      unit: "deployment-control-plane-service.service",
      action: "restart-recorded" as const,
      evidenceRef: "evidence://reload/service",
    },
    workers: [
      {
        unit: "deployment-control-plane-worker-0.service",
        action: "restart-recorded" as const,
        evidenceRef: "evidence://reload/worker-0",
      },
    ],
  };
}

function remoteHostEvidence() {
  const evidence = {
    wiringMode: "bind-mounted-credential-directory" as const,
    targetPath: "/run/deployment-control-plane/credentials" as const,
    filenameSet: ["control-plane-token"],
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
  return { ...evidence, reviewedVerifierProfile: liveHostVerifierProfile(evidence) };
}
