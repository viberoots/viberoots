#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { maybeRunProviderCapabilityHookForCli } from "../../deployments/deploy-cli-provider-capability";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import {
  IMAGE_BUILD_IDENTITY,
  IMAGE_DIGEST,
  IMAGE_REF,
  privateLinkAwsTopology,
} from "./cloud-control-cutover-fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

test("AWS runbook produces provider capability evidence before cutover", () => {
  const commands = JSON.parse(renderCloudControlSetupBundle(input()).files["commands.json"]!);
  const managed = commands.phases.find((phase: any) => phase.id === "managed-dependencies");
  const ec2 = managed.commands.find(
    (entry: any) => entry.id === "provider-capability-aws-ec2-control-plane-host",
  );
  assert.match(ec2.command, /--provider-capability aws-ec2-control-plane-host/);
  assert.match(
    ec2.command,
    /--aws-topology-evidence "\$PROFILE_ROOT\/aws-topology-evidence\.json"/,
  );
  assert.match(ec2.command, /--aws-ec2-profile "\$PROFILE_ROOT\/aws-ec2-profile\.yaml"/);
  assert.deepEqual(ec2.outputs, [
    "$PROFILE_ROOT/provider-capability-aws-ec2-control-plane-host.json",
  ]);
  const privatelink = managed.commands.find(
    (entry: any) => entry.id === "provider-capability-supabase-privatelink-prerequisite",
  );
  assert.match(privatelink.command, /deployment-control-plane provider-capability/);
  assert.match(privatelink.command, /--provider-capability supabase-privatelink-prerequisite/);
  assert.match(
    privatelink.command,
    /--aws-topology-evidence "\$PROFILE_ROOT\/aws-topology-evidence\.json"/,
  );
  assert.deepEqual(privatelink.inputs, [
    "$PROFILE_ROOT/provider-capabilities.json",
    "$PROFILE_ROOT/aws-topology-evidence.json",
  ]);
  assert.deepEqual(privatelink.outputs, [
    "$PROFILE_ROOT/provider-capability-supabase-privatelink-prerequisite.json",
  ]);
  const cutover = commands.phases.find((phase: any) => phase.id === "cutover-readiness");
  assert.ok(
    cutover.commands[0].inputs.includes(
      "$PROFILE_ROOT/provider-capability-aws-ec2-control-plane-host.json",
    ),
  );
  assert.ok(
    cutover.commands[0].inputs.includes(
      "$PROFILE_ROOT/provider-capability-supabase-privatelink-prerequisite.json",
    ),
  );
});

test("deploy provider-capability CLI loads EC2 bundle inputs", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ec2-provider-cli-"));
  const oldArgv = process.argv;
  const oldLog = console.log;
  const output: string[] = [];
  try {
    const bundle = renderCloudControlSetupBundle(input({ outDir: tmp }));
    await Promise.all(
      Object.entries(bundle.files).map(async ([name, value]) => {
        const file = path.join(tmp, name);
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, value, "utf8");
      }),
    );
    console.log = (message?: unknown) => output.push(String(message));
    process.argv = [
      "node",
      "deploy",
      "--record",
      "--provider-capability",
      "aws-ec2-control-plane-host",
      "--aws-topology-evidence",
      path.join(tmp, "aws-topology-evidence.json"),
      "--aws-ec2-profile",
      path.join(tmp, "aws-ec2-profile.yaml"),
    ];
    assert.equal(
      await maybeRunProviderCapabilityHookForCli({ deployment: { label: "//d:s" } as any }),
      true,
    );
    const emitted = JSON.parse(output.join("\n"));
    assert.equal(emitted.providerPayload.schemaVersion, "aws-ec2-host-hook-payload@1");
  } finally {
    process.argv = oldArgv;
    console.log = oldLog;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

function input(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: IMAGE_REF,
    expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
    imagePublication: {
      image: IMAGE_REF,
      sourceRevision: "source-ec2-hook",
      imageBuildIdentity: IMAGE_BUILD_IDENTITY,
      digest: IMAGE_DIGEST,
      inspectedDigest: IMAGE_DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-ec2-hook",
      evidenceSource: "generated-command",
      registryProfile: ecrRegistryProfileForImage(IMAGE_REF, IMAGE_DIGEST),
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
    awsTopology: privateLinkAwsTopology(),
    supabasePostgres: privateLinkSupabaseProfile(),
    runtimeInput: reviewedRuntimeInput(),
    ...overrides,
  };
}
