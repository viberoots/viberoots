export function completeCloudflareEdge() {
  return {
    ...edgeSet(
      ["dnsProxy", "tlsMode", "wafRules", "bypass", "publicReachability", "callbackRoute"],
      "cf",
      "cloudflare-edge",
    ),
    identity: { accountId: "cf-account", zoneId: "zone-1", hostname: "deploy.example.test" },
  };
}

export function completeVercelEdge() {
  return {
    ...edgeSet(
      ["project", "domain", "edgeSettings", "callbackRoute"],
      "vercel",
      "vercel-operator-ui",
    ),
    identity: {
      teamId: "team-1",
      projectId: "operator-ui",
      domain: "deploy.example.test",
      environment: "production",
    },
  };
}

function edgeSet(fields: string[], prefix: string, capabilityId: string) {
  return {
    checkedAt: new Date().toISOString(),
    ...Object.fromEntries(
      fields.map((field) => [field, edgeEvidence(`${prefix}-${field}`, capabilityId)]),
    ),
  };
}

function edgeEvidence(id: string, capabilityId: string) {
  return {
    checkedAt: new Date().toISOString(),
    reviewedReference: `edge://${id}`,
    digest: "sha256:edge",
    owner: "platform-edge",
    capabilityId,
    hostname: "deploy.example.test",
    callbackHost: "deploy-auth.example.test",
    callbackPath: "/oidc/callback",
    originLoadBalancerArn:
      "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/cp/1",
  };
}
