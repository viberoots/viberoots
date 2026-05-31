#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAwsTopologyEvidence } from "../../deployments/cloud-control-aws-topology-validate";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";
import { serviceNetworkAssociationEvidence } from "./cloud-control-supabase-privatelink.fixture";

const opts = { expectedRegion: "us-east-1", maxAgeMinutes: 60 };

test("Supabase PrivateLink topology accepts endpoint and service-network variants", () => {
  assert.deepEqual(validateAwsTopologyEvidence(privateLinkAwsTopology(), opts), []);
  assert.deepEqual(
    validateAwsTopologyEvidence(
      privateLinkAwsTopology({
        database: { mode: "privatelink", privatelink: serviceNetworkAssociationEvidence() },
      }),
      opts,
    ),
    [],
  );
});

test("Supabase PrivateLink topology requires project region availability and permissions", () => {
  const errors = errorsFor({
    supabaseProjectRef: "",
    supabaseRegion: "us-west-2",
    regionalAvailability: undefined,
    ramPermission: undefined,
    latticePermission: undefined,
  });
  assert.match(errors, /project ref/);
  assert.match(errors, /Supabase region does not match AWS region/);
  assert.match(errors, /regional availability/);
  assert.match(errors, /RAM acceptance permission/);
  assert.match(errors, /VPC Lattice wiring permission/);
});

test("Supabase PrivateLink topology requires private DNS and TCP 5432 rule proof", () => {
  const errors = errorsFor({
    privateDns: { checkedAt: new Date().toISOString(), enabled: false, vpcId: "vpc-123" },
    securityGroupRuleProof: {
      checkedAt: new Date().toISOString(),
      protocol: "tcp",
      port: 443,
      sourceSecurityGroupIds: ["sg-service"],
      destinationSecurityGroupId: "sg-other",
    },
  });
  assert.match(errors, /private DNS is not proven/);
  assert.match(errors, /private DNS missing hostname/);
  assert.match(errors, /TCP 5432/);
  assert.match(errors, /wrong endpoint security group/);
  assert.match(errors, /missing selected service\/worker source/);
});

test("Supabase PrivateLink topology validates top-level security-group identities", () => {
  const errors = errorsFor({
    endpointSecurityGroupId: "",
    serviceSecurityGroupId: "sg-other-service",
    workerSecurityGroupId: "sg-other-worker",
  });
  assert.match(errors, /missing Supabase PrivateLink endpoint security-group identity/);
  assert.match(errors, /service security-group identity does not match topology/);
  assert.match(errors, /worker security-group identity does not match topology/);
});

test("Supabase PrivateLink topology rejects public hostnames and premature public disablement", () => {
  const errors = errorsFor({
    databaseUrl: {
      checkedAt: new Date().toISOString(),
      hostname: "db.project-review.supabase.co",
      classification: "public",
    },
    publicConnectivity: { checkedAt: new Date().toISOString(), status: "disabled" },
  });
  assert.match(errors, /public Supabase database hostname/);
  assert.match(errors, /disabled before private-path clients passed/);
});

test("Supabase PrivateLink topology rejects stale evidence and secret material", () => {
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const errors = errorsFor({
    checkedAt: stale,
    commandOutput: "password=super-secret-value-1234567890",
  });
  assert.match(errors, /missing or stale/);
  assert.match(errors, /secret material/);
});

function errorsFor(overrides: Record<string, unknown>) {
  const base = privateLinkAwsTopology() as any;
  return validateAwsTopologyEvidence(
    privateLinkAwsTopology({
      database: {
        mode: "privatelink",
        privatelink: { ...base.database.privatelink, ...overrides },
      },
    }),
    opts,
  ).join("\n");
}
