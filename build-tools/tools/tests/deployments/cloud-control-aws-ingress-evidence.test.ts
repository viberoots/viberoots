#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { ingressEvidenceFromFoundationOutput } from "../../deployments/cloud-control-aws-ingress-foundation-output";
import { validateAwsTopologyEvidence } from "../../deployments/cloud-control-aws-topology-validate";
import { privateLinkAwsTopology, publicAwsTopology } from "./cloud-control-cutover-fixture";
import { ingressEvidence } from "./cloud-control-aws-ingress.fixture";

const opts = {
  expectedRegion: "us-east-1",
  expectedPublicUrl: "https://deploy.example.test",
  expectedAuthCallbackHost: "deploy-auth.example.test",
  expectedAuthCallbackPath: "/oidc/callback",
  maxAgeMinutes: 60,
};

test("AWS ingress validates ALB and NLB evidence variants", () => {
  assert.deepEqual(validateAwsTopologyEvidence(privateLinkAwsTopology(), opts), []);
  assert.deepEqual(
    validateAwsTopologyEvidence(publicAwsTopology({ ingress: nlbIngress() }), opts),
    [],
  );
});

test("AWS ingress maps OpenTofu foundation output into topology evidence shape", () => {
  const mapped = ingressEvidenceFromFoundationOutput({
    topology_evidence: ingressEvidence({
      targetRegistration: { ...base().targetRegistration, instanceId: "i-0abc1234" },
    }),
  });
  assert.equal(mapped?.loadBalancer?.arn, base().loadBalancer.arn);
  assert.equal(mapped?.targetRegistration?.instanceId, "i-0abc1234");
  assert.equal(mapped?.callbackRoute?.targetGroupArn, base().targetGroupArn);
});

test("AWS ingress fails closed when foundation target attachment is missing", () => {
  const topology = privateLinkAwsTopology() as any;
  const result = validateAwsTopologyEvidence(
    {
      ...topology,
      foundation: {
        ...topology.foundation,
        network: {
          ...topology.foundation.network,
          ingress: { ...topology.foundation.network.ingress, targetAttachmentId: "" },
        },
      },
    },
    opts,
  );
  assert.match(result.join("\n"), /target attachment evidence/);
});

test("AWS ingress fails closed for linkage target health and host-profile binding drift", () => {
  for (const [topology, pattern] of [
    [withIngress({ listener: { ...base().listener, vpcId: "vpc-other" } }), /listener VPC/],
    [
      withIngress({ targetGroup: { ...base().targetGroup, listenerArn: "listener-wrong" } }),
      /selected listener/,
    ],
    [
      withIngress({ targetRegistration: { ...base().targetRegistration, instanceId: "i-wrong" } }),
      /selected EC2 instance/,
    ],
    [
      withIngress({
        targetRegistration: { ...base().targetRegistration, imageDigest: "sha256:wrong" },
      }),
      /imageDigest/,
    ],
    [
      withIngress({ targetHealthEvidence: { ...base().targetHealthEvidence, status: "draining" } }),
      /not healthy/,
    ],
    [
      withIngress({
        targetGroup: {
          ...base().targetGroup,
          healthCheck: { ...base().targetGroup.healthCheck, path: "/healthz" },
        },
      }),
      /readiness path/,
    ],
  ] as const) {
    assert.match(validateAwsTopologyEvidence(topology, opts).join("\n"), pattern);
  }
});

test("AWS ingress fails closed for certificate DNS HTTP and callback routing drift", () => {
  for (const [topology, pattern] of [
    [
      withIngress({ certificate: { ...base().certificate, status: "PENDING_VALIDATION" } }),
      /not issued/,
    ],
    [
      withIngress({
        certificate: { ...base().certificate, subjectAlternativeNames: ["deploy.example.test"] },
      }),
      /authCallbackHost/,
    ],
    [
      withIngress({ dns: { ...base().dns, targetLoadBalancerArn: "lb-wrong" } }),
      /selected load balancer/,
    ],
    [withIngress({ tlsPolicy: "ELBSecurityPolicy-2016-08" }), /TLS policy/],
    [withIngress({ listener: { ...base().listener, protocol: "HTTP" } }), /HTTP-to-HTTPS redirect/],
    [
      withIngress({ callbackRoute: { ...base().callbackRoute, targetGroupArn: "tg-wrong" } }),
      /callback route/,
    ],
  ] as const) {
    assert.match(validateAwsTopologyEvidence(topology, opts).join("\n"), pattern);
  }
});

test("AWS ingress fails closed for public reachability security path and imported evidence drift", () => {
  for (const [topology, pattern] of [
    [withIngress({ loadBalancer: { ...base().loadBalancer, scheme: "internal" } }), /not public/],
    [
      withIngress({ accessControl: { ...base().accessControl, directPublicServiceIngress: true } }),
      /direct public ingress/,
    ],
    [
      withIngress({
        accessControl: { ...base().accessControl, approvedClientCidrs: [], waf: undefined },
      }),
      /not limited/,
    ],
    [
      withIngress({ externalEvidence: imported({ capabilityId: "cloudflare-edge" }) }),
      /wrong capability/,
    ],
    [
      withIngress({
        externalEvidence: imported({
          drift: {
            checkedAt: new Date().toISOString(),
            status: "dirty",
            diffDigest: "sha256:dirty",
          },
        }),
      }),
      /drift/,
    ],
  ] as const) {
    assert.match(validateAwsTopologyEvidence(topology, opts).join("\n"), pattern);
  }
});

function withIngress(overrides: Record<string, unknown>) {
  return privateLinkAwsTopology({ ingress: ingressEvidence(overrides) });
}

function base(): any {
  return ingressEvidence();
}

function nlbIngress() {
  return ingressEvidence({
    type: "nlb",
    listener: { ...base().listener, protocol: "TLS" },
    targetGroup: {
      ...base().targetGroup,
      protocol: "TCP",
      healthCheck: {
        checkedAt: new Date().toISOString(),
        protocol: "TCP",
        port: "traffic-port",
        readinessPath: "/readyz",
        proofDigest: "sha256:tcp-health",
      },
    },
  });
}

function imported(overrides: Record<string, unknown> = {}) {
  return {
    checkedAt: new Date().toISOString(),
    reviewedReference: "docs/cloud-control-cutover.md#imported-ingress",
    digest: "sha256:imported",
    owner: "platform",
    capabilityId: "aws-network-foundation",
    accountId: "123456789012",
    region: "us-east-1",
    vpcId: "vpc-123",
    loadBalancerArn: base().loadBalancer.arn,
    drift: { checkedAt: new Date().toISOString(), status: "in-sync", diffDigest: "sha256:drift" },
    ...overrides,
  };
}
