#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAwsTopologyEvidence } from "../../deployments/cloud-control-aws-topology-validate";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateRenderedProfile } from "../../deployments/cloud-control-setup-profile-validate";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { IMAGE_BUILD_IDENTITY, IMAGE_DIGEST, IMAGE_REF } from "./cloud-control-cutover-fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

test("AWS EC2 host profile validation rejects AMI pin and network placement gaps", () => {
  assertRejects({ compute: { amiBuildIdentity: "" } }, /missing AMI build identity/);
  assertRejects(
    { compute: { amiSelection: { pinPath: "latest-marketplace-alias" } } },
    /reviewed NixOS build\/import.*selected AMI id.*mutable marketplace/s,
  );
  assertRejects({ compute: { launchTemplateSubnetIds: [] } }, /selected private subnet placement/);
  assertRejects(
    { compute: { launchTemplateSubnetIds: ["subnet-public"] } },
    /not selected in reviewed foundation topology/,
  );
  assertRejects({ compute: { securityGroupIds: ["sg-service"] } }, /missing selected worker group/);
});

test("AWS EC2 host profile validation rejects host posture and bootstrap gaps", () => {
  assertRejects({ compute: { ebs: { encrypted: false } } }, /EBS evidence/);
  assertRejects({ compute: { recovery: {} } }, /recovery profile.*lease\/fencing/s);
  assertRejects(
    { compute: { access: { mode: "reviewed-ssh-break-glass", broadInboundSsh: true } } },
    /SSH access is too broad/,
  );
  assertRejects(
    { compute: { userData: { activatesGeneratedArtifacts: true, providerMutation: true } } },
    /user data must only activate generated artifacts/,
  );
  assertRejects({ compute: { patchCadence: { hostImage: "" } } }, /host image.*container image/);
});

test("AWS EC2 host profile validation rejects runtime proof and observability gaps", () => {
  assertRejects({ compute: { registryPullProof: { hostProfile: "laptop" } } }, /pull proof/);
  assert.match(
    validateAwsTopologyEvidence(privateLinkAwsTopology(), {
      maxAgeMinutes: 60,
      expectedImage: "registry.example.com/other/app@sha256:bbbb",
      expectedImageDigest: `sha256:${"b".repeat(64)}`,
    }).join("\n"),
    /pull proof image does not match.*pull proof digest does not match/s,
  );
  const otherDigest = `sha256:${"b".repeat(64)}`;
  const otherImage = `registry.example.com/platform/deployment-control-plane@${otherDigest}`;
  const setupErrors = validateCloudControlSetupInput(
    input({
      image: otherImage,
      imagePublication: {
        ...input().imagePublication!,
        image: otherImage,
        digest: otherDigest,
        inspectedDigest: otherDigest,
        registryProfile: ecrRegistryProfileForImage(otherImage, otherDigest),
      },
    }),
  ).join("\n");
  assert.match(setupErrors, /pull proof image does not match.*pull proof digest does not match/s);
  assertRejects(
    { compute: { processEvidence: { imageDigest: `sha256:${"b".repeat(64)}` } } },
    /process evidence image digest does not match selected digest/,
  );
  assertRejects(
    { compute: { processEvidence: { workers: ["pid:101"], configDigest: "sha256:x" } } },
    /at least two worker.*imageDigest.*credentialManifestDigest.*serviceReadiness/s,
  );
  assertRejects(
    {
      operationalVisibility: {
        logSink: {},
        unitLogRouting: {},
        history: {},
        alarms: [{ id: "service-down", target: "sns" }],
      },
    },
    /log sink.*unit log routing.*readiness.*missing alarm readiness-failure/s,
  );
});

test("AWS EC2 generated entrypoint artifacts reject missing worker units and writable credentials", () => {
  const files = renderCloudControlSetupBundle(input()).files;
  const missingWorker = { ...files };
  delete missingWorker["systemd/deployment-control-plane-worker-2.service"];
  assert.match(
    validateRenderedProfile(missingWorker).join("\n"),
    /deployment-control-plane-worker-2 missing generated systemd unit/,
  );

  const writableCredentials = {
    ...files,
    "systemd/deployment-control-plane-worker-1.service": files[
      "systemd/deployment-control-plane-worker-1.service"
    ]!.replace(
      "/run/deployment-control-plane/credentials:/run/deployment-control-plane/credentials:ro",
      "/run/deployment-control-plane/credentials:/run/deployment-control-plane/credentials:rw",
    ),
  };
  assert.match(
    validateRenderedProfile(writableCredentials).join("\n"),
    /deployment-control-plane-worker-1\.service credential mount must be read-only/,
  );
});

function assertRejects(overrides: Record<string, any>, pattern: RegExp): void {
  const topology = privateLinkAwsTopology() as any;
  const next = {
    ...topology,
    ...overrides,
    compute: { ...topology.compute, ...(overrides.compute || {}) },
    operationalVisibility: {
      ...topology.operationalVisibility,
      ...(overrides.operationalVisibility || {}),
    },
  };
  assert.match(validateCloudControlSetupInput(input({ awsTopology: next })).join("\n"), pattern);
}

function input(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: IMAGE_REF,
    expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
    imagePublication: {
      image: IMAGE_REF,
      sourceRevision: "source-ec2-host",
      imageBuildIdentity: IMAGE_BUILD_IDENTITY,
      digest: IMAGE_DIGEST,
      inspectedDigest: IMAGE_DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-ec2-host",
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
