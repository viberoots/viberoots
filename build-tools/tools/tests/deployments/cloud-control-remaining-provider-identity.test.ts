#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { publicAwsTopology } from "./cloud-control-cutover-fixture";
import {
  pr33Evidence,
  providerInputs,
  selectedProviderTopology,
} from "./cloud-control-remaining-capabilities.fixture";

test("Cloudflare and Vercel hook emission rejects missing selected provider identity", async () => {
  for (const [id, evidenceKey] of [
    ["cloudflare-edge", "cloudflareEdgeEvidence"],
    ["vercel-operator-ui", "vercelOperatorUiEvidence"],
  ] as const) {
    await assert.rejects(
      () =>
        runHookWithInputs(id, {
          ...providerInputs(id),
          awsTopologyEvidence: publicAwsTopology(),
          [evidenceKey]: pr33Evidence(id),
        }),
      /missing selected .* evidence/,
      `${id} missing selected identity`,
    );
  }
});

test("Cloudflare hook emission rejects wrong selected provider identity", async () => {
  await assert.rejects(
    () => runHookWithInputs("cloudflare-edge", cloudflareInputs({ accountId: "wrong-account" })),
    /Cloudflare account does not match selected evidence/,
  );
  await assert.rejects(
    () => runHookWithInputs("cloudflare-edge", cloudflareInputs({ zoneId: "wrong-zone" })),
    /Cloudflare zone does not match selected evidence/,
  );
  await assert.rejects(
    () =>
      runHookWithInputs("cloudflare-edge", {
        ...providerInputs("cloudflare-edge"),
        awsTopologyEvidence: selectedProviderTopologyWithIdentity("cloudflare-edge", {
          hostname: "selected-wrong.example.test",
        }),
      }),
    /Cloudflare hostname does not match selected evidence/,
  );
});

test("Vercel hook emission rejects wrong selected provider identity", async () => {
  for (const [patch, expected] of [
    [{ vercel: { teamId: "wrong-team" } }, /Vercel team does not match/],
    [{ vercel: { projectId: "wrong-project" } }, /Vercel project does not match/],
    [{ domain: { productionAlias: "wrong.example.test" } }, /Vercel domain does not match/],
    [{ vercel: { environment: "preview" } }, /Vercel environment does not match/],
  ] as Array<[Record<string, Record<string, string>>, RegExp]>) {
    await assert.rejects(
      () =>
        runHookWithInputs("vercel-operator-ui", {
          ...providerInputs("vercel-operator-ui"),
          vercelOperatorUiEvidence: patchedEvidence("vercel-operator-ui", patch),
        }),
      expected,
    );
  }
});

test("Vercel deployment ID remains provider-evidence presence-only", async () => {
  const hook = await runHookWithInputs("vercel-operator-ui", {
    ...providerInputs("vercel-operator-ui"),
    vercelOperatorUiEvidence: patchedEvidence("vercel-operator-ui", {
      vercel: { deploymentId: "dpl_provider_observed_after_selection" },
    }),
  });
  assert.equal(
    (hook.providerPayload as any).vercel.deploymentId,
    "dpl_provider_observed_after_selection",
  );
});

function cloudflareInputs(cloudflare: Record<string, string>) {
  return {
    ...providerInputs("cloudflare-edge"),
    cloudflareEdgeEvidence: patchedEvidence("cloudflare-edge", { cloudflare }),
  };
}

function patchedEvidence(id: string, patch: Record<string, Record<string, string>>) {
  const evidence = pr33Evidence(id);
  return Object.fromEntries(
    Object.entries(evidence).map(([key, value]) => [
      key,
      patch[key] ? { ...(value as Record<string, unknown>), ...patch[key] } : value,
    ]),
  );
}

function selectedProviderTopologyWithIdentity(id: string, identity: Record<string, string>) {
  const topology = selectedProviderTopology(id) as any;
  const key = id === "cloudflare-edge" ? "cloudflare" : "vercel";
  return {
    ...topology,
    selectedEdges: {
      ...topology.selectedEdges,
      [key]: {
        ...topology.selectedEdges[key],
        identity: { ...topology.selectedEdges[key].identity, ...identity },
      },
    },
  };
}

function runHookWithInputs(id: string, inputs: Record<string, unknown>) {
  return runCloudProviderCapabilityHook({
    capabilityId: id,
    phase: "evidence",
    deploymentLabel: "//deployments:staging",
    ...(inputs as any),
  });
}
