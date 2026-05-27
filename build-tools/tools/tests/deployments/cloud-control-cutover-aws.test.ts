#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { evidence, capabilityEvidence } from "./cloud-control-cutover-fixture";

const opts = {
  operation: "cutover" as const,
  expectedHostProfile: "aws-ec2",
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
        subnetVpcId: "vpc-other",
        securityGroupVpcId: "vpc-other",
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
        s3VpcEndpoint: { validated: false },
        supabasePrivatelink: { validated: false },
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
        artifactBackendEvidence: "dashboard says ok",
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
        databaseConnectivity: "public",
        publicDatabaseConnectivity: "psql worked once",
      },
    }),
    opts,
  );
  assert.match(missing.errors.join("\n"), /missing public database connectivity/);
  const valid = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        databaseConnectivity: "public",
        publicDatabaseConnectivity: {
          validated: true,
          tls: true,
          sourceHost: "aws-ec2-control-plane-host",
        },
      },
    }),
    opts,
  );
  assert.doesNotMatch(valid.errors.join("\n"), /public database connectivity/);
});

test("AWS cutover rejects missing and invalid database connectivity modes", () => {
  const missing = { ...baseAws() } as Record<string, unknown>;
  delete missing.databaseConnectivity;
  assert.match(
    validateCloudControlCutover(evidence({ awsTopology: missing }), opts).errors.join("\n"),
    /connectivity mode <missing>/,
  );
  assert.match(
    validateCloudControlCutover(
      evidence({ awsTopology: { ...baseAws(), databaseConnectivity: "yes" } }),
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
        albNlbHealth: { checkedAt: old },
        tlsHealth: { checkedAt: old },
        dnsHealth: { checkedAt: old },
      },
    }),
    opts,
  );
  assert.match(result.errors.join("\n"), /albNlbHealth/);
  assert.match(result.errors.join("\n"), /tlsHealth/);
  assert.match(result.errors.join("\n"), /dnsHealth/);
});

test("selected Cloudflare and Vercel edge paths require matching evidence", () => {
  const result = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        cloudflareEdgeSelected: true,
        cloudflareEdge: { dnsProxy: true },
        vercelEdgeSelected: true,
        vercelEdge: { project: "operator-ui" },
      },
    }),
    opts,
  );
  assert.match(result.errors.join("\n"), /missing Cloudflare edge tlsMode evidence/);
  assert.match(result.errors.join("\n"), /missing Vercel edge domain evidence/);
});

test("adjacent atticd and remote build worker topology requires capability evidence", () => {
  const result = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        atticdSelected: true,
        remoteBuildWorkerFleetSelected: true,
      },
      providerCapabilities: {
        "aws-ec2-control-plane-host": capabilityEvidence(),
      },
    }),
    opts,
  );
  assert.match(result.errors.join("\n"), /aws-attic-cache-service: missing adjacent-system/);
  assert.match(result.errors.join("\n"), /remote-build-worker-fleet: missing adjacent-system/);
});

test("AWS cutover derives required provider capabilities from selected topology", () => {
  const result = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        cloudflareEdgeSelected: true,
        cloudflareEdge: completeCloudflareEdge(),
        vercelEdgeSelected: true,
        vercelEdge: completeVercelEdge(),
        atticdSelected: true,
        remoteBuildWorkerFleetSelected: true,
      },
      providerCapabilities: {},
    }),
    { ...opts, selectedCapabilities: [] },
  );
  const errors = result.errors.join("\n");
  assert.match(errors, /aws-ec2-control-plane-host: missing provider-capability/);
  assert.match(errors, /aws-network-foundation: missing provider-capability/);
  assert.match(errors, /aws-s3-artifact-store: missing provider-capability/);
  assert.match(errors, /supabase-managed-postgres: missing provider-capability/);
  assert.match(errors, /supabase-privatelink-prerequisite: missing provider-capability/);
  assert.match(errors, /cloudflare-edge: missing provider-capability/);
  assert.match(errors, /vercel-operator-ui: missing provider-capability/);
  assert.match(errors, /aws-attic-cache-service: missing provider-capability/);
  assert.match(errors, /remote-build-worker-fleet: missing provider-capability/);
});

test("AWS cutover accepts complete derived provider capabilities", () => {
  const result = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...baseAws(),
        cloudflareEdgeSelected: true,
        cloudflareEdge: completeCloudflareEdge(),
        vercelEdgeSelected: true,
        vercelEdge: completeVercelEdge(),
        atticdSelected: true,
        remoteBuildWorkerFleetSelected: true,
      },
      providerCapabilities: {
        "aws-ec2-control-plane-host": capabilityEvidence(),
        "aws-network-foundation": capabilityEvidence(),
        "aws-s3-artifact-store": capabilityEvidence(),
        "supabase-managed-postgres": capabilityEvidence(),
        "supabase-privatelink-prerequisite": capabilityEvidence(),
        "cloudflare-edge": capabilityEvidence(),
        "vercel-operator-ui": capabilityEvidence(),
        "aws-attic-cache-service": capabilityEvidence(),
        "remote-build-worker-fleet": capabilityEvidence(),
      },
    }),
    { ...opts, selectedCapabilities: [] },
  );
  assert.equal(result.ok, true, result.errors.join("\n"));
});

function baseAws() {
  return evidence().awsTopology;
}

function completeCloudflareEdge() {
  return { dnsProxy: true, tlsMode: "full-strict", wafRules: true, callbackRoute: true };
}

function completeVercelEdge() {
  return {
    project: "operator-ui",
    domain: "deploy.example.test",
    edgeSettings: true,
    callbackRoute: true,
  };
}
