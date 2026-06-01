#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { validateCutoverProviderCapabilities } from "../../deployments/cloud-control-cutover-provider-capabilities";
import { validateProviderCapabilityRunbookOutput } from "../../deployments/cloud-control-runbook-provider-output";
import { privateLinkAwsTopology } from "./cloud-control-aws-topology.fixture";
import { privateLinkIacEvidence } from "./cloud-control-supabase-privatelink.fixture";

test("Supabase PrivateLink evidence rejects topology-only and direct mutation payloads", async () => {
  const hook = await privateLinkHook();
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
  assert.match(errors(supportOnlyWithApiInputs), /cannot use support-only evidence/);
  assert.match(errors(oldAutomated(hook)), /no longer accepted/);
  assert.match(errors(directMutation(hook)), /must not contain direct RAM/);
});

test("setup-doctor consumer rejects topology-only PrivateLink provider output", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "privatelink-setup-doctor-"));
  try {
    const hook = await privateLinkHook();
    await fsp.writeFile(
      path.join(tmp, "aws-topology-evidence.json"),
      JSON.stringify(privateLinkAwsTopology()),
    );
    await fsp.writeFile(
      path.join(tmp, "provider-capability-supabase-privatelink-prerequisite.json"),
      JSON.stringify(oldAutomated(hook)),
    );
    assert.match(
      (
        await validateProviderCapabilityRunbookOutput(
          tmp,
          "$PROFILE_ROOT/provider-capability-supabase-privatelink-prerequisite.json",
        )
      ).join("\n"),
      /no longer accepted/,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("Supabase PrivateLink IaC evidence rejects mismatched AWS-side proof", async () => {
  const hook = await privateLinkHook();
  const iac = hook.providerPayload?.iac as any;
  assert.match(
    errors(withReadOnly(hook, iac, { ram: { ramShareArn: "arn:aws:ram:wrong" } })),
    /RAM share ARN/,
  );
  assert.match(
    errors(withReadOnly(hook, iac, { lattice: { endpointId: "vpce-wrong" } })),
    /VPC Lattice association/,
  );
  assert.match(
    errors({
      ...hook,
      providerPayload: {
        ...hook.providerPayload,
        expected: { ...(hook.providerPayload?.expected as any), accountId: "000000000000" },
      },
    }),
    /account/,
  );
  assert.match(
    errors(withReadOnly(hook, iac, { routeSecurityGroupPosture: undefined })),
    /route\/security-group/,
  );
  assert.match(
    errors(withReadOnly(hook, iac, { routeSecurityGroupPosture: wrongRule(iac) })),
    /route\/security-group/,
  );
  const stale = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const staleEvidence = withReadOnly(hook, iac, {
    privateDns: { checkedAt: stale },
    psql: { checkedAt: stale },
  });
  assert.match(errors(staleEvidence), /private DNS evidence is missing or stale/);
  assert.match(errors(staleEvidence), /psql proof is missing or stale/);
});

test("Supabase PrivateLink IaC evidence rejects missing and invalid provenance digests", async () => {
  const hook = await privateLinkHook();
  const iac = hook.providerPayload?.iac as any;
  assert.match(errors(withIac(hook, { plan: { planDigest: undefined } })), /planDigest/);
  assert.match(errors(withIac(hook, { plan: { planDigest: "sha256:not-real" } })), /planDigest/);
  assert.match(errors(withIac(hook, { apply: { applyDigest: undefined } })), /applyDigest/);
  assert.match(errors(withIac(hook, { apply: { applyDigest: "sha256:not-real" } })), /applyDigest/);
  assert.match(
    errors(withIac(hook, { readOnly: { evidenceDigest: undefined } })),
    /evidenceDigest/,
  );
  assert.match(
    errors(withIac(hook, { readOnly: { evidenceDigest: "sha256:not-real" } })),
    /evidenceDigest/,
  );
  assert.match(
    errors(withIac(hook, { apply: { planDigest: `sha256:${"4".repeat(64)}` } })),
    /plan digest does not match reviewed plan/,
  );
  assert.match(
    errors(withIac(hook, { apply: { applyDigest: iac.apply.planDigest } })),
    /apply digest must be distinct/,
  );
  assert.match(
    errors(withIac(hook, { readOnly: { evidenceDigest: iac.apply.applyDigest } })),
    /read-only evidence digest must be distinct/,
  );
});

async function privateLinkHook() {
  return runCloudProviderCapabilityHook({
    capabilityId: "supabase-privatelink-prerequisite",
    phase: "evidence",
    deploymentLabel: "//deployments:staging",
    awsTopologyEvidence: privateLinkAwsTopology() as any,
    supabasePrivateLinkIac: privateLinkIacEvidence(),
  });
}

function oldAutomated(hook: any) {
  return {
    ...hook,
    providerPayload: {
      schemaVersion: "supabase-privatelink-provider-payload@1",
      evidenceMode: "aws-side-automated",
      supportMediated: true,
      supportEvidenceRef: "privatelink-request",
      mutationOutcomes: [{ action: "ram-share-acceptance", status: "accepted" }],
    },
  };
}

function directMutation(hook: any) {
  return {
    ...hook,
    providerPayload: {
      ...hook.providerPayload,
      provisioningCommands: ["aws ram accept-resource-share-invitation --arn arn"],
    },
  };
}

function withReadOnly(hook: any, iac: any, overrides: Record<string, any>) {
  return {
    ...hook,
    providerPayload: {
      ...hook.providerPayload,
      iac: { ...iac, readOnly: mergeReadOnly(iac.readOnly, overrides) },
    },
  };
}

function withIac(hook: any, overrides: Record<string, Record<string, any>>) {
  const iac = hook.providerPayload?.iac as any;
  return {
    ...hook,
    providerPayload: {
      ...hook.providerPayload,
      iac: {
        ...iac,
        plan: { ...iac.plan, ...overrides.plan },
        apply: { ...iac.apply, ...overrides.apply },
        readOnly: { ...iac.readOnly, ...overrides.readOnly },
      },
    },
  };
}

function mergeReadOnly(readOnly: any, overrides: Record<string, any>) {
  return Object.fromEntries(
    Object.entries({ ...readOnly, ...overrides }).map(([key, value]) => [
      key,
      value && typeof value === "object" ? { ...(readOnly[key] || {}), ...value } : value,
    ]),
  );
}

function wrongRule(iac: any) {
  return {
    ...iac.readOnly.routeSecurityGroupPosture,
    rule: { ...iac.readOnly.routeSecurityGroupPosture.rule, protocol: "udp", port: 5433 },
  };
}

function errors(hook: unknown): string {
  return validateCutoverProviderCapabilities(
    {
      awsTopology: privateLinkAwsTopology(),
      providerCapabilities: { "supabase-privatelink-prerequisite": hook },
    } as any,
    ["supabase-privatelink-prerequisite"],
  ).join("\n");
}
