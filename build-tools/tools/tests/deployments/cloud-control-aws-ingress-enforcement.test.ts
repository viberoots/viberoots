#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { ingressEvidenceFromFoundationOutput } from "../../deployments/cloud-control-aws-ingress-foundation-output";
import { validateAwsTopologyEvidence } from "../../deployments/cloud-control-aws-topology-validate";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { ingressEvidence } from "./cloud-control-aws-ingress.fixture";
import {
  capabilityEvidence,
  evidence,
  IMAGE_BUILD_IDENTITY,
  privateLinkAwsTopology,
} from "./cloud-control-cutover-fixture";
import { completeCloudflareEdge } from "./cloud-control-cutover-aws-edge.fixture";

const topologyOpts = {
  expectedRegion: "us-east-1",
  expectedPublicUrl: "https://deploy.example.test",
  expectedAuthCallbackHost: "deploy-auth.example.test",
  expectedAuthCallbackPath: "/oidc/callback",
  maxAgeMinutes: 60,
};

const cutoverOpts = {
  operation: "cutover" as const,
  expectedHostProfile: "aws-ec2",
  expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
  expectedRegion: "us-east-1",
  selectedCapabilities: ["aws-ec2-control-plane-host"],
  maxAgeMinutes: 60,
};

test("foundation ingress output must carry validator-ready topology evidence", () => {
  assert.equal(ingressEvidenceFromFoundationOutput({ listener_arn: "listener-only" }), undefined);
  const topology = privateLinkAwsTopology() as any;
  const badFoundation = {
    ...topology.foundation,
    network: {
      ...topology.foundation.network,
      ingress: {
        ...topology.foundation.network.ingress,
        topologyEvidence: ingressEvidence({
          targetHealthEvidence: { ...ingressEvidence().targetHealthEvidence, status: "initial" },
        }),
      },
    },
  };
  assert.match(
    validateAwsTopologyEvidence({ ...topology, foundation: badFoundation }, topologyOpts).join(
      "\n",
    ),
    /foundation mapped ingress invalid: AWS ingress target health is not healthy/,
  );
});

test("ACM DNS validation proof is enforced through AWS topology validation", () => {
  const errors = validateAwsTopologyEvidence(
    privateLinkAwsTopology({
      ingress: ingressEvidence({
        certificate: { ...ingressEvidence().certificate, dnsValidation: undefined },
      }),
    }),
    topologyOpts,
  ).join("\n");
  assert.match(errors, /ACM DNS validation evidence missing digest/);
  assert.match(errors, /ACM certificate missing DNS validation proof/);
});

test("cutover requires runtime publicUrl to agree with latest deployment publicUrl", () => {
  const missing = validateCloudControlCutover(
    evidence({
      latestNonProductionDeployment: {
        ...evidence().latestNonProductionDeployment,
        publicUrl: undefined,
      },
    }),
    cutoverOpts,
  );
  assert.match(missing.errors.join("\n"), /latest deployment publicUrl evidence/);
  const result = validateCloudControlCutover(
    evidence({ runtimeConfig: { ...evidence().runtimeConfig, publicUrl: "https://wrong.test" } }),
    cutoverOpts,
  );
  assert.match(result.errors.join("\n"), /latest deployment publicUrl does not match runtime/);
});

test("selected edge evidence and provider payloads are bound to ingress identity", () => {
  const edge = completeCloudflareEdge() as any;
  edge.dnsProxy = { ...edge.dnsProxy, hostname: "wrong.example.test" };
  const edgeErrors = validateCloudControlCutover(
    evidence({
      awsTopology: {
        ...(privateLinkAwsTopology() as any),
        selectedEdges: { cloudflare: edge },
      },
      providerCapabilities: {
        "aws-ec2-control-plane-host": capabilityEvidence("aws-ec2-control-plane-host"),
        "aws-network-foundation": capabilityEvidence("aws-network-foundation"),
        "aws-ecr-control-plane-registry": capabilityEvidence("aws-ecr-control-plane-registry"),
        "aws-s3-artifact-store": capabilityEvidence("aws-s3-artifact-store"),
        "supabase-managed-postgres": capabilityEvidence("supabase-managed-postgres"),
        "supabase-privatelink-prerequisite": capabilityEvidence(
          "supabase-privatelink-prerequisite",
        ),
        "cloudflare-edge": capabilityEvidence("cloudflare-edge"),
      },
    }),
    { ...cutoverOpts, selectedCapabilities: [] },
  ).errors.join("\n");
  assert.match(edgeErrors, /Cloudflare edge dnsProxy hostname does not match/);

  const missingPayload = validateCloudControlCutover(
    evidence({
      providerCapabilities: {
        ...evidence().providerCapabilities,
        "aws-network-foundation": {
          ...capabilityEvidence("aws-network-foundation"),
          providerPayload: undefined,
        },
      },
    }),
    cutoverOpts,
  );
  assert.match(missingPayload.errors.join("\n"), /missing reviewed ingress provider payload/);
});
