#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAwsFoundationProfile } from "../../deployments/cloud-control-aws-foundation-profile";
import {
  foundationFromTopology,
  privateLinkAwsTopology,
  publicAwsTopology,
} from "./cloud-control-cutover-fixture";

const opts = {
  maxAgeMinutes: 60,
  expectedRegion: "us-east-1",
  expectedAccountId: "123456789012",
  expectedArtifactBackend: "aws-s3" as const,
};

test("AWS foundation profile validates generated create and existing VPC import modes", () => {
  const create = foundationFromTopology(publicAwsTopology());
  const imported = foundationFromTopology(publicAwsTopology(), "import");
  assert.deepEqual(validateAwsFoundationProfile(create, opts), []);
  assert.deepEqual(validateAwsFoundationProfile(imported, opts), []);
  assert.equal(imported.network.vpc.mode, "import");
  assert.deepEqual(imported.capabilityIds, ["aws-network-foundation", "aws-s3-artifact-store"]);
});

test("AWS foundation profile rejects unsafe state drift cost quota and tag posture", () => {
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const foundation = foundationFromTopology(publicAwsTopology());
  const errors = validateAwsFoundationProfile(
    {
      ...foundation,
      tags: { ...foundation.tags, owner: "" },
      state: {
        ...foundation.state,
        encrypted: false,
        lock: "",
        drift: { checkedAt: stale, status: "dirty", diffDigest: "drift" },
      },
      preflight: {
        ...foundation.preflight,
        quotas: [{ service: "ec2", required: 5, available: 1 }],
        costEstimate: { checkedAt: stale, monthlyUsd: 250, approvedRef: "" },
      },
    },
    opts,
  ).join("\n");
  assert.match(errors, /state must be encrypted/);
  assert.match(errors, /state lock is missing/);
  assert.match(errors, /drift evidence is missing, stale, or not clean/);
  assert.match(errors, /mandatory tag owner is missing/);
  assert.match(errors, /quota preflight missing sufficient vpc-endpoints/);
  assert.match(errors, /cost estimate evidence is missing or stale/);
});

test("AWS foundation profile rejects weak network IAM and artifact durability evidence", () => {
  const foundation = foundationFromTopology(privateLinkAwsTopology());
  const errors = validateAwsFoundationProfile(
    {
      ...foundation,
      network: {
        ...foundation.network,
        privateSubnetIds: ["subnet-123"],
        availabilityZones: ["us-east-1a"],
        outboundHttpsTargets: ["registry"],
      },
      iam: {
        roles: { ...foundation.iam.roles, providerHook: "" },
        policies: [{ name: "too-broad", digest: "", leastPrivilege: false, actions: ["*"] }],
      },
      artifactStore: {
        ...foundation.artifactStore,
        publicAccessBlock: false,
        versioning: false,
        lifecycle: false,
        immutablePrefix: false,
      },
    },
    opts,
  ).join("\n");
  assert.match(errors, /private subnets in at least two Availability Zones/);
  assert.match(errors, /egress policy missing infisical/);
  assert.match(errors, /IAM role providerHook is missing/);
  assert.match(errors, /IAM policy too-broad is over-broad/);
  assert.match(errors, /public-access block evidence is missing/);
  assert.match(errors, /versioning evidence is missing/);
  assert.match(errors, /lifecycle evidence is missing/);
  assert.match(errors, /immutable prefix policy is missing/);
});

test("AWS foundation profile rejects wildcard IAM service actions", () => {
  const foundation = foundationFromTopology(privateLinkAwsTopology());
  const errors = validateAwsFoundationProfile(
    {
      ...foundation,
      iam: {
        ...foundation.iam,
        policies: [
          {
            name: "wildcard-service-read",
            digest: "sha256:wildcard-service-read",
            leastPrivilege: true,
            actions: ["ec2:Describe*", "iam:GetRole"],
          },
        ],
      },
    },
    opts,
  ).join("\n");
  assert.match(errors, /IAM policy wildcard-service-read is over-broad/);
});

test("alternate artifact-store foundation profiles require reviewed compatibility evidence", () => {
  const topology = privateLinkAwsTopology({
    artifactBackend: "cloudflare-r2",
    s3VpcEndpoint: undefined,
    artifactBackendEvidence: {
      checkedAt: new Date().toISOString(),
      reviewedReference: "reviewed-r2-profile",
      digest: "sha256:r2-profile",
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
  assert.match(
    validateAwsFoundationProfile(
      { ...foundation, artifactStore: { ...foundation.artifactStore, compatibility: {} } },
      { ...opts, expectedArtifactBackend: "cloudflare-r2" },
    ).join("\n"),
    /cloudflare-r2: missing reviewed alternate artifact-store profile/,
  );
});
