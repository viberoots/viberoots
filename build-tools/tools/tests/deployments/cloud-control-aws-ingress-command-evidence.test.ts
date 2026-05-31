#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { test } from "node:test";
import { validateIngressCommandEvidenceBundle } from "../../deployments/cloud-control-aws-ingress-command-evidence";
import { validateAwsTopologyEvidence } from "../../deployments/cloud-control-aws-topology-validate";
import { ingressCommandEvidence, ingressEvidence } from "./cloud-control-aws-ingress.fixture";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";

const opts = { maxAgeMinutes: 60, required: true };

test("generated ingress command evidence rejects weak DNS TLS health and callback proofs", () => {
  for (const [bundle, pattern] of [
    [
      ingressCommandEvidence({
        dns: command("dns", { resolved: true, publicResolution: ["203.0.113.10"] }),
      }),
      /selected ingress resolution|load balancer DNS/,
    ],
    [
      ingressCommandEvidence({
        tls: command("tls", {
          handshake: true,
          authorized: false,
          coverageMatchedPublicUrl: true,
          coverageMatchedCallbackHost: true,
          notBefore: "2025-01-01T00:00:00.000Z",
          notAfter: "2030-01-01T00:00:00.000Z",
        }),
      }),
      /verified handshake/,
    ],
    [
      ingressCommandEvidence({
        health: command("health", {
          readiness: { ok: true },
          targetHealthy: true,
          targetRegistrationBound: false,
          targetGroupArnDigest: digest("wrong"),
        }),
      }),
      /selected target registration|target group/,
    ],
    [
      ingressCommandEvidence({
        callback: command("callback", {
          status: 200,
          routeMatchesSelectedTargetGroup: true,
          observedTargetGroupArnDigest: digest("wrong"),
          callbackHostDigest: digest("deploy-auth.example.test"),
          callbackPath: "/oidc/callback",
        }),
      }),
      /target group/,
    ],
  ] as const) {
    assert.match(
      validateIngressCommandEvidenceBundle(topology(), bundle, opts).join("\n"),
      pattern,
    );
  }
});

test("public LB subnets validate through public reachability not private service subnets", () => {
  const errors = validateAwsTopologyEvidence(topology({ ingress: ingressEvidence() }), {
    maxAgeMinutes: 60,
    expectedRegion: "us-east-1",
    expectedPublicUrl: "https://deploy.example.test",
    expectedAuthCallbackHost: "deploy-auth.example.test",
    expectedAuthCallbackPath: "/oidc/callback",
  });
  assert.deepEqual(errors, []);
});

function topology(overrides: Record<string, unknown> = {}) {
  return privateLinkAwsTopology(overrides);
}

function command(collector: string, evidence: Record<string, unknown>) {
  return {
    schemaVersion: "cloud-control-ingress-command-evidence@1",
    checkedAt: new Date().toISOString(),
    source: "generated-runbook-command",
    collector,
    inputs: ["aws-topology-evidence.json", "config.yaml"],
    evidence: { ...evidence, proofDigest: "sha256:command" },
  };
}

function digest(value: string) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
