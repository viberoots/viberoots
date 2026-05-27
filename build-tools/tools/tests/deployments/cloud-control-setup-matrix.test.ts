#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import {
  capabilityDeclaration,
  CLOUD_CAPABILITY_IDS,
} from "../../deployments/cloud-control-setup-contract";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { runCloudControlSetupCommand } from "../../deployments/cloud-control-setup";
import {
  validateCloudControlSetupInput,
  validateCredentialManifestFiles,
  validateProviderCapabilityDeclaration,
} from "../../deployments/cloud-control-setup-validate";
import type {
  CloudControlSetupInput,
  CloudProfileMode,
} from "../../deployments/cloud-control-setup-types";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function input(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "compose-podman",
    image: DIGEST_REF,
    instanceId: "cloud-review",
    publicUrl: "https://deploy.example.test",
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3",
    artifactBackendEvidence: "",
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    supabasePrivatelink: false,
    awsVpcEndpoint: true,
    awsSubnetIds: ["subnet-123"],
    awsSecurityGroupIds: ["sg-123"],
    tlsEvidence: "alb-listener-dns-reviewed",
    ...overrides,
  };
}

const modeFile: Record<CloudProfileMode, string> = {
  "compose-podman": "compose.yaml",
  nixos: "nixos-module.example.nix",
  "saas-oci": "saas-oci-profile.md",
  "aws-ec2": "aws-ec2-profile.md",
};

for (const mode of Object.keys(modeFile) as CloudProfileMode[]) {
  test(`cloud setup renders structural files for ${mode}`, () => {
    const bundle = renderCloudControlSetupBundle(input({ mode }));
    assert.ok(bundle.files[modeFile[mode]]);
    assert.ok(bundle.files["managed-dependencies.profile.yaml"]);
    assert.ok(bundle.files["conformance-checklist.json"]);
    assert.ok(bundle.files["ingress-checklist.json"]);
    assert.ok(bundle.files["provider-capabilities.json"]);
  });
}

test("commands contain exact health, readiness, heartbeat, artifact, and database checks", () => {
  const commands = JSON.parse(renderCloudControlSetupBundle(input()).files["commands.json"]!);
  assert.match(commands.validations.health.command, /\/healthz$/);
  assert.match(commands.validations.readiness.command, /\/readyz$/);
  assert.match(commands.validations.workerHeartbeats.command, /\/api\/v1\/worker-heartbeats$/);
  assert.match(commands.validations.database.command, /control-plane-managed-dependencies\.ts/);
  assert.match(commands.validations.artifactStore.mustPass, /PUT, GET, HEAD/);
  const checklist = JSON.parse(
    renderCloudControlSetupBundle(input()).files["conformance-checklist.json"]!,
  );
  assert.deepEqual(
    checklist.requiredChecks.map((check: { name: string }) => check.name),
    [
      "health",
      "readiness",
      "worker-heartbeats",
      "database",
      "artifact-store",
      "provider-capabilities",
    ],
  );
});

test("AWS EC2 profile includes Supabase PrivateLink and S3 VPC endpoint placeholders", () => {
  const bundle = renderCloudControlSetupBundle(
    input({ mode: "aws-ec2", supabasePrivatelink: true }),
  );
  const managed = JSON.parse(bundle.files["managed-dependencies.json"]!);
  const profile = bundle.files["aws-ec2-profile.md"]!;
  assert.equal(managed.postgres.privateConnectivity, "supabase-privatelink-prerequisite");
  assert.equal(managed.artifactStore.defaultAwsPath, "aws-s3-vpc-endpoint");
  assert.match(profile, /Supabase PrivateLink: selected/);
  assert.match(profile, /AWS S3 through a VPC endpoint/);
});

test("managed dependency profile is concrete and parser-compatible", () => {
  const profile = YAML.parse(
    renderCloudControlSetupBundle(input()).files["managed-dependencies.profile.yaml"]!,
  );
  assert.equal(
    profile.postgres.urlFile,
    "/run/deployment-control-plane/credentials/control-plane-database-url",
  );
  assert.equal(
    profile.artifactStore.endpointFile,
    "/run/deployment-control-plane/credentials/artifact-store-endpoint",
  );
  assert.equal(profile.artifactStore.provider, "s3-compatible");
});

test("input validation rejects unsupported substrates and env-var-only secret modes", () => {
  const badMode = input({ mode: "fargate" as CloudProfileMode });
  assert.match(validateCloudControlSetupInput(badMode).join("\n"), /unsupported host substrate/);
  assert.match(
    validateCloudControlSetupInput(input({ reviewedSourceMode: "github-app" })).join("\n"),
    /requires a runtime adapter/,
  );
  assert.match(
    validateCredentialManifestFiles(["env:DATABASE_URL", "control-plane-token"]).join("\n"),
    /missing control-plane-database-url.*env-var-only/s,
  );
});

test("credential manifest validation rejects missing filenames", () => {
  assert.match(
    validateCredentialManifestFiles([
      "control-plane-database-url",
      "control-plane-token",
      "artifact-store-endpoint",
    ]).join("\n"),
    /artifact-store-access-key-id.*infisical-client-secret.*reviewed-source-ssh-key.*reviewed-source-known-hosts/s,
  );
  assert.match(
    validateCredentialManifestFiles(
      [
        "control-plane-database-url",
        "control-plane-token",
        "artifact-store-endpoint",
        "artifact-store-access-key-id",
        "artifact-store-secret-access-key",
        "{deploymentId}-infisical-client-id",
        "{deploymentId}-infisical-client-secret",
      ],
      "github-app",
    ).join("\n"),
    /reviewed-source-github-app-id.*reviewed-source-github-app-private-key/s,
  );
  assert.deepEqual(
    validateCredentialManifestFiles(
      [
        "control-plane-database-url",
        "control-plane-token",
        "artifact-store-endpoint",
        "artifact-store-access-key-id",
        "artifact-store-secret-access-key",
        "{deploymentId}-infisical-client-id",
        "{deploymentId}-infisical-client-secret",
        "reviewed-source-github-app-id",
        "reviewed-source-github-app-installation-id",
        "reviewed-source-github-app-private-key",
      ],
      "github-app",
    ),
    [],
  );
});

test("dry-run reports missing AWS managed dependency evidence", async () => {
  const previousExitCode = process.exitCode;
  const output: string[] = [];
  const previousLog = console.log;
  console.log = (message?: unknown) => output.push(String(message));
  process.exitCode = undefined;
  try {
    await withControlPlaneArgv(
      ["setup", "--dry-run", "--host-mode", "aws-ec2", "--image", DIGEST_REF],
      runCloudControlSetupCommand,
    );
    const result = JSON.parse(output.join("\n"));
    assert.equal(result.ok, false);
    assert.match(
      result.missingPrerequisites.join("\n"),
      /AWS S3 VPC endpoint.*subnet evidence.*security-group evidence.*TLS/s,
    );
  } finally {
    console.log = previousLog;
    process.exitCode = previousExitCode;
  }
});

test("AWS EC2 default artifact path requires S3 VPC endpoint evidence", () => {
  assert.match(
    validateCloudControlSetupInput(input({ mode: "aws-ec2", awsVpcEndpoint: false })).join("\n"),
    /AWS S3 VPC endpoint artifact-store evidence/,
  );
});

test("provider capability validation rejects missing fields, ambient credentials, and raw IaC", () => {
  const capability = capabilityDeclaration(CLOUD_CAPABILITY_IDS[0]);
  for (const [field, patch] of [
    ["lockScope", { lockScope: "" }],
    ["credentialSource", { credentialSource: "" }],
    ["rollbackProcedure", { rollbackProcedure: [] }],
    ["protectedSharedEligibility", { protectedSharedEligibility: "" }],
    ["smokeChecks", { smokeChecks: [] }],
  ] as const) {
    assert.match(
      validateProviderCapabilityDeclaration({ ...capability, ...patch }).join("\n"),
      new RegExp(`${field} must not be empty`),
    );
  }
  assert.match(
    validateProviderCapabilityDeclaration({
      ...capability,
      credentialSource: "ambient AWS_PROFILE",
    }).join("\n"),
    /must not use ambient credentials/,
  );
  assert.match(
    validateProviderCapabilityDeclaration({
      ...capability,
      iac: { ...capability.iac, applyCommand: "aws ec2 run-instances" },
    }).join("\n"),
    /iac.applyCommand must use reviewed deploy admission/,
  );
});

test("provider capabilities wire preview, apply, and evidence through reviewed admission", () => {
  const declarations = JSON.parse(
    renderCloudControlSetupBundle(input()).files["provider-capabilities.json"]!,
  );
  for (const declaration of declarations) {
    assert.match(declaration.iac.previewCommand, /^deploy --deployment <label>/);
    assert.match(declaration.iac.applyCommand, /^deploy --deployment <label>/);
    assert.match(declaration.iac.evidenceCommand, /^deploy --deployment <label>/);
  }
});
