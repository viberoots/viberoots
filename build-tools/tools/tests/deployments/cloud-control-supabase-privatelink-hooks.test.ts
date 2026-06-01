#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateProviderCapabilityHookEvidenceShape } from "../../deployments/cloud-control-provider-capability-hook-contract";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { validateCutoverProviderCapabilities } from "../../deployments/cloud-control-cutover-provider-capabilities";
import { maybeRunProviderCapabilityHookForCli } from "../../deployments/deploy-cli-provider-capability";
import { privateLinkAwsTopology } from "./cloud-control-aws-topology.fixture";
import { serviceNetworkAssociationEvidence } from "./cloud-control-supabase-privatelink.fixture";

test("Supabase PrivateLink hook emits support-mediated permission payload evidence", async () => {
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "supabase-privatelink-prerequisite",
    phase: "smoke",
    deploymentLabel: "//deployments:staging",
  });
  assert.equal(hook.hook.manualPrerequisite, true);
  assert.equal(hook.providerPayload?.schemaVersion, "supabase-privatelink-provider-payload@1");
  assert.deepEqual(
    validateCutoverProviderCapabilities(
      { providerCapabilities: { [hook.capabilityId]: hook } } as any,
      [hook.capabilityId],
    ),
    [],
  );
});

test("Supabase PrivateLink hook emits AWS-side automation evidence for every phase", async () => {
  for (const phase of [
    "preview",
    "apply",
    "evidence",
    "smoke",
    "rollback",
    "reviewed-import",
  ] as const) {
    const hook = await runCloudProviderCapabilityHook({
      capabilityId: "supabase-privatelink-prerequisite",
      phase,
      deploymentLabel: "//deployments:staging",
      awsTopologyEvidence: privateLinkAwsTopology() as any,
    });
    assert.equal(hook.hook.automated, true);
    assert.equal(hook.hook.manualPrerequisite, true);
    assert.equal(hook.providerPayload?.evidenceMode, "aws-side-automated");
    assert.equal((hook.providerPayload?.ram as any).ramShareStatus, "accepted");
    assert.ok(Array.isArray(hook.providerPayload?.mutationOutcomes));
    assert.deepEqual(
      validateProviderCapabilityHookEvidenceShape(hook.capabilityId, hook as any, {
        allowedPhases: [phase],
        expectedAwsTopology: privateLinkAwsTopology(),
      }),
      [],
    );
  }
});

test("Supabase PrivateLink hook records service-network association evidence", async () => {
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "supabase-privatelink-prerequisite",
    phase: "evidence",
    deploymentLabel: "//deployments:staging",
    awsTopologyEvidence: privateLinkAwsTopology({
      database: {
        mode: "privatelink",
        privatelink: serviceNetworkAssociationEvidence(),
      },
    }) as any,
  });
  assert.equal(
    (hook.providerPayload?.lattice as any).serviceNetworkAssociationId,
    "snra-privatelink123",
  );
  assert.deepEqual(
    validateProviderCapabilityHookEvidenceShape(hook.capabilityId, hook as any, {
      allowedPhases: ["evidence"],
      expectedAwsTopology: privateLinkAwsTopology({
        database: {
          mode: "privatelink",
          privatelink: serviceNetworkAssociationEvidence(),
        },
      }),
    }),
    [],
  );
});

test("Supabase PrivateLink provider CLI consumes topology evidence for automation", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "supabase-pl-provider-"));
  const oldArgv = process.argv;
  const oldLog = console.log;
  const output: string[] = [];
  try {
    const topology = path.join(tmp, "aws-topology-evidence.json");
    await fsp.writeFile(topology, JSON.stringify(privateLinkAwsTopology()), "utf8");
    console.log = (message?: unknown) => output.push(String(message));
    process.argv = [
      "node",
      "deploy",
      "--record",
      "--provider-capability",
      "supabase-privatelink-prerequisite",
      "--aws-topology-evidence",
      topology,
    ];
    assert.equal(
      await maybeRunProviderCapabilityHookForCli({ deployment: { label: "//d:s" } as any }),
      true,
    );
    const emitted = JSON.parse(output.join("\n"));
    assert.equal(emitted.providerPayload.evidenceMode, "aws-side-automated");
    assert.equal(emitted.providerPayload.awsApiInputsPresent, true);
  } finally {
    process.argv = oldArgv;
    console.log = oldLog;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("Supabase PrivateLink hook evidence rejects generic payloads and dashboard notes", async () => {
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "supabase-privatelink-prerequisite",
    phase: "smoke",
    deploymentLabel: "//deployments:staging",
  });
  const generic = { ...hook, providerPayload: undefined };
  assert.match(
    validateCutoverProviderCapabilities(
      { providerCapabilities: { [hook.capabilityId]: generic } } as any,
      [hook.capabilityId],
    ).join("\n"),
    /missing Supabase PrivateLink provider payload evidence/,
  );
  const dashboard = {
    ...hook,
    providerPayload: { ...hook.providerPayload, supportEvidenceRef: "dashboard-only approved" },
  };
  assert.match(
    validateCutoverProviderCapabilities(
      { providerCapabilities: { [hook.capabilityId]: dashboard } } as any,
      [hook.capabilityId],
    ).join("\n"),
    /dashboard/,
  );
});

test("Supabase PrivateLink hook evidence rejects mismatched automated evidence", async () => {
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "supabase-privatelink-prerequisite",
    phase: "evidence",
    deploymentLabel: "//deployments:staging",
    awsTopologyEvidence: privateLinkAwsTopology() as any,
  });
  const supportOnlyWithApiInputs = {
    ...hook,
    providerPayload: {
      schemaVersion: "supabase-privatelink-provider-payload@1",
      evidenceMode: "evidence-only",
      supportMediated: true,
      awsApiInputsPresent: true,
      supportEvidenceRef: "privatelink-request",
      ramPermissionEvidenceRef: "ram-acceptance-permission",
      latticePermissionEvidenceRef: "vpc-lattice-association-permission",
      privateDnsEvidenceRef: "private-dns-proof",
    },
  };
  assert.match(
    errors(supportOnlyWithApiInputs, privateLinkAwsTopology()),
    /cannot use support-only evidence/,
  );

  const wrongRam = {
    ...hook,
    providerPayload: {
      ...hook.providerPayload,
      ram: { ...(hook.providerPayload?.ram as any), ramShareArn: "arn:aws:ram:wrong" },
    },
  };
  assert.match(errors(wrongRam, privateLinkAwsTopology()), /RAM share ARN/);

  const wrongLattice = {
    ...hook,
    providerPayload: {
      ...hook.providerPayload,
      lattice: { ...(hook.providerPayload?.lattice as any), endpointId: "vpce-wrong" },
    },
  };
  assert.match(errors(wrongLattice, privateLinkAwsTopology()), /VPC Lattice association/);

  const selfConsistentWrongAccount = {
    ...hook,
    providerPayload: {
      ...hook.providerPayload,
      expected: { ...(hook.providerPayload?.expected as any), accountId: "000000000000" },
    },
  };
  assert.match(errors(selfConsistentWrongAccount, privateLinkAwsTopology()), /account/);

  const missingRoutePosture = {
    ...hook,
    providerPayload: { ...hook.providerPayload, routeSecurityGroupPosture: undefined },
  };
  assert.match(errors(missingRoutePosture, privateLinkAwsTopology()), /route\/security-group/);

  const wrongTcpRule = {
    ...hook,
    providerPayload: {
      ...hook.providerPayload,
      routeSecurityGroupPosture: {
        ...(hook.providerPayload?.routeSecurityGroupPosture as any),
        rule: {
          ...((hook.providerPayload?.routeSecurityGroupPosture as any).rule as any),
          protocol: "udp",
          port: 5433,
        },
      },
    },
  };
  assert.match(errors(wrongTcpRule, privateLinkAwsTopology()), /route\/security-group/);

  const stale = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const staleDnsPsql = {
    ...hook,
    providerPayload: {
      ...hook.providerPayload,
      privateDns: { ...(hook.providerPayload?.privateDns as any), checkedAt: stale },
      psql: { ...(hook.providerPayload?.psql as any), checkedAt: stale },
    },
  };
  assert.match(
    errors(staleDnsPsql, privateLinkAwsTopology()),
    /private DNS evidence is missing or stale/,
  );
  assert.match(errors(staleDnsPsql, privateLinkAwsTopology()), /psql proof is missing or stale/);
});

function errors(hook: unknown, awsTopology?: unknown): string {
  return validateCutoverProviderCapabilities(
    { awsTopology, providerCapabilities: { "supabase-privatelink-prerequisite": hook } } as any,
    ["supabase-privatelink-prerequisite"],
  ).join("\n");
}
