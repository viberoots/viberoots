#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateCutoverProviderCapabilities } from "../../deployments/cloud-control-cutover-provider-capabilities";
import { validateProviderCapabilityEvidence } from "../../deployments/cloud-control-provider-capability-readiness";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { capabilityDeclaration } from "../../deployments/cloud-control-setup-contract";
import { ec2HostProfileInput } from "./cloud-control-aws-ec2-host-profile.fixture";
import { publicAwsTopology } from "./cloud-control-cutover-fixture";
import {
  completeCloudflareEdge,
  completeVercelEdge,
} from "./cloud-control-cutover-aws-edge.fixture";
import {
  PR33_CAPABILITIES,
  pr33Evidence,
  providerInputs,
  selfCertifiedWrongEdgeEvidence,
  selectedProviderTopology,
  validatePr33Payload,
} from "./cloud-control-remaining-capabilities.fixture";

test("remaining provider capabilities emit typed hook payloads instead of generic reviewed adapters", async () => {
  for (const id of PR33_CAPABILITIES) {
    const hook = await runHook(id, "evidence");
    assert.equal(hook.capabilityId, id);
    assert.equal(hook.hook.adapter, `typed-${id}`);
    assert.notEqual(hook.hook.adapter, id);
    assert.deepEqual(validatePr33Payload(id, hook.providerPayload as any), []);
  }
});

test("remaining provider payload validators reject capability-specific negative cases", () => {
  const cases: Array<[string, (payload: any) => void, RegExp]> = [
    ["aws-attic-cache-service", (p) => delete p.endpoint.identity, /endpoint identity/],
    ["aws-attic-cache-service", (p) => (p.cacheObject.get = false), /cache object get/],
    ["cloudflare-edge", (p) => delete p.cloudflare.zoneId, /Cloudflare zone/],
    [
      "cloudflare-edge",
      (p) => delete p.binding.originLoadBalancerArn,
      /origin does not match selected AWS ingress/,
    ],
    ["vercel-operator-ui", (p) => (p.posture.uiApiOnly = false), /UI\/API-only/],
    ["vercel-operator-ui", (p) => delete p.config.provenance, /config provenance/],
    ["remote-build-worker-fleet", (p) => (p.authority.buckSeparate = false), /buckSeparate/],
    [
      "remote-build-worker-fleet",
      (p) => (p.credentials.protectedRuntimeCredentialsReused = true),
      /must not be reused/,
    ],
  ];
  for (const [id, mutate, expected] of cases) {
    const payload = pr33Evidence(id);
    mutate(payload);
    assert.match(validatePr33Payload(id, payload).join("\n"), expected, id);
  }
});

test("remaining provider validators reject generic bad evidence rules", () => {
  const stale = pr33Evidence("cloudflare-edge");
  stale.checkedAt = "2020-01-01T00:00:00.000Z";
  assert.match(validatePr33Payload("cloudflare-edge", stale).join("\n"), /stale/);
  for (const [patch, expected] of [
    [{ schemaVersion: "wrong" }, /wrong payload schema/],
    [{ capabilityId: "wrong" }, /wrong payload capability/],
    [{ smoke: { passed: false } }, /smoke proof/],
    [{ rollback: { nonDestructive: false } }, /rollback proof/],
    [
      { ownership: { boundary: "raw-iac-only", allowsDirectMutation: false } },
      /ownership boundary/,
    ],
    [
      { ownership: { boundary: "reviewed-iac", allowsDirectMutation: true } },
      /direct provider mutation/,
    ],
    [
      {
        ownership: {
          boundary: "reviewed-iac",
          allowsDirectMutation: false,
          mutationCommands: ["wrangler deploy"],
        },
      },
      /mutation-command/,
    ],
  ] as Array<[Record<string, unknown>, RegExp]>) {
    const payload = { ...pr33Evidence("cloudflare-edge"), ...patch };
    assert.match(validatePr33Payload("cloudflare-edge", payload).join("\n"), expected);
  }
});

test("selected remaining provider capabilities fail closed in readiness and cutover", async () => {
  const id = "cloudflare-edge";
  const declaration = capabilityDeclaration(id);
  assert.match(
    validateProviderCapabilityEvidence([declaration], {}).join("\n"),
    /protected\/shared readiness requires hook evidence/,
  );
  const bad = await runHook(id, "evidence");
  bad.providerPayload = { ...(bad.providerPayload as any), schemaVersion: "wrong" };
  assert.match(
    validateProviderCapabilityEvidence([declaration], { [id]: bad }).join("\n"),
    /wrong payload schema/,
  );
  assert.match(
    validateCutoverProviderCapabilities({ providerCapabilities: {} } as any, [id]).join("\n"),
    /missing provider-capability/,
  );
});

test("Cloudflare and Vercel hook emission rejects wrong edge runtime binding", async () => {
  for (const id of ["cloudflare-edge", "vercel-operator-ui"]) {
    for (const [field, value, expected] of [
      ["hostname", "wrong.example.test", /hostname does not match runtime publicUrl/],
      ["callbackHost", "wrong-auth.example.test", /callback host does not match runtime config/],
      ["callbackPath", "/wrong", /callback path does not match runtime config/],
      [
        "originLoadBalancerArn",
        "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/wrong/1",
        /origin does not match selected AWS ingress/,
      ],
    ] as const) {
      const inputs = providerInputs(id) as any;
      inputs[id === "cloudflare-edge" ? "cloudflareEdgeEvidence" : "vercelOperatorUiEvidence"] = {
        ...pr33Evidence(id),
        binding: { ...(pr33Evidence(id).binding as any), [field]: value },
      };
      await assert.rejects(() => runHookWithInputs(id, inputs), expected, `${id} ${field}`);
    }
  }
});

test("Cloudflare and Vercel hook emission ignores self-certified runtime config", async () => {
  for (const id of ["cloudflare-edge", "vercel-operator-ui"]) {
    const evidenceKey =
      id === "cloudflare-edge" ? "cloudflareEdgeEvidence" : "vercelOperatorUiEvidence";
    await assert.rejects(
      () =>
        runHookWithInputs(id, {
          ...providerInputs(id),
          [evidenceKey]: selfCertifiedWrongEdgeEvidence(id),
        }),
      /hostname does not match runtime publicUrl.*callback host does not match runtime config.*origin does not match selected AWS ingress/s,
      `${id} self-certified runtime config`,
    );
  }
});

test("AWS-scoped remaining provider hook emission requires selected topology linkage", async () => {
  for (const id of ["aws-attic-cache-service", "remote-build-worker-fleet"]) {
    const evidenceKey =
      id === "aws-attic-cache-service" ? "awsAtticCacheEvidence" : "remoteBuildWorkerFleetEvidence";
    await assert.rejects(
      () => runHookWithInputs(id, { [evidenceKey]: pr33Evidence(id) }),
      /missing selected AWS topology evidence/,
      `${id} missing topology`,
    );
    await assert.rejects(
      () =>
        runHookWithInputs(id, {
          ...providerInputs(id),
          awsTopologyEvidence: publicAwsTopology({ accountId: "999999999999" }),
        }),
      /AWS account does not match selected topology/,
      `${id} wrong account`,
    );
    await assert.rejects(
      () =>
        runHookWithInputs(id, {
          ...providerInputs(id),
          awsTopologyEvidence: publicAwsTopology({ region: "us-west-2" }),
        }),
      /AWS region does not match selected topology/,
      `${id} wrong region`,
    );
  }
});

test("unselected remaining provider capabilities do not block readiness", () => {
  const selected = [capabilityDeclaration("aws-ec2-control-plane-host")];
  assert.doesNotMatch(
    validateProviderCapabilityEvidence(selected, {}).join("\n"),
    /cloudflare-edge|vercel-operator-ui|aws-attic-cache-service|remote-build-worker-fleet/,
  );
});

test("generated remaining provider commands use bundle-root evidence flags", () => {
  const bundle = renderCloudControlSetupBundle(
    ec2HostProfileInput({ awsTopology: selectedPr33Topology() as any }),
  );
  const capabilities = JSON.parse(bundle.files["provider-capabilities.json"]!);
  for (const id of PR33_CAPABILITIES) {
    const entry = capabilities.find((item: any) => item.id === id);
    assert.ok(entry, id);
    assert.match(entry.iac.evidenceCommand, new RegExp(flagFor(id)));
    assert.doesNotMatch(entry.iac.evidenceCommand, /build-tools\/tools\/tests/);
  }
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const runbook = JSON.stringify(commands);
  assert.match(runbook, /\$PROFILE_ROOT\/cloudflare-edge-evidence\.json/);
  assert.match(runbook, /\$PROFILE_ROOT\/vercel-operator-ui-evidence\.json/);
  assert.match(runbook, /\$PROFILE_ROOT\/aws-attic-cache-evidence\.json/);
  assert.match(runbook, /\$PROFILE_ROOT\/remote-build-worker-fleet-evidence\.json/);
});

async function runHook(id: string, phase: any) {
  return runHookWithInputs(id, providerInputs(id), phase);
}

async function runHookWithInputs(
  id: string,
  inputs: Record<string, unknown>,
  phase: any = "evidence",
) {
  return runCloudProviderCapabilityHook({
    capabilityId: id,
    phase,
    deploymentLabel: "//deployments:staging",
    ...(inputs as any),
  });
}

function flagFor(id: string): string {
  if (id === "aws-attic-cache-service") return "--aws-attic-cache-evidence";
  if (id === "cloudflare-edge") return "--cloudflare-edge-evidence";
  if (id === "vercel-operator-ui") return "--vercel-operator-ui-evidence";
  return "--remote-build-worker-fleet-evidence";
}

function selectedPr33Topology() {
  const topology = ec2HostProfileInput().awsTopology as any;
  return {
    ...topology,
    selectedEdges: {
      cloudflare: {
        ...completeCloudflareEdge(),
        identity: (selectedProviderTopology("cloudflare-edge") as any).selectedEdges.cloudflare
          .identity,
      },
      vercel: {
        ...completeVercelEdge(),
        identity: (selectedProviderTopology("vercel-operator-ui") as any).selectedEdges.vercel
          .identity,
      },
    },
    adjacentSystems: { atticd: true, remoteBuildWorkerFleet: true },
  };
}
