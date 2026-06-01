import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { validateAwsFoundationProfile } from "../../deployments/cloud-control-aws-foundation-profile";
import { validateAwsTopologyEvidence } from "../../deployments/cloud-control-aws-topology-validate";
import {
  CLOUD_PROVIDER_CAPABILITY_HOOK_PHASES,
  runCloudProviderCapabilityHook,
} from "../../deployments/cloud-control-provider-capability-hooks";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import {
  foundationFromTopology,
  privateLinkAwsTopology,
  publicAwsTopology,
  topologyForPublishedImage,
} from "./cloud-control-cutover-fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";
const opts = { expectedRegion: "us-east-1", maxAgeMinutes: 60 };
const digest = `sha256:${"e".repeat(64)}`;
const image = `registry.example.com/platform/deployment-control-plane@${digest}`;
const identity = `nix-source-${"f".repeat(64)}`;

test("repo-owned AWS foundation OpenTofu module covers network IAM S3 state and drift outputs", () => {
  const moduleDir = path.join(
    process.cwd(),
    "build-tools/deployments/aws-control-plane-foundation/opentofu",
  );
  const files = fs.readdirSync(moduleDir).filter((file) => file.endsWith(".tf"));
  const source = files
    .map((file) => fs.readFileSync(path.join(moduleDir, file), "utf8"))
    .join("\n");
  for (const expected of [
    'resource "aws_vpc"',
    'resource "aws_subnet"',
    "map_public_ip_on_launch = false",
    'resource "aws_route_table"',
    'resource "aws_vpc_endpoint" "s3"',
    'resource "aws_lb_target_group_attachment" "control_plane"',
    "topology_evidence",
    "targetRegistration",
    'resource "aws_security_group"',
    'resource "aws_security_group" "privatelink"',
    "outbound_https_cidrs",
    "control-plane ${each.value.target} HTTPS egress",
    'resource "aws_iam_role"',
    'resource "aws_iam_role" "evidence_collector"',
    'resource "aws_iam_role" "provider_hook"',
    'resource "aws_iam_instance_profile"',
    'resource "aws_s3_bucket"',
    "object_lock_enabled = true",
    'resource "aws_s3_bucket_policy"',
    'resource "aws_s3_bucket_object_lock_configuration"',
    'resource "aws_s3_bucket_public_access_block"',
    'resource "aws_s3_bucket_versioning"',
    'resource "aws_s3_bucket_lifecycle_configuration"',
    'resource "aws_kms_key"',
    'resource "aws_dynamodb_table"',
    'output "foundation_evidence"',
  ]) {
    assert.ok(source.includes(expected), expected);
  }
});

test("AWS foundation hooks produce preview apply evidence smoke and rollback payloads", async () => {
  const foundation = publicAwsTopology().foundation;
  const phases = await Promise.all(
    CLOUD_PROVIDER_CAPABILITY_HOOK_PHASES.map((phase) =>
      runCloudProviderCapabilityHook({
        capabilityId: "aws-network-foundation",
        phase,
        deploymentLabel: "//deployments:staging",
        awsFoundationInspection: foundation,
      }),
    ),
  );
  assert.deepEqual(
    phases.map((hook) => ({
      phase: hook.phase,
      capabilityId: hook.capabilityId,
      adapter: hook.hook.adapter,
      action: (hook.providerPayload?.operation as any).action,
      payloadSource: (hook.providerPayload?.foundation as any).source,
      redacted: hook.output.redacted,
    })),
    [
      { phase: "preview", action: "plan" },
      { phase: "apply", action: "apply" },
      { phase: "evidence", action: "collect-evidence" },
      { phase: "smoke", action: "smoke" },
      { phase: "rollback", action: "destroy-plan" },
      { phase: "reviewed-import", action: "plan" },
    ].map(({ phase, action }) => ({
      phase,
      action,
      capabilityId: "aws-network-foundation",
      adapter: "repo-owned-aws-network-foundation",
      payloadSource: "opentofu-apply-output",
      redacted: true,
    })),
  );
});

test("topology binding rejects public private subnets and mismatched foundation VPCs", () => {
  const base = publicAwsTopology();
  const publicSubnet = publicAwsTopology({
    privateSubnets: [{ ...base.privateSubnets[0], mapPublicIpOnLaunch: true }],
  });
  assert.match(
    validateAwsTopologyEvidence(publicSubnet, opts).join("\n"),
    /private subnet 0 must not map public IPs|selected private subnet is public/,
  );
  const mismatched = {
    ...base,
    foundation: {
      ...base.foundation,
      network: {
        ...base.foundation.network,
        vpc: { ...base.foundation.network.vpc, vpcId: "vpc-999" },
      },
    },
  };
  assert.match(
    validateAwsTopologyEvidence(mismatched, opts).join("\n"),
    /foundation VPC id does not match selected topology VPC/,
  );
});

test("foundation validation rejects trust KMS replication and broad worker egress gaps", () => {
  const foundation = foundationFromTopology(privateLinkAwsTopology());
  const errors = validateAwsFoundationProfile(
    {
      ...foundation,
      preflight: {
        ...foundation.preflight,
        kms: { ...foundation.preflight.kms, deletionWindowDays: 3 },
      },
      network: {
        ...foundation.network,
        outboundPolicyDigests: { ...foundation.network.outboundPolicyDigests, infisical: "" },
        outboundHttpsTargets: [...foundation.network.outboundHttpsTargets, "0.0.0.0/0"],
        securityGroupIds: { ...foundation.network.securityGroupIds, privatelink: "" },
      },
      iam: { ...foundation.iam, instanceProfileTrustDigest: "" },
      artifactStore: {
        ...foundation.artifactStore,
        objectLock: false,
        bucketPolicyDigest: "",
        immutablePrefixPolicyDigest: "",
        replicationSelected: true,
        replicationEvidence: undefined,
      },
    },
    { ...opts, expectedAccountId: "123456789012", expectedArtifactBackend: "aws-s3" },
  ).join("\n");
  assert.match(errors, /KMS evidence missing key ownership or deletion-window posture/);
  assert.match(errors, /egress policy infisical missing reviewed digest/);
  assert.match(errors, /security group privatelink is missing/);
  assert.match(errors, /instance profile trust evidence missing digest/);
  assert.match(errors, /object-lock evidence is missing/);
  assert.match(errors, /immutable prefix policy missing digest/);
  assert.match(errors, /bucket endpoint or bucket policy evidence/);
  assert.match(errors, /replication\/import evidence is missing/);
  assert.match(errors, /must not allow undocumented broad outbound access/);
});

test("alternate artifact backends keep selected provider and reviewed import evidence", () => {
  const topology = topologyForImage({
    artifactBackend: "cloudflare-r2",
    artifactBackendEvidence: {
      checkedAt: new Date().toISOString(),
      reviewedReference: "reviewed-cloudflare-r2-import",
      digest: "sha256:cloudflare-r2-import",
    },
    s3VpcEndpoint: undefined,
  });
  const foundation = foundationFromTopology(topology);
  assert.equal(foundation.artifactStore.backend, "cloudflare-r2");
  assert.deepEqual(foundation.artifactStore.importEvidence, topology.artifactBackendEvidence);
  assert.deepEqual(
    validateAwsFoundationProfile(foundation, {
      ...opts,
      expectedAccountId: "123456789012",
      expectedArtifactBackend: "cloudflare-r2",
      capabilityId: "aws-network-foundation",
    }),
    [],
  );

  const bundle = renderCloudControlSetupBundle(
    input({
      artifactBackend: "cloudflare-r2",
      artifactBackendEvidence: "reviewed-cloudflare-r2-import",
      awsTopology: topology,
    }),
  );
  const profile = YAML.parse(bundle.files["managed-dependencies.profile.yaml"]!);
  assert.equal(profile.artifactStore.provider, "cloudflare-r2");
  assert.equal(
    profile.runtimePath.expectedAlternateBackendEvidenceRef,
    "reviewed-cloudflare-r2-import",
  );
  assert.equal(
    profile.runtimePath.expectedAlternateBackendEvidenceDigest,
    "sha256:cloudflare-r2-import",
  );
});
function input(overrides: Partial<CloudControlSetupInput>): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image,
    expectedImageBuildIdentity: identity,
    imagePublication: {
      image,
      sourceRevision: "source-aws-scope",
      imageBuildIdentity: identity,
      digest,
      inspectedDigest: digest,
      tag: "registry.example.com/platform/deployment-control-plane:source-aws-scope",
      evidenceSource: "generated-command",
      registryProfile: ecrRegistryProfileForImage(image, digest),
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
    awsTopology: topologyForImage(),
    supabasePostgres: privateLinkSupabaseProfile(),
    runtimeInput: reviewedRuntimeInput(),
    ...overrides,
  };
}
function topologyForImage(overrides: Record<string, unknown> = {}) {
  return topologyForPublishedImage(privateLinkAwsTopology(overrides), image, digest);
}
