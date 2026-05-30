#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import {
  capabilityEvidence,
  evidence,
  IMAGE_BUILD_IDENTITY,
  privateLinkAwsTopology,
  publicAwsTopology,
} from "./cloud-control-cutover-fixture";

type MutableAwsTopology = Record<string, unknown> & {
  privateSubnets: Array<Record<string, unknown>>;
  securityGroups: Record<string, Record<string, unknown>>;
  ingress: Record<string, unknown>;
};

const opts = {
  operation: "cutover" as const,
  expectedHostProfile: "aws-ec2",
  expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
  expectedRegion: "us-east-1",
  selectedCapabilities: ["aws-ec2-control-plane-host"],
  maxAgeMinutes: 60,
};
test("AWS cutover rejects wrong region and mismatched topology evidence", () => {
  const result = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        region: "us-west-2",
        privateSubnets: [{ ...mutableBaseAws().privateSubnets[0], vpcId: "vpc-other" }],
        securityGroups: {
          ...mutableBaseAws().securityGroups,
          service: { ...mutableBaseAws().securityGroups.service, vpcId: "vpc-other" },
        },
      },
    }),
    opts,
  );
  assert.match(result.errors.join("\n"), /region us-west-2 does not match/);
  assert.match(result.errors.join("\n"), /subnet evidence does not match selected VPC/);
  assert.match(result.errors.join("\n"), /security-group evidence does not match selected VPC/);
});

test("AWS cutover rejects missing S3 endpoint and PrivateLink validation", () => {
  const result = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        s3VpcEndpoint: {},
        database: { mode: "privatelink", privatelink: {} },
      },
    }),
    opts,
  );
  assert.match(result.errors.join("\n"), /missing AWS S3 VPC endpoint/);
  assert.match(result.errors.join("\n"), /missing Supabase PrivateLink/);
});

test("AWS cutover defaults omitted artifact backend to AWS S3 endpoint evidence", () => {
  const aws = { ...baseAws() } as Record<string, unknown>;
  delete aws.artifactBackend;
  delete aws.s3VpcEndpoint;
  const result = validateCloudControlCutover(evidence({ awsTopology: aws }), opts);
  assert.match(result.errors.join("\n"), /missing AWS S3 VPC endpoint/);
});

test("AWS cutover rejects invalid or unevidenced alternate artifact backends", () => {
  const invalid = validateCloudControlCutover(
    evidence({ awsTopology: { ...baseAws(), artifactBackend: "dashboard-bucket" } }),
    opts,
  );
  assert.match(invalid.errors.join("\n"), /unsupported AWS artifact backend dashboard-bucket/);
  const missingEvidence = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        artifactBackend: "s3-compatible",
        artifactBackendEvidence: { checkedAt: new Date().toISOString(), reviewedReference: "" },
      },
    }),
    opts,
  );
  assert.match(missingEvidence.errors.join("\n"), /missing reviewed alternate artifact/);
});

test("AWS cutover requires explicit public database connectivity proof", () => {
  const missing = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        database: { mode: "public", publicTls: "psql worked once" },
      },
    }),
    opts,
  );
  assert.match(missing.errors.join("\n"), /missing public database connectivity/);
  const valid = validateCloudControlCutover(
    evidence({
      awsTopology: publicAwsTopology(),
    }),
    opts,
  );
  assert.doesNotMatch(valid.errors.join("\n"), /public database connectivity/);
});

test("AWS cutover rejects missing and invalid database connectivity modes", () => {
  const missing = { ...baseAws() } as Record<string, unknown>;
  delete missing.database;
  assert.match(
    validateCloudControlCutover(evidence({ awsTopology: missing }), opts).errors.join("\n"),
    /connectivity mode <missing>/,
  );
  assert.match(
    validateCloudControlCutover(
      evidence({ awsTopology: { ...baseAws(), database: { mode: "yes" } } }),
      opts,
    ).errors.join("\n"),
    /connectivity mode yes/,
  );
});

test("AWS cutover rejects stale TLS DNS and ingress health", () => {
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const result = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        ingress: { ...mutableBaseAws().ingress, checkedAt: old },
      },
    }),
    opts,
  );
  assert.match(result.errors.join("\n"), /AWS ingress/);
});

test("selected Cloudflare and Vercel edge paths require matching evidence", () => {
  const result = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        selectedEdges: {
          cloudflare: { dnsProxy: true },
          vercel: { project: "operator-ui" },
        },
      },
    }),
    opts,
  );
  assert.match(result.errors.join("\n"), /structured reviewed evidence/);
  assert.match(result.errors.join("\n"), /Cloudflare edge evidence is missing or stale/);
  assert.match(result.errors.join("\n"), /Vercel edge domain evidence must be structured/);
});

test("adjacent atticd and remote build worker topology requires capability evidence", () => {
  const result = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        adjacentSystems: { atticd: true, remoteBuildWorkerFleet: true },
      },
      providerCapabilities: {
        "aws-ec2-control-plane-host": capabilityEvidence("aws-ec2-control-plane-host"),
      },
    }),
    opts,
  );
  assert.match(result.errors.join("\n"), /aws-attic-cache-service: missing provider-capability/);
  assert.match(result.errors.join("\n"), /remote-build-worker-fleet: missing provider-capability/);
});

test("AWS cutover derives required provider capabilities from selected topology", () => {
  const result = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        selectedEdges: { cloudflare: completeCloudflareEdge(), vercel: completeVercelEdge() },
        adjacentSystems: { atticd: true, remoteBuildWorkerFleet: true },
      },
      providerCapabilities: {},
    }),
    { ...opts, selectedCapabilities: [] },
  );
  const errors = result.errors.join("\n");
  for (const id of derivedCapabilityIds()) {
    assert.match(errors, new RegExp(`${id}: missing provider-capability`));
  }
});

test("AWS cutover accepts complete derived provider capabilities", () => {
  const result = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        selectedEdges: { cloudflare: completeCloudflareEdge(), vercel: completeVercelEdge() },
        adjacentSystems: { atticd: true, remoteBuildWorkerFleet: true },
      },
      providerCapabilities: Object.fromEntries(
        derivedCapabilityIds().map((id) => [id, capabilityEvidence(id)]),
      ),
    }),
    { ...opts, selectedCapabilities: [] },
  );
  assert.equal(result.ok, true, result.errors.join("\n"));
});

const baseAws = privateLinkAwsTopology;
const mutableBaseAws = () => baseAws() as MutableAwsTopology;

function completeCloudflareEdge() {
  return edgeSet(["dnsProxy", "tlsMode", "wafRules", "callbackRoute"], "cf");
}

function completeVercelEdge() {
  return edgeSet(["project", "domain", "edgeSettings", "callbackRoute"], "vercel");
}

function derivedCapabilityIds() {
  return [
    "aws-ec2-control-plane-host",
    "aws-network-foundation",
    "aws-ecr-control-plane-registry",
    "aws-s3-artifact-store",
    "supabase-managed-postgres",
    "supabase-privatelink-prerequisite",
    "cloudflare-edge",
    "vercel-operator-ui",
    "aws-attic-cache-service",
    "remote-build-worker-fleet",
  ];
}

function edgeSet(fields: string[], prefix: string) {
  return {
    checkedAt: new Date().toISOString(),
    ...Object.fromEntries(fields.map((field) => [field, edgeEvidence(`${prefix}-${field}`)])),
  };
}

function edgeEvidence(id: string) {
  return {
    checkedAt: new Date().toISOString(),
    reviewedReference: `edge://${id}`,
    digest: "sha256:edge",
  };
}
