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
  const bundle = renderCloudControlSetupBundle(input());
  const commands = JSON.parse(bundle.files["commands.json"]!);
  assert.equal(bundle.files["supabase-privatelink-opentofu-plan.json"], undefined);
  assert.equal(bundle.files["supabase-privatelink-opentofu-apply.json"], undefined);
  assert.equal(bundle.files["supabase-privatelink-readonly-evidence.json"], undefined);
  const tfvars = JSON.parse(bundle.files["supabase-privatelink-opentofu.tfvars.json"]!);
  assert.equal(tfvars.supabase_privatelink_enabled, true);
  assert.equal(
    tfvars.supabase_privatelink_resource_configuration_arn,
    privateLinkAwsTopology().database.privatelink.resourceConfigurationArn,
  );
  assert.match(
    bundle.files["supabase-privatelink-evidence-template.json"]!,
    /Do not submit this template as evidence/,
  );
  assert.match(
    bundle.files["opentofu/aws-control-plane-foundation/privatelink.tf"]!,
    /aws_ram_resource_share_accepter/,
  );
  const template = JSON.parse(bundle.files["supabase-privatelink-evidence-template.json"]!);
  assert.equal(template.bundleRoot, "$PROFILE_ROOT");
  assert.equal(template.workingDirectory, "$PROFILE_ROOT/opentofu/aws-control-plane-foundation");
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
  const plan = managed.commands.find(
    (entry: any) => entry.id === "supabase-privatelink-opentofu-plan",
  );
  assert.match(plan.command, /tofu .* plan /);
  assert.match(plan.command, /\$PROFILE_ROOT\/opentofu\/aws-control-plane-foundation/);
  assert.match(plan.command, /supabase-privatelink-opentofu\.tfvars\.json/);
  assert.match(plan.command, /supabase-privatelink-opentofu-plan\.out\.json/);
  assert.ok(plan.inputs.includes("$PROFILE_ROOT/supabase-privatelink-opentofu.tfvars.json"));
  assert.ok(
    plan.inputs.includes("$PROFILE_ROOT/opentofu/aws-control-plane-foundation/privatelink.tf"),
  );
  assert.ok(plan.outputs.includes("$PROFILE_ROOT/supabase-privatelink-opentofu-plan.json"));
  const apply = managed.commands.find(
    (entry: any) => entry.id === "supabase-privatelink-opentofu-apply",
  );
  assert.match(apply.command, /tofu .* apply /);
  assert.ok(apply.outputs.includes("$PROFILE_ROOT/supabase-privatelink-opentofu-apply.json"));
  const readOnly = managed.commands.find(
    (entry: any) => entry.id === "supabase-privatelink-readonly-evidence",
  );
  assert.match(readOnly.command, /aws ram get-resource-shares/);
  assert.match(readOnly.command, /describe-vpc-endpoints/);
  assert.match(readOnly.command, /describe-security-group-rules/);
  assert.match(readOnly.command, /psql "\$CONTROL_PLANE_DATABASE_URL"/);
  assert.ok(readOnly.outputs.includes("$PROFILE_ROOT/supabase-privatelink-readonly-evidence.json"));
  assert.ok(managed.commands.indexOf(readOnly) < managed.commands.indexOf(privatelink));
  assert.match(privatelink.command, /deployment-control-plane provider-capability/);
  assert.match(privatelink.command, /--provider-capability supabase-privatelink-prerequisite/);
  assert.match(
    privatelink.command,
    /--aws-topology-evidence "\$PROFILE_ROOT\/aws-topology-evidence\.json"/,
  );
  for (const file of [
    "supabase-privatelink-opentofu-plan",
    "supabase-privatelink-opentofu-apply",
    "supabase-privatelink-readonly-evidence",
  ]) {
    assert.match(privatelink.command, new RegExp(`\\$PROFILE_ROOT/${file}\\.json`));
  }
  assert.deepEqual(privatelink.inputs, [
    "$PROFILE_ROOT/provider-capabilities.json",
    "$PROFILE_ROOT/aws-topology-evidence.json",
    "$PROFILE_ROOT/supabase-privatelink-opentofu-plan.json",
    "$PROFILE_ROOT/supabase-privatelink-opentofu-apply.json",
    "$PROFILE_ROOT/supabase-privatelink-readonly-evidence.json",
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
