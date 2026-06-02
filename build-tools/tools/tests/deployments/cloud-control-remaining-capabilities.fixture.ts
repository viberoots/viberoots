import { publicAwsTopology } from "./cloud-control-cutover-fixture";
import { validateRemainingProviderCapabilityPayload } from "../../deployments/cloud-control-remaining-capability-validation";

export const PR33_CAPABILITIES = [
  "aws-attic-cache-service",
  "cloudflare-edge",
  "vercel-operator-ui",
  "remote-build-worker-fleet",
] as const;

export function pr33Evidence(id: string): Record<string, unknown> {
  const common = {
    capabilityId: id,
    checkedAt: new Date().toISOString(),
    ownership: {
      boundary: id === "cloudflare-edge" ? "provider-owned-reviewed" : "reviewed-iac",
      reviewedReference: `iac://${id}`,
      allowsDirectMutation: false,
      mutationCommands: [],
    },
    smoke: { passed: true, heartbeat: true },
    rollback: { nonDestructive: true, previousTarget: "previous-reviewed-target" },
  };
  if (id === "aws-attic-cache-service") return { ...common, ...attic() };
  if (id === "cloudflare-edge") return { ...common, ...cloudflare() };
  if (id === "vercel-operator-ui") return { ...common, ...vercel() };
  return { ...common, ...fleet() };
}

export function providerInputs(id: string): Record<string, unknown> {
  if (id === "aws-attic-cache-service") {
    return { awsTopologyEvidence: publicAwsTopology(), awsAtticCacheEvidence: pr33Evidence(id) };
  }
  if (id === "cloudflare-edge") {
    return {
      awsTopologyEvidence: selectedProviderTopology("cloudflare-edge"),
      cloudflareEdgeEvidence: pr33Evidence(id),
    };
  }
  if (id === "vercel-operator-ui") {
    return {
      awsTopologyEvidence: selectedProviderTopology("vercel-operator-ui"),
      vercelOperatorUiEvidence: pr33Evidence(id),
    };
  }
  return {
    awsTopologyEvidence: publicAwsTopology(),
    remoteBuildWorkerFleetEvidence: pr33Evidence(id),
  };
}

export function selfCertifiedWrongEdgeEvidence(id: string): Record<string, unknown> {
  const binding = {
    ...(pr33Evidence(id).binding as Record<string, unknown>),
    hostname: "wrong.example.test",
    callbackHost: "wrong-auth.example.test",
    originLoadBalancerArn:
      "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/wrong/1",
  };
  return {
    ...pr33Evidence(id),
    binding,
    runtimeConfig: {
      publicUrl: "https://wrong.example.test",
      authProvider: {
        callback: { externalHost: "wrong-auth.example.test", externalPath: "/oidc/callback" },
      },
    },
  };
}

export function validatePr33Payload(id: string, payload: Record<string, unknown>) {
  return validateRemainingProviderCapabilityPayload(id, payload, {
    awsTopology: selectedProviderTopology(id),
  });
}

export function selectedProviderTopology(id: string): Record<string, unknown> {
  if (id === "cloudflare-edge") {
    return publicAwsTopology({ selectedEdges: { cloudflare: { identity: cloudflareIdentity() } } });
  }
  if (id === "vercel-operator-ui") {
    return publicAwsTopology({ selectedEdges: { vercel: { identity: vercelIdentity() } } });
  }
  return publicAwsTopology();
}

function attic() {
  return {
    schemaVersion: "aws-attic-cache-service-evidence@1",
    aws: { accountId: "123456789012", region: "us-east-1" },
    endpoint: { identity: "attic-prod-cache", url: "https://attic.example.test" },
    health: { atticdReady: true },
    cacheObject: { put: true, get: true, metadata: true, digestVerified: true },
    tokenScope: { cacheScoped: true, leastPrivilege: true },
  };
}

function cloudflare() {
  return {
    schemaVersion: "cloudflare-edge-evidence@1",
    cloudflare: { accountId: "cf-account", zoneId: "zone-1", zoneName: "example.test" },
    dns: { recordName: "deploy.example.test", target: "alb.example.test", proxied: true },
    tls: { mode: "full-strict", certificateStatus: "active" },
    waf: { selected: true, rulesetStatus: "active", rateLimitStatus: "active" },
    binding: edgeBinding(),
  };
}

function cloudflareIdentity() {
  return { accountId: "cf-account", zoneId: "zone-1", hostname: "deploy.example.test" };
}

function vercel() {
  return {
    schemaVersion: "vercel-operator-ui-evidence@1",
    vercel: {
      teamId: "team-1",
      projectId: "operator-ui",
      deploymentId: "dpl_1",
      environment: "production",
    },
    domain: { productionAlias: "deploy.example.test", bound: true },
    config: { provenance: "reviewed-env-digest", digest: "sha256:config" },
    posture: { readOnly: true, uiApiOnly: true },
    binding: edgeBinding(),
  };
}

function vercelIdentity() {
  return {
    teamId: "team-1",
    projectId: "operator-ui",
    domain: "deploy.example.test",
    environment: "production",
  };
}

function fleet() {
  return {
    schemaVersion: "remote-build-worker-fleet-evidence@1",
    aws: { accountId: "123456789012", region: "us-east-1" },
    fleet: { fleetId: "linux-spot-builders" },
    authority: { buckSeparate: true, nixSeparate: true, notDeploymentScheduler: true },
    network: { allowedBoundary: "build-vpc-private-subnets" },
    scaling: { registrationProven: true, autoscalingPolicyReviewed: true },
    credentials: { protectedRuntimeCredentialsReused: false },
  };
}

function edgeBinding() {
  return {
    schemaVersion: "edge-ingress-provider-payload@1",
    hostname: "deploy.example.test",
    callbackHost: "deploy-auth.example.test",
    callbackPath: "/oidc/callback",
    originLoadBalancerArn:
      "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/cp/1",
  };
}
