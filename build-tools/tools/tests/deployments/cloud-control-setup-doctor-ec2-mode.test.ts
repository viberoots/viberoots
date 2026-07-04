#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { validateRunbookBundle } from "../../deployments/cloud-control-runbook";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { runInScratchTemp } from "../lib/test-helpers";
import { privateLinkAwsTopology, topologyForPublishedImage } from "./cloud-control-cutover-fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";
import { runbookCommand, writeBundle } from "./cloud-control-setup-doctor.helpers";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const DIGEST = `sha256:${"c".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"d".repeat(64)}`;

test("setup doctor fails closed on mismatched EC2 host-mode provider output", async () => {
  await runInScratchTemp("cloud-control-setup-doctor-ec2-mode", async (tmp) => {
    const bundle = renderCloudControlSetupBundle(input({ outDir: tmp }));
    await writeBundle(tmp, bundle.files);
    const commands = JSON.parse(bundle.files["commands.json"]!);
    const evidence = await hostEvidence(bundle.files);
    (evidence.providerPayload as any).ec2HostMode = "repo-owned-asg";
    const output = runbookCommand(commands, "provider-capability-aws-ec2-control-plane-host")
      .outputs[0];
    await fsp.writeFile(
      path.join(tmp, output.slice("$PROFILE_ROOT/".length)),
      JSON.stringify(evidence),
      "utf8",
    );

    const result = await validateRunbookBundle(tmp);
    assert.equal(result.ok, false);
    assert.match(result.evidenceErrors.join("\n"), /EC2 host mode does not match/);
  });
});

async function hostEvidence(files: Record<string, string>) {
  return runCloudProviderCapabilityHook({
    capabilityId: "aws-ec2-control-plane-host",
    phase: "evidence",
    deploymentLabel: "//deployments:staging",
    awsTopologyEvidence: JSON.parse(files["aws-topology-evidence.json"]!),
    awsEc2Profile: YAML.parse(files["aws-ec2-profile.yaml"]!),
    expectedEc2HostMode: "external-reviewed-host",
  });
}

function input(overrides: Partial<CloudControlSetupInput>): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: DIGEST_REF,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: DIGEST_REF,
      sourceRevision: "rev",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: DIGEST,
      inspectedDigest: DIGEST,
      evidenceSource: "generated-command",
      tag: "registry.example.com/platform/deployment-control-plane:source",
      registryProfile: ecrRegistryProfileForImage(DIGEST_REF, DIGEST),
    },
    instanceId: "cloud-review",
    publicUrl: "https://deploy.example.test",
    artifactBackend: "aws-s3",
    artifactBackendEvidence: "",
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    deploymentIds: ["sample-webapp-staging"],
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    awsTopology: topologyForPublishedImage(privateLinkAwsTopology(), DIGEST_REF, DIGEST),
    supabasePostgres: privateLinkSupabaseProfile(),
    runtimeInput: reviewedRuntimeInput(),
    ...overrides,
  };
}
