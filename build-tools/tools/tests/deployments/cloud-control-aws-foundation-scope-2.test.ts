#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { validateAwsFoundationProfile } from "../../deployments/cloud-control-aws-foundation-profile";
import { validateAwsTopologyEvidence } from "../../deployments/cloud-control-aws-topology-validate";
import { foundationFromTopology, privateLinkAwsTopology } from "./cloud-control-cutover-fixture";

const opts = {
  expectedRegion: "us-east-1",
  expectedAccountId: "123456789012",
  maxAgeMinutes: 60,
};

test("AWS foundation OpenTofu module has concrete NAT and public HTTPS egress path", () => {
  const source = moduleSource();
  for (const expected of [
    'resource "aws_internet_gateway"',
    'resource "aws_route" "public_internet"',
    'resource "aws_eip" "nat"',
    'resource "aws_nat_gateway" "controlled_egress"',
    'resource "aws_route" "private_controlled_https_egress"',
    'resource "aws_vpc_endpoint" "s3"',
  ]) {
    assert.match(source, new RegExp(escapeRegExp(expected)));
  }
});

test("OpenTofu foundation hooks reject ambient AWS execution credentials", () => {
  const source = [
    "build-tools/tools/deployments/cloud-control-aws-foundation-hooks.ts",
    "build-tools/tools/deployments/cloud-control-aws-foundation-credentials.ts",
  ]
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  assert.match(source, /AWS_SHARED_CREDENTIALS_FILE/);
  assert.match(source, /VBR_AWS_FOUNDATION_ASSUME_ROLE_ARN/);
  assert.match(source, /sts", "assume-role"/);
  assert.match(source, /AWS_EC2_METADATA_DISABLED/);
  assert.match(source, /!name\.startsWith\("AWS_"\)/);
});

test("live AWS inspection uses constrained credentials and verifies returned state", () => {
  const source = [
    "build-tools/tools/deployments/cloud-control-aws-foundation-inspect.ts",
    "build-tools/tools/deployments/cloud-control-aws-foundation-live-inspect.ts",
  ]
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  for (const expected of [
    "awsFoundationLiveEnv",
    "get-public-access-block",
    "get-bucket-policy",
    "get-object-lock-configuration",
    "get-policy-version",
    "quota.available > available",
    "describe-vpc-endpoints",
    "stdio",
  ]) {
    assert.match(source, new RegExp(escapeRegExp(expected)));
  }
});

test("OpenTofu foundation module and hooks wire encrypted locked backend state", () => {
  const moduleSourceText = moduleSource();
  const hookSource = fs.readFileSync(
    "build-tools/tools/deployments/cloud-control-aws-foundation-hooks.ts",
    "utf8",
  );
  assert.match(moduleSourceText, /backend "s3"/);
  assert.match(moduleSourceText, /encrypt = true/);
  assert.match(hookSource, /VBR_AWS_FOUNDATION_BACKEND_CONFIG/);
  assert.match(hookSource, /workspace", "select"/);
  assert.match(
    fs.readFileSync(
      "build-tools/deployments/aws-control-plane-foundation/opentofu/backend.hcl.example",
      "utf8",
    ),
    /dynamodb_table/,
  );
});

test("OpenTofu foundation IAM policies avoid wildcard service actions", () => {
  const source = fs.readFileSync(
    "build-tools/deployments/aws-control-plane-foundation/opentofu/iam.tf",
    "utf8",
  );
  for (const wildcard of ["ec2:Describe*", "iam:Get*", "iam:List*", "s3:Get*", "s3:List*"]) {
    assert.doesNotMatch(source, new RegExp(escapeRegExp(wildcard)));
  }
});

test("alternate artifact stores require full compatibility retention and network-path evidence", () => {
  const topology = privateLinkAwsTopology({
    artifactBackend: "cloudflare-r2",
    s3VpcEndpoint: undefined,
    artifactBackendEvidence: {
      checkedAt: new Date().toISOString(),
      reviewedReference: "reviewed-cloudflare-r2-import",
      digest: "sha256:cloudflare-r2-import",
    },
  });
  const foundation = foundationFromTopology(topology);
  assert.deepEqual(
    validateAwsFoundationProfile(foundation, {
      ...opts,
      expectedArtifactBackend: "cloudflare-r2",
      capabilityId: "aws-network-foundation",
    }),
    [],
  );
  const errors = validateAwsFoundationProfile(
    {
      ...foundation,
      artifactStore: {
        ...foundation.artifactStore,
        retentionEvidence: undefined,
        networkPath: undefined,
        compatibility: { endpointShape: "cloudflare-r2" },
      },
    },
    { ...opts, expectedArtifactBackend: "cloudflare-r2" },
  ).join("\n");
  assert.match(errors, /cloudflare-r2: missing reviewed alternate artifact-store profile/);
});

test("PrivateLink topology requires VPC Lattice quota preflight", () => {
  const topology = privateLinkAwsTopology();
  const foundation = foundationFromTopology(topology);
  const withoutVpcLattice = {
    ...topology,
    foundation: {
      ...foundation,
      preflight: {
        ...foundation.preflight,
        quotas: foundation.preflight.quotas.filter((quota) => quota.service !== "vpc-lattice"),
      },
    },
  };
  assert.match(
    validateAwsTopologyEvidence(withoutVpcLattice, opts).join("\n"),
    /missing sufficient vpc-lattice quota/,
  );
});

test("foundation profile carries and live inspection checks S3 VPC endpoint identity", () => {
  const foundation = foundationFromTopology(privateLinkAwsTopology());
  assert.equal(foundation.network.s3VpcEndpoint.endpointId, "vpce-123");
  assert.match(
    validateAwsFoundationProfile(
      { ...foundation, network: { ...foundation.network, s3VpcEndpoint: {} } },
      { ...opts, expectedArtifactBackend: "aws-s3" },
    ).join("\n"),
    /S3 VPC endpoint identity or policy evidence/,
  );
  assert.match(
    fs.readFileSync(
      "build-tools/tools/deployments/cloud-control-aws-foundation-live-inspect.ts",
      "utf8",
    ),
    /describe-vpc-endpoints/,
  );
});

function moduleSource(): string {
  const moduleDir = "build-tools/deployments/aws-control-plane-foundation/opentofu";
  return fs
    .readdirSync(moduleDir)
    .filter((file) => file.endsWith(".tf"))
    .map((file) => fs.readFileSync(path.join(moduleDir, file), "utf8"))
    .join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
