#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { runCloudControlSetupCommand } from "../../deployments/cloud-control-setup";
import { validateRunbookStructure } from "../../deployments/cloud-control-runbook";
import {
  validateCloudControlSetupInput,
  validateCredentialManifestFiles,
} from "../../deployments/cloud-control-setup-validate";
import type {
  CloudControlSetupInput,
  CloudProfileMode,
} from "../../deployments/cloud-control-setup-types";
import { privateLinkAwsTopology, topologyForPublishedImage } from "./cloud-control-cutover-fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST = `sha256:${"b".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"c".repeat(64)}`;
const awsTopology = () => topologyForPublishedImage(privateLinkAwsTopology(), DIGEST_REF, DIGEST);

function input(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "compose-podman",
    image: DIGEST_REF,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: DIGEST_REF,
      sourceRevision: "source-review",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: DIGEST,
      inspectedDigest: DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-review",
      evidenceSource: "generated-command" as const,
      registryProfile: ecrRegistryProfileForImage(DIGEST_REF, DIGEST),
    },
    instanceId: "cloud-review",
    publicUrl: "https://deploy.example.test",
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3",
    artifactBackendEvidence: "",
    deploymentIds: ["pleomino-staging"],
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    awsTopology: awsTopology(),
    ...overrides,
  };
}

const modeFile: Record<CloudProfileMode, string> = {
  "compose-podman": "compose.yaml",
  nixos: "nixos-module.example.nix",
  "saas-oci": "saas-oci-profile.yaml",
  "aws-ec2": "aws-ec2-profile.yaml",
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
  assert.deepEqual(validateRunbookStructure(commands), []);
  assert.match(
    runbookCommand(commands, "health").command,
    /https:\/\/deploy\.example\.test\/healthz' \| tee "\$PROFILE_ROOT\/http-health\.json"$/,
  );
  assert.match(
    runbookCommand(commands, "readiness").command,
    /https:\/\/deploy\.example\.test\/readyz' \| tee "\$PROFILE_ROOT\/http-readiness\.json"$/,
  );
  assert.match(
    runbookCommand(commands, "worker-heartbeats").command,
    /CREDENTIAL_ROOT[\s\S]*Authorization: Bearer %s[\s\S]*\/api\/v1\/worker-heartbeats'/,
  );
  assert.doesNotMatch(JSON.stringify(commands), /<control-plane-service-url>|token-value/);
  assert.match(
    runbookCommand(commands, "database").command,
    /deployment-control-plane managed-dependencies/,
  );
  assert.match(runbookCommand(commands, "artifact-store").mustPass, /PUT, GET, HEAD/);
  assert.match(
    runbookCommand(commands, "database").command,
    /"\$PROFILE_ROOT\/managed-dependencies\.profile\.yaml"/,
  );
  const checklist = JSON.parse(
    renderCloudControlSetupBundle(input()).files["conformance-checklist.json"]!,
  );
  assert.deepEqual(
    checklist.requiredChecks.map((check: { name: string }) => check.name),
    [
      "image-publication",
      "health",
      "readiness",
      "worker-heartbeats",
      "database",
      "artifact-store",
      "provider-capabilities",
    ],
  );
});

function runbookCommand(commands: any, id: string) {
  const found = commands.phases
    .flatMap((phase: any) => phase.commands)
    .find((c: any) => c.id === id);
  if (!found) throw new Error(`missing runbook command ${id}`);
  return found;
}
test("AWS EC2 profile includes Supabase PrivateLink and S3 VPC endpoint placeholders", () => {
  const bundle = renderCloudControlSetupBundle(
    input({ mode: "aws-ec2", awsTopology: awsTopology() }),
  );
  const managed = JSON.parse(bundle.files["managed-dependencies.json"]!);
  const profile = YAML.parse(bundle.files["aws-ec2-profile.yaml"]!);
  assert.equal(managed.postgres.privateConnectivity, "supabase-privatelink-prerequisite");
  assert.equal(managed.artifactStore.defaultAwsPath, "aws-s3-vpc-endpoint");
  assert.equal(profile.network.supabasePrivatelink, true);
  assert.equal(profile.artifactBackend.defaultPath, "AWS S3 through a VPC endpoint");
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
  assert.equal(profile.artifactStore.provider, "aws-s3");
});

test("input validation rejects unsupported substrates and env-var-only secret modes", () => {
  const badMode = input({ mode: "fargate" as CloudProfileMode });
  assert.match(validateCloudControlSetupInput(badMode).join("\n"), /unsupported host substrate/);
  assert.deepEqual(validateCloudControlSetupInput(input({ reviewedSourceMode: "github-app" })), []);
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
      /AWS topology evidence is missing or empty/,
    );
  } finally {
    console.log = previousLog;
    process.exitCode = previousExitCode;
  }
});

test("AWS EC2 default artifact path requires S3 VPC endpoint evidence", () => {
  assert.match(
    validateCloudControlSetupInput(input({ mode: "aws-ec2", awsTopology: undefined })).join("\n"),
    /AWS topology evidence is missing or empty/,
  );
});

test("provider capabilities wire preview, apply, and evidence through reviewed admission", () => {
  const declarations = JSON.parse(
    renderCloudControlSetupBundle(input()).files["provider-capabilities.json"]!,
  );
  for (const declaration of declarations) {
    assert.match(declaration.iac.previewCommand, /^deploy --deployment 'pleomino-staging'/);
    assert.match(declaration.iac.applyCommand, /^deploy --deployment 'pleomino-staging'/);
    assert.match(declaration.iac.evidenceCommand, /^deploy --deployment 'pleomino-staging'/);
  }
});
