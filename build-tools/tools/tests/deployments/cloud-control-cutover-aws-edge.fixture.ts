export function completeCloudflareEdge() {
  return edgeSet(
    ["dnsProxy", "tlsMode", "wafRules", "bypass", "publicReachability", "callbackRoute"],
    "cf",
    "cloudflare-edge",
  );
}

export function completeVercelEdge() {
  return edgeSet(
    ["project", "domain", "edgeSettings", "callbackRoute"],
    "vercel",
    "vercel-operator-ui",
  );
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
