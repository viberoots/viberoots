#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import {
  CLOUD_CAPABILITY_IDS,
  REQUIRED_CAPABILITY_FIELDS,
} from "../../deployments/cloud-control-setup-contract";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { writeCloudControlSetupBundle } from "../../deployments/cloud-control-setup";
import {
  validateCloudControlSetupInput,
  validateProviderCapabilityEvidence,
  validateProviderCapabilityDeclaration,
} from "../../deployments/cloud-control-setup-validate";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { runInScratchTemp } from "../lib/test-helpers";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function baseInput(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "compose-podman",
    image: DIGEST_REF,
    instanceId: "cloud-staging",
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
    tlsEvidence: "alb-listener-and-dns-reviewed",
    ...overrides,
  };
}

test("cloud setup bundle renders runtime, credentials, commands, and capabilities", () => {
  const bundle = renderCloudControlSetupBundle(baseInput());
  const config = YAML.parse(bundle.files["config.yaml"]!);
  const manifest = JSON.parse(bundle.files["credential-manifest.json"]!);
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const managed = JSON.parse(bundle.files["managed-dependencies.json"]!);
  const ingress = JSON.parse(bundle.files["ingress-checklist.json"]!);
  assert.equal(
    config.service.tokenFile,
    "/run/deployment-control-plane/credentials/control-plane-token",
  );
  assert.equal(config.storage.artifactStore.bucket, "deployment-control-plane-artifacts");
  assert.equal(config.authProvider.callback.externalHost, "deploy-auth.example.test");
  assert.equal(managed.postgres.candidate, "supabase-managed-postgres");
  assert.equal(managed.artifactStore.backend, "aws-s3");
  assert.equal(ingress.serviceIngress.readiness, "/readyz");
  assert.ok(manifest.requiredFiles.includes("{deploymentId}-infisical-client-secret"));
  assert.ok(manifest.requiredFiles.includes("reviewed-source-ssh-key"));
  assert.ok(manifest.requiredFiles.includes("reviewed-source-known-hosts"));
  assert.equal(
    config.reviewedSource.sshKnownHostsFile,
    "/run/deployment-control-plane/credentials/reviewed-source-known-hosts",
  );
  assert.equal(commands.image, DIGEST_REF);
  assert.equal(commands.workers.length, 2);
  assert.deepEqual(
    bundle.capabilities.map((capability) => capability.id),
    [...CLOUD_CAPABILITY_IDS],
  );
  for (const capability of bundle.capabilities) {
    assert.deepEqual(validateProviderCapabilityDeclaration(capability), []);
    for (const field of REQUIRED_CAPABILITY_FIELDS) assert.ok((capability as any)[field]);
  }
});

test("AWS EC2 profile records production boundaries and reviewed alternates", async () => {
  await runInScratchTemp("cloud-control-aws-setup", async (tmp) => {
    await writeCloudControlSetupBundle(baseInput({ outDir: tmp, mode: "aws-ec2" }));
    const awsProfile = await fsp.readFile(path.join(tmp, "aws-ec2-profile.md"), "utf8");
    const capabilities = JSON.parse(
      await fsp.readFile(path.join(tmp, "provider-capabilities.json"), "utf8"),
    );
    assert.match(awsProfile, /AWS S3 through a VPC endpoint/);
    assert.match(
      awsProfile,
      /Supabase Storage S3 and other S3-compatible stores are reviewed alternates/,
    );
    assert.ok(await exists(path.join(tmp, "managed-dependencies.json")));
    assert.ok(await exists(path.join(tmp, "ingress-checklist.json")));
    assert.equal(capabilities.length, CLOUD_CAPABILITY_IDS.length);
  });
});

test("GitHub App reviewed-source mode is rejected until runtime adapter support exists", () => {
  assert.match(
    validateCloudControlSetupInput(baseInput({ reviewedSourceMode: "github-app" })).join("\n"),
    /requires a runtime adapter/,
  );
  assert.throws(
    () => renderCloudControlSetupBundle(baseInput({ reviewedSourceMode: "github-app" })),
    /requires a runtime adapter/,
  );
});

test("cloud setup validation rejects tag-only images, weak topology, and missing AWS evidence", () => {
  assert.match(
    validateCloudControlSetupInput(
      baseInput({ image: "registry.example.com/control-plane:latest" }),
    ).join("\n"),
    /pinned by @sha256 digest/,
  );
  assert.match(
    validateCloudControlSetupInput(baseInput({ workerReplicas: 1 })).join("\n"),
    /at least two workers/,
  );
  assert.match(
    validateCloudControlSetupInput(
      baseInput({ mode: "aws-ec2", awsSubnetIds: [], awsSecurityGroupIds: [], tlsEvidence: "" }),
    ).join("\n"),
    /subnet evidence.*security-group evidence.*TLS/s,
  );
});

test("generated profile files do not embed secret values", async () => {
  await runInScratchTemp("cloud-control-secret-free", async (tmp) => {
    await writeCloudControlSetupBundle(baseInput({ outDir: tmp }));
    for (const name of await fsp.readdir(tmp)) {
      const text = await fsp.readFile(path.join(tmp, name), "utf8");
      assert.doesNotMatch(
        text,
        /AKIA[0-9A-Z]{16}|DATABASE_URL|SECRET_ACCESS_KEY|BEGIN .*PRIVATE KEY/,
      );
      assert.doesNotMatch(text, /postgres:\/\/[^<\s]+:[^<\s]+@/i);
    }
  });
});

test("provider-capability evidence is required before protected readiness", () => {
  const capabilities = renderCloudControlSetupBundle(baseInput()).capabilities;
  assert.match(
    validateProviderCapabilityEvidence(capabilities, {}).join("\n"),
    /aws-ec2-control-plane-host: protected\/shared readiness requires attached evidence/,
  );
  const completeEvidence = Object.fromEntries(
    capabilities.map((capability) => [capability.id, [...capability.auditEvidence]]),
  );
  assert.deepEqual(validateProviderCapabilityEvidence(capabilities, completeEvidence), []);
  const incompleteEvidence = {
    ...completeEvidence,
    "aws-s3-artifact-store": ["preview output digest"],
  };
  assert.match(
    validateProviderCapabilityEvidence(capabilities, incompleteEvidence).join("\n"),
    /aws-s3-artifact-store: missing evidence "apply result digest"/,
  );
});

async function exists(file: string): Promise<boolean> {
  return await fsp
    .access(file)
    .then(() => true)
    .catch(() => false);
}
