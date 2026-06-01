#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readCloudControlSetupInput } from "../../deployments/cloud-control-setup";
import { maybeRunProviderCapabilityHookForCli } from "../../deployments/deploy-cli-provider-capability";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { reviewedSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-profile";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { runtimeInputArgs } from "./control-plane-process-entrypoints.helpers";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { publicSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

const IMAGE =
  "registry.example.com/platform/deployment-control-plane@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DIGEST = `sha256:${"a".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"b".repeat(64)}`;

test("setup renders Supabase profile as a managed dependency consumer input", () => {
  const files = renderCloudControlSetupBundle(baseInput()).files;
  const managed = JSON.parse(files["managed-dependencies.json"]!);
  const commands = JSON.parse(files["commands.json"]!);
  const profile = JSON.parse(files["supabase-postgres.profile.json"]!);
  assert.equal(managed.postgres.supabaseProfile, "supabase-postgres.profile.json");
  assert.equal(profile.schemaVersion, "supabase-managed-postgres-profile@1");
  const managedCommand = commands.phases
    .find((phase: any) => phase.id === "managed-dependencies")
    .commands.at(-1).command;
  const evidenceCommand = commands.phases
    .find((phase: any) => phase.id === "managed-dependencies")
    .commands.find((entry: any) => entry.id === "supabase-managed-postgres-evidence");
  assert.match(managedCommand, /deployment-control-plane managed-dependencies/);
  assert.match(managedCommand, /PROFILE_ROOT="\$\{PROFILE_ROOT:-\$\(pwd\)\}"/);
  assert.match(managedCommand, /commands\.json not found; run from repo root or bundle directory/);
  assert.match(evidenceCommand.command, /deployment-control-plane provider-capability/);
  assert.match(evidenceCommand.command, /--provider-capability supabase-managed-postgres/);
  assert.match(
    evidenceCommand.command,
    /--supabase-postgres-profile "\$PROFILE_ROOT\/supabase-postgres\.profile\.json"/,
  );
  assert.deepEqual(evidenceCommand.outputs, [
    "$PROFILE_ROOT/supabase-managed-postgres-evidence.json",
  ]);
});

test("setup entrypoint validation rejects Supabase plan and region capability failures", () => {
  const profile = reviewedSupabaseManagedPostgresProfile({
    instanceId: "cloud-control-plane",
    region: "us-west-2",
    mode: "privatelink",
    organizationId: "org-control-plane-prod",
    projectRef: "project-review",
  });
  const errors = validateCloudControlSetupInput(
    baseInput({
      mode: "aws-ec2",
      supabasePostgres: {
        ...profile,
        planCapabilities: { ...profile.planCapabilities, supportedRegions: ["us-east-1"] },
      },
    }),
  ).join("\n");
  assert.match(errors, /region does not match selected runtime region/);
  assert.match(errors, /plan does not support selected region/);
});

test("setup validation rejects missing Supabase profile instead of generating placeholders", () => {
  assert.match(
    validateCloudControlSetupInput(baseInput({ supabasePostgres: undefined })).join("\n"),
    /requires Supabase Postgres profile/,
  );
  assert.throws(
    () => renderCloudControlSetupBundle(baseInput({ supabasePostgres: undefined })),
    /requires Supabase Postgres profile/,
  );
});

test("setup CLI input consumes Supabase profile file for entrypoint validation", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "supabase-profile-cli-"));
  const oldArgv = process.argv;
  try {
    const profilePath = path.join(tmp, "supabase.json");
    const profile = reviewedSupabaseManagedPostgresProfile({
      instanceId: "cloud-control-plane",
      region: "us-east-1",
      mode: "privatelink",
      organizationId: "org-control-plane-prod",
      projectRef: "project-review",
    });
    await fsp.writeFile(profilePath, JSON.stringify(profile), "utf8");
    process.argv = [
      "node",
      "deployment-control-plane",
      "setup",
      "--image",
      IMAGE,
      "--image-build-identity",
      BUILD_IDENTITY,
      "--published-digest",
      DIGEST,
      "--host-mode",
      "aws-ec2",
      "--supabase-postgres-profile",
      profilePath,
      ...(await runtimeInputArgs(tmp)),
    ];
    const input = readCloudControlSetupInput();
    assert.equal(input.supabasePostgres?.provisioning.projectRef, "project-review");
    assert.match(
      validateCloudControlSetupInput(input).join("\n"),
      /Supabase profile connection mode does not match selected runtime mode/,
    );
  } finally {
    process.argv = oldArgv;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("deploy provider-capability CLI loads Supabase profile and emits lifecycle evidence", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "supabase-hook-cli-"));
  const oldArgv = process.argv;
  const oldLog = console.log;
  const output: string[] = [];
  try {
    const profilePath = path.join(tmp, "supabase-postgres.profile.json");
    await fsp.writeFile(profilePath, JSON.stringify(publicSupabaseProfile()));
    console.log = (message?: unknown) => output.push(String(message));
    process.argv = [
      "node",
      "deploy",
      "--record",
      "--provider-capability",
      "supabase-managed-postgres",
      "--supabase-postgres-profile",
      profilePath,
    ];
    assert.equal(
      await maybeRunProviderCapabilityHookForCli({ deployment: { label: "//d:s" } as any }),
      true,
    );
    const emitted = JSON.parse(output.join("\n"));
    assert.equal(
      emitted.providerPayload.lifecycleEvidence.schemaVersion,
      "supabase-managed-postgres-evidence@1",
    );
    assert.equal(emitted.providerPayload.lifecycleEvidence.source, "generated-provider-hook");

    process.argv = [
      "node",
      "deploy",
      "--record",
      "--provider-capability",
      "supabase-managed-postgres",
    ];
    await assert.rejects(
      () => maybeRunProviderCapabilityHookForCli({ deployment: { label: "//d:s" } as any }),
      /requires --supabase-postgres-profile/,
    );
  } finally {
    process.argv = oldArgv;
    console.log = oldLog;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

function baseInput(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "compose-podman",
    image: IMAGE,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: IMAGE,
      sourceRevision: "source-supabase-profile",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: DIGEST,
      inspectedDigest: DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-supabase-profile",
      registryProfile: ecrRegistryProfileForImage(IMAGE, DIGEST),
    },
    instanceId: "cloud-control-plane",
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
    awsTopology: privateLinkAwsTopology(),
    supabasePostgres: reviewedSupabaseManagedPostgresProfile({
      instanceId: "cloud-control-plane",
      region: "us-east-1",
      mode: "privatelink",
      organizationId: "org-control-plane-prod",
      projectRef: "project-review",
    }),
    runtimeInput: reviewedRuntimeInput(),
    ...overrides,
  };
}
