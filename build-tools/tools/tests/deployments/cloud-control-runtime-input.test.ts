#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { readCloudControlSetupInput } from "../../deployments/cloud-control-setup";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import { validateCredentialMap } from "../../deployments/cloud-control-credential-map";
import { reviewedSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-profile";
import { runInScratchTemp } from "../lib/test-helpers";
import { runtimeInputProfile, runtimeSetupInput } from "./cloud-control-runtime-input.fixture";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("setup renders production config from runtime input without auth or Infisical placeholders", () => {
  const runtimeInput = runtimeInputProfile({ provider: "supabase-auth" });
  const bundle = renderCloudControlSetupBundle(input({ runtimeInput }));
  const config = YAML.parse(bundle.files["config.yaml"]!);
  assert.equal(config.authProvider.issuer, "https://auth.prod.example.com");
  assert.equal(config.authProvider.callback.externalHost, "deploy-auth.example.test");
  assert.equal(config.credentials.infisicalDeployments[0].projectId, "infisical-prod-project");
  assert.doesNotMatch(
    bundle.files["config.yaml"]!,
    /https:\/\/auth\.example\.test|fixture-only|placeholder/,
  );

  const authProfile = JSON.parse(bundle.files["auth-provider-profile.json"]!);
  assert.equal(authProfile.provider, "supabase-auth");
  assert.equal(authProfile.callback.registrationEvidenceRef, "evidence://auth/callback");

  const manifest = JSON.parse(bundle.files["credential-manifest.json"]!);
  const credentialMap = JSON.parse(bundle.files["credential-map.json"]!);
  assert.deepEqual(
    validateCredentialMap(credentialMap, {
      requiredFiles: manifest.requiredFiles,
      supabaseProjectRef: "project-review",
      connectionMode: "privatelink",
    }),
    [],
  );
  assert.ok(
    credentialMap.entries.every((entry: any) => entry.source.kind && entry.rotation.strategy),
  );
});

test("setup validation fails closed on production placeholder auth runtime input", () => {
  const runtimeInput = runtimeInputProfile({
    issuer: "https://auth.example.test",
    evidenceDigest: "placeholder",
  });
  const errors = validateCloudControlSetupInput(input({ runtimeInput })).join("\n");
  assert.match(errors, /auth-provider profile contains production placeholder metadata/);
});

test("production setup without runtime input fails closed", () => {
  const errors = validateCloudControlSetupInput(input({ runtimeInput: undefined })).join("\n");
  assert.match(errors, /requires runtime input/);
});

test("production setup rejects local fixture runtime input", () => {
  const fixture = { ...runtimeInputProfile(), mode: "local-fixture" as const };
  const errors = validateCloudControlSetupInput(input({ runtimeInput: fixture })).join("\n");
  assert.match(errors, /requires production runtime input/);
});

test("runtime input provenance must match setup profiles and artifact mode", () => {
  const mismatch = runtimeInputProfile();
  mismatch.provenance.supabaseProjectRef = "wrong-project";
  mismatch.provenance.awsVpcId = "wrong-vpc";
  mismatch.provenance.artifactCredentialMode = "aws-instance-profile";
  const errors = validateCloudControlSetupInput(input({ runtimeInput: mismatch })).join("\n");
  assert.match(errors, /Supabase project ref does not match/);
  assert.match(errors, /AWS VPC does not match/);
  assert.match(errors, /artifact credential mode does not match/);
});

test("auth-provider evidence fails closed for shallow or stale evidence", () => {
  const shallow = runtimeInputProfile({
    provider: "dashboard-only" as any,
    issuer: "http://auth.prod.example.com",
    audience: ["wrong-audience"],
    callback: {
      externalHost: "wrong.example.com",
      externalPath: "/wrong",
      registrationEvidenceRef: "dashboard-only",
    },
    claims: { userIdClaim: "", emailClaim: "email", roleClaim: "", servicePrincipalClaim: "azp" },
    roleGroups: { deployer: [], admissionReporter: [], admin: [] },
    servicePrincipals: {},
    metadata: {
      environment: "staging",
      evidenceDigest: "dashboard-only",
      jwksCheckedAt: "2020-01-01T00:00:00.000Z",
    },
    smokeEvidence: {},
  } as any);
  const errors = validateCloudControlSetupInput(input({ runtimeInput: shallow })).join("\n");
  assert.match(errors, /provider is unsupported/);
  assert.match(errors, /issuer must be https/);
  assert.match(errors, /audience does not include/);
  assert.match(errors, /callback host does not match/);
  assert.match(errors, /callback path does not match/);
  assert.match(errors, /role\/group mappings/);
  assert.match(errors, /service-principal mappings/);
  assert.match(errors, /environment must be production/);
  assert.match(errors, /JWKS metadata evidence is stale/);
  assert.match(errors, /smoke evidence is required/);
  assert.match(errors, /placeholder metadata/);
});

test("provider smoke evidence rejects self-attested, stale, and placeholder refs", () => {
  for (const provider of ["supabase-auth", "workos", "external-oidc"] as const) {
    const runtimeInput = runtimeInputProfile({
      provider,
      smokeEvidence: {
        cliLoginRef: "dashboard-only",
        pkceCallbackRef: "evidence://auth/test/pkce",
        checkedAt: new Date().toISOString(),
      },
    });
    const errors = validateCloudControlSetupInput(input({ runtimeInput })).join("\n");
    assert.match(errors, /smoke evidence is required/, provider);
    assert.match(errors, /placeholder metadata/, provider);
  }
});

test("provider smoke evidence is required for reviewed production providers", () => {
  for (const provider of ["supabase-auth", "workos", "external-oidc"] as const) {
    const runtimeInput = runtimeInputProfile({ provider, smokeEvidence: {} });
    const errors = validateCloudControlSetupInput(input({ runtimeInput })).join("\n");
    assert.match(errors, /smoke evidence is required/, provider);
  }
});

test("provider smoke evidence rejects self-attested and placeholder evidence refs", () => {
  for (const [provider, ref] of [
    ["supabase-auth", "self-attested"],
    ["workos", "evidence://placeholder"],
    ["external-oidc", "evidence://auth/test-ref"],
  ] as const) {
    const runtimeInput = runtimeInputProfile({
      provider,
      smokeEvidence: {
        cliLoginRef: ref,
        pkceCallbackRef: "evidence://auth/pkce-callback",
        checkedAt: new Date().toISOString(),
      },
    });
    const errors = validateCloudControlSetupInput(input({ runtimeInput })).join("\n");
    assert.match(errors, /smoke evidence is required/, provider);
    assert.match(errors, /placeholder metadata/, provider);
  }
});

test("entrypoint treats runtime input as a setup value flag", async () => {
  await runInScratchTemp("runtime-input-entrypoint", async (tmp) => {
    const file = path.join(tmp, "runtime-input.yaml");
    await fsp.writeFile(file, YAML.stringify(runtimeInputProfile()), "utf8");
    const previous = process.argv;
    try {
      process.argv = ["node", "deployment-control-plane", "setup", "--runtime-input", file];
      const setupInput = readCloudControlSetupInput();
      assert.equal(setupInput.runtimeInput?.authProvider.issuer, "https://auth.prod.example.com");
    } finally {
      process.argv = previous;
    }
  });
});

test("credential map records instance-profile artifact credentials as host sourced", () => {
  const bundle = renderCloudControlSetupBundle(
    input({
      runtimeInput: {
        ...runtimeInputProfile(),
        provenance: {
          ...runtimeInputProfile().provenance,
          artifactCredentialMode: "aws-instance-profile",
        },
      },
      artifactCredentialMode: "aws-instance-profile",
      artifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-artifacts",
      artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
    }),
  );
  const manifest = JSON.parse(bundle.files["credential-manifest.json"]!);
  const credentialMap = JSON.parse(bundle.files["credential-map.json"]!);
  assert.ok(!manifest.requiredFiles.includes("artifact-store-access-key-id"));
  assert.ok(
    credentialMap.entries.some(
      (entry: any) =>
        entry.file === "control-plane-token" && entry.source.kind === "generated-secret-write-plan",
    ),
  );
  assert.equal(credentialMap.hostMountWiring.mode, "bind-mounted-credential-directory");
});

test("generated NixOS profile carries auth and instance-profile artifact mode", () => {
  const bundle = renderCloudControlSetupBundle(
    input({
      mode: "nixos",
      awsTopology: undefined,
      runtimeInput: {
        ...runtimeInputProfile(),
        provenance: {
          ...runtimeInputProfile().provenance,
          supabaseConnectionMode: "public",
          awsAccountId: undefined,
          awsRegion: undefined,
          awsVpcId: undefined,
          artifactCredentialMode: "aws-instance-profile",
        },
      },
      artifactCredentialMode: "aws-instance-profile",
      artifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-artifacts",
      artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
      supabasePostgres: reviewedSupabaseManagedPostgresProfile({
        instanceId: "cloud-control-plane",
        region: "us-east-1",
        mode: "public",
        organizationId: "org-control-plane-prod",
        projectRef: "project-review",
      }),
    }),
  );
  const profile = bundle.files["nixos-module.example.nix"]!;
  assert.match(profile, /authProvider =/);
  assert.match(profile, /issuer = "https:\/\/auth\.prod\.example\.com"/);
  assert.match(profile, /artifactStore\.credentialMode = "aws-instance-profile"/);
  assert.doesNotMatch(profile, /artifact-store-access-key-id\.source/);
});

const input = runtimeSetupInput;
