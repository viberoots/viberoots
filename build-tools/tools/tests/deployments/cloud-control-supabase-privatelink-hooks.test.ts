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
import {
  privateLinkIacEvidence,
  serviceNetworkAssociationEvidence,
} from "./cloud-control-supabase-privatelink.fixture";

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

test("Supabase PrivateLink hook emits IaC and read-only evidence for every phase", async () => {
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
      supabasePrivateLinkIac: privateLinkIacEvidence(),
    });
    assert.equal(hook.hook.automated, true);
    assert.equal(hook.hook.manualPrerequisite, true);
    assert.equal(hook.providerPayload?.evidenceMode, "iac-reviewed");
    assert.equal((hook.providerPayload?.iac as any).plan.ram.ramShareStatus, "accepted");
    assert.equal((hook.providerPayload?.iac as any).readOnly.psql.success, true);
    assert.equal((hook.providerPayload as any).mutationOutcomes, undefined);
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
    supabasePrivateLinkIac: privateLinkIacEvidence(serviceNetworkAssociationEvidence()),
  });
  assert.equal(
    (hook.providerPayload?.iac as any).plan.lattice.serviceNetworkAssociationId,
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
    for (const [name, value] of Object.entries(privateLinkIacEvidence())) {
      await fsp.writeFile(
        path.join(tmp, `supabase-privatelink-${name}.json`),
        JSON.stringify(value),
        "utf8",
      );
    }
    console.log = (message?: unknown) => output.push(String(message));
    process.argv = [
      "node",
      "deploy",
      "--record",
      "--provider-capability",
      "supabase-privatelink-prerequisite",
      "--aws-topology-evidence",
      topology,
      "--supabase-privatelink-opentofu-plan",
      path.join(tmp, "supabase-privatelink-plan.json"),
      "--supabase-privatelink-opentofu-apply",
      path.join(tmp, "supabase-privatelink-apply.json"),
      "--supabase-privatelink-readonly-evidence",
      path.join(tmp, "supabase-privatelink-readOnly.json"),
    ];
    assert.equal(
      await maybeRunProviderCapabilityHookForCli({ deployment: { label: "//d:s" } as any }),
      true,
    );
    const emitted = JSON.parse(output.join("\n"));
    assert.equal(emitted.providerPayload.evidenceMode, "iac-reviewed");
    assert.equal(emitted.providerPayload.iac.orchestration, "reviewed-opentofu-artifacts");
  } finally {
    process.argv = oldArgv;
    console.log = oldLog;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("Supabase PrivateLink provider CLI fails closed when generated evidence files are missing", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "supabase-pl-provider-missing-"));
  const oldArgv = process.argv;
  try {
    const topology = path.join(tmp, "aws-topology-evidence.json");
    await fsp.writeFile(topology, JSON.stringify(privateLinkAwsTopology()), "utf8");
    process.argv = [
      "node",
      "deploy",
      "--record",
      "--provider-capability",
      "supabase-privatelink-prerequisite",
      "--aws-topology-evidence",
      topology,
      "--supabase-privatelink-opentofu-plan",
      path.join(tmp, "supabase-privatelink-opentofu-plan.json"),
      "--supabase-privatelink-opentofu-apply",
      path.join(tmp, "supabase-privatelink-opentofu-apply.json"),
      "--supabase-privatelink-readonly-evidence",
      path.join(tmp, "supabase-privatelink-readonly-evidence.json"),
    ];
    await assert.rejects(
      () => maybeRunProviderCapabilityHookForCli({ deployment: { label: "//d:s" } as any }),
      /ENOENT|no such file/,
    );
  } finally {
    process.argv = oldArgv;
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
