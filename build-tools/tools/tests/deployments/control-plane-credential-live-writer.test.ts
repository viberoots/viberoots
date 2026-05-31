import assert from "node:assert/strict";
import { test } from "node:test";
import { writeGeneratedSecretsToInfisical } from "../../deployments/control-plane-credential-live-writer";
import {
  credentialMap,
  validateCredentialMap,
} from "../../deployments/cloud-control-credential-map";
import { validateLiveInputs } from "../../deployments/control-plane-credential-staging-live";
import { startFakeInfisicalServer } from "./infisical.test-server";
import {
  input as setupInput,
  liveHostVerifierProfile,
} from "./control-plane-credential-live.fixture";

test("live writer rejects selector identity and least-privilege mismatches before write", async () => {
  const map = credentialMap(setupInput(), ["control-plane-token"]);
  const source = map.entries[0]!.source as any;
  const server = await startFakeInfisicalServer({
    clientId: "writer",
    clientSecret: "client-secret",
    accessToken: "token",
  });
  try {
    await assert.rejects(
      () =>
        writeGeneratedSecretsToInfisical({
          credentialMap: map,
          profile: {
            ...profile(server.siteUrl, source),
            secretPath: "/over-broad",
          },
        }),
      /selector does not match/,
    );
    await assert.rejects(
      () =>
        writeGeneratedSecretsToInfisical({
          credentialMap: map,
          profile: {
            ...profile(server.siteUrl, source),
            leastPrivilegeScopeEvidenceRef: "evidence://infisical/other-scope",
          },
        }),
      /least-privilege scope/,
    );
    await assert.rejects(
      () =>
        writeGeneratedSecretsToInfisical({
          credentialMap: map,
          profile: {
            ...profile(server.siteUrl, source),
            leastPrivilegeScope: { ...source.leastPrivilegeScope, secretPath: "/" },
          },
        }),
      /least-privilege scope/,
    );
    assert.equal(server.secrets.length, 0);
  } finally {
    await server.close();
  }
});

test("live evidence reconciliation rejects map selector identity and scope drift", () => {
  const map = credentialMap(setupInput(), ["control-plane-token"]);
  const source = map.entries[0]!.source as any;
  const evidence = {
    schemaVersion: "control-plane-credential-live-backend-write@1" as const,
    checkedAt: new Date().toISOString(),
    liveGate: "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1" as const,
    backend: "infisical" as const,
    source: "deployment-owned-live-write" as const,
    projectId: "wrong-project",
    environment: source.selector.environment,
    secretPath: source.selector.secretPath,
    deploymentIdentityEvidenceRef: "evidence://infisical/other-identity",
    leastPrivilegeScopeEvidenceRef: source.leastPrivilegeScopeEvidenceRef,
    leastPrivilegeScope: { ...source.leastPrivilegeScope, environment: "other" },
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
  };
  const previous = process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
  process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = "1";
  try {
    const errors = validateLiveInputs({
      live: true,
      backendEvidence: evidence,
      hostMountEvidence: remoteHostEvidence(),
      credentialMap: map,
      requiredFiles: ["control-plane-token"],
      backendRefs: [],
      writePlanIds: [source.writePlanRef],
      hostSourceIds: [],
    });
    assert.match(errors.join("\n"), /selector/);
    assert.match(errors.join("\n"), /identity/);
    assert.match(errors.join("\n"), /least-privilege scope/);
  } finally {
    if (previous === undefined) delete process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
    else process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = previous;
  }
});

test("credential map rejects provider-generated raw-value import attempts", () => {
  const map = credentialMap(setupInput(), ["control-plane-token"]);
  (map.entries[0]!.source as any).rawValue = "provider-generated-secret-value";
  assert.match(
    validateCredentialMap(map, { requiredFiles: ["control-plane-token"] }).join("\n"),
    /raw values|secret values/,
  );
});

test("live writer rejects maps without generated-secret write plans", async () => {
  const map = credentialMap(setupInput(), ["control-plane-database-url"]);
  const server = await startFakeInfisicalServer({
    clientId: "writer",
    clientSecret: "client-secret",
    accessToken: "token",
  });
  try {
    await assert.rejects(
      () =>
        writeGeneratedSecretsToInfisical({
          credentialMap: map,
          profile: profile(server.siteUrl, {
            selector: {
              projectId: "project-review",
              environment: "production",
              secretPath: "/deployment-control-plane/generated",
            },
            deploymentIdentityEvidenceRef: "evidence://infisical/universal-auth-machine-identity",
            leastPrivilegeScopeEvidenceRef: "evidence://infisical/least-privilege-secret-paths",
            leastPrivilegeScope: {
              projectId: "project-review",
              environment: "production",
              secretPath: "/deployment-control-plane/generated",
              allowedSecretNames: ["control-plane-token"],
              permissions: ["create", "read", "update"],
            },
          }),
        }),
      /no generated-secret write plans/,
    );
  } finally {
    await server.close();
  }
});

function profile(siteUrl: string, source: any) {
  return {
    schemaVersion: "control-plane-live-infisical-backend-profile@1" as const,
    siteUrl,
    clientId: "writer",
    clientSecret: "client-secret",
    projectId: source.selector.projectId,
    environment: source.selector.environment,
    secretPath: source.selector.secretPath,
    deploymentIdentityEvidenceRef: source.deploymentIdentityEvidenceRef,
    leastPrivilegeScopeEvidenceRef: source.leastPrivilegeScopeEvidenceRef,
    leastPrivilegeScope: source.leastPrivilegeScope,
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
