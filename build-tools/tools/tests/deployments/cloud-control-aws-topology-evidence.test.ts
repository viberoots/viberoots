#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { redactEvidenceValue } from "../../deployments/cloud-control-evidence-helpers";
import { validateAwsTopologyEvidence } from "../../deployments/cloud-control-aws-topology-validate";
import { privateLinkAwsTopology, publicAwsTopology } from "./cloud-control-cutover-fixture";

const opts = { expectedRegion: "us-east-1", maxAgeMinutes: 60 };

test("AWS topology schema accepts minimal public TLS and PrivateLink evidence", () => {
  assert.deepEqual(validateAwsTopologyEvidence(publicAwsTopology(), opts), []);
  assert.deepEqual(validateAwsTopologyEvidence(privateLinkAwsTopology(), opts), []);
});

test("AWS topology schema rejects booleans empty objects and unsupported modes", () => {
  assert.match(validateAwsTopologyEvidence(true, opts).join("\n"), /not literal true/);
  assert.match(validateAwsTopologyEvidence({}, opts).join("\n"), /missing or empty/);
  assert.match(
    validateAwsTopologyEvidence(publicAwsTopology({ database: { mode: "socket" } }), opts).join(
      "\n",
    ),
    /connectivity mode socket/,
  );
});

test("AWS topology schema rejects missing links wrong region and stale timestamps", () => {
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const topology = privateLinkAwsTopology({
    checkedAt: stale,
    region: "us-west-2",
    privateSubnets: [
      {
        checkedAt: new Date().toISOString(),
        id: "subnet-123",
        vpcId: "vpc-other",
        availabilityZone: "us-east-1a",
        routeTableId: "rtb-123",
      },
    ],
  });
  const errors = validateAwsTopologyEvidence(topology, opts).join("\n");
  assert.match(errors, /region us-west-2/);
  assert.match(errors, /missing or stale/);
  assert.match(errors, /subnet evidence does not match selected VPC/);
});

test("AWS topology schema enforces endpoint variants and required runtime fields", () => {
  const base = publicAwsTopology() as any;
  const topology = publicAwsTopology({
    s3VpcEndpoint: {
      checkedAt: new Date().toISOString(),
      type: "gateway",
      endpointId: "vpce-123",
      endpointPolicyDigest: "sha256:s3-endpoint-policy",
      bucket: "deployment-control-plane-artifacts",
      prefix: "control-plane/",
    },
    compute: {
      ...base.compute,
      mode: "lambda",
      processEvidence: { checkedAt: new Date().toISOString(), service: "", workers: [] },
    },
    ingress: { ...base.ingress, type: "api-gateway", callbackHost: "" },
    database: {
      mode: "public",
      publicTls: {
        checkedAt: new Date().toISOString(),
        sourceHost: "i-0abc1234",
        targetHost: "",
        tlsValidated: true,
        psqlProofDigest: "sha256:public-psql-proof",
      },
    },
  });
  const errors = validateAwsTopologyEvidence(topology, opts).join("\n");
  assert.match(errors, /gateway endpoint evidence missing route-table associations/);
  assert.match(errors, /unsupported compute mode/);
  assert.match(errors, /missing service process proof/);
  assert.match(errors, /missing worker process proof/);
  assert.match(errors, /callback route host does not match runtime auth-provider config/);
  assert.match(errors, /unsupported load balancer type/);
  assert.match(errors, /public database connectivity validation evidence/);
});

test("AWS topology schema ties support prerequisites to selected capabilities", () => {
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const errors = validateAwsTopologyEvidence(
    privateLinkAwsTopology({
      supportPrerequisites: [
        {
          checkedAt: new Date().toISOString(),
          capabilityId: "unselected-provider",
          evidenceRef: "support-case-1",
          status: "complete",
        },
        {
          checkedAt: stale,
          capabilityId: "supabase-privatelink-prerequisite",
          evidenceRef: "support-case-2",
          status: "unknown",
          rawTerraformState: { resources: ["aws_ram_resource_share"] },
          dashboardNotes: "dashboard-only support approval",
        },
      ],
    }),
    opts,
  ).join("\n");
  assert.match(errors, /capability unselected-provider is not selected/);
  assert.match(errors, /AWS support prerequisite 1 evidence is missing or stale/);
  assert.match(errors, /AWS support prerequisite 1 has unsupported status/);
  assert.match(errors, /rawTerraformState is not protected\/shared readiness evidence/);
  assert.match(errors, /dashboardNotes is not protected\/shared readiness evidence/);
});

test("AWS topology schema requires PrivateLink DNS or IP and digest evidence", () => {
  const base = privateLinkAwsTopology() as any;
  const topology = privateLinkAwsTopology({
    database: {
      mode: "privatelink",
      privatelink: {
        ...base.database.privatelink,
        endpointDnsNames: [],
        endpointIps: [],
        psqlProofDigest: "psql worked",
      },
    },
  });
  const errors = validateAwsTopologyEvidence(topology, opts).join("\n");
  assert.match(errors, /endpoint DNS or IP evidence/);
  assert.match(errors, /Supabase PrivateLink psql proof is missing or unsuccessful/);
});

test("AWS topology schema requires NAT gateway identity for NAT egress", () => {
  const topology = publicAwsTopology({
    egress: {
      checkedAt: new Date().toISOString(),
      mode: "nat-gateway",
      routeTableIds: ["rtb-123"],
    },
  });
  assert.match(
    validateAwsTopologyEvidence(topology, opts).join("\n"),
    /NAT gateway evidence missing NAT gateway identity/,
  );
});

test("AWS topology schema accepts interface S3 endpoint security-group associations", () => {
  const topology = publicAwsTopology({
    s3VpcEndpoint: {
      checkedAt: new Date().toISOString(),
      type: "interface",
      endpointId: "vpce-interface123",
      securityGroupIds: ["sg-s3"],
      endpointPolicyDigest: "sha256:s3-endpoint-policy",
      bucket: "deployment-control-plane-artifacts",
      prefix: "control-plane/",
    },
  });
  assert.deepEqual(validateAwsTopologyEvidence(topology, opts), []);
});

test("AWS topology schema rejects S3 endpoint associations outside selected topology", () => {
  const gateway = validateAwsTopologyEvidence(
    publicAwsTopology({
      s3VpcEndpoint: {
        checkedAt: new Date().toISOString(),
        type: "gateway",
        endpointId: "vpce-123",
        routeTableIds: ["rtb-unrelated"],
        endpointPolicyDigest: "sha256:s3-endpoint-policy",
        bucket: "deployment-control-plane-artifacts",
        prefix: "control-plane/",
      },
    }),
    opts,
  ).join("\n");
  assert.match(gateway, /route table rtb-unrelated is not selected/);
  assert.match(gateway, /missing selected private subnet route table rtb-123/);

  const endpoint = validateAwsTopologyEvidence(
    publicAwsTopology({
      s3VpcEndpoint: {
        checkedAt: new Date().toISOString(),
        type: "interface",
        endpointId: "vpce-interface123",
        securityGroupIds: ["sg-unrelated"],
        endpointPolicyDigest: "sha256:s3-endpoint-policy",
        bucket: "deployment-control-plane-artifacts",
        prefix: "control-plane/",
      },
    }),
    opts,
  ).join("\n");
  assert.match(endpoint, /security group sg-unrelated is not the selected S3 endpoint group/);
  assert.match(endpoint, /missing selected S3 endpoint security group/);
});

test("AWS topology schema rejects dashboard raw IaC and secret-looking content", () => {
  const dashboardOnly = validateAwsTopologyEvidence(
    privateLinkAwsTopology({
      dashboardNotes: "dashboard-only: looks green",
      rawIacEvidence: "raw IaC state says the route table exists",
      terraformState: { resources: [{ type: "aws_vpc_endpoint", id: "vpce-123" }] },
      iacState: { routeTables: ["rtb-123"] },
      supportTicket: "support ticket CASE-123 says PrivateLink is approved",
    }),
    opts,
  ).join("\n");
  assert.match(dashboardOnly, /dashboard\/raw-IaC notes/);
  assert.match(dashboardOnly, /not protected\/shared readiness evidence/);
  assert.match(dashboardOnly, /terraformState is not protected\/shared readiness evidence/);
  assert.match(dashboardOnly, /iacState is not protected\/shared readiness evidence/);
  assert.match(
    validateAwsTopologyEvidence(
      privateLinkAwsTopology({ commandOutput: "aws_secret_access_key=abcdef0123456789abcdef0123" }),
      opts,
    ).join("\n"),
    /secret material/,
  );
});

test("evidence redaction keeps diagnostics structured without leaking ARNs or hostnames", () => {
  const redacted = redactEvidenceValue({
    arn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/cp/1/2",
    host: "vpce-123.vpce.amazonaws.com",
    commandOutput: "psql host vpce-123.vpce.amazonaws.com finished",
  });
  const text = JSON.stringify(redacted);
  assert.match(text, /arn:aws:<redacted>/);
  assert.match(text, /<hostname:redacted>/);
  assert.doesNotMatch(text, /123456789012:listener/);
  assert.doesNotMatch(text, /vpce-123\.vpce\.amazonaws\.com/);
});
