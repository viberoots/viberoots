import * as crypto from "node:crypto";

const IMAGE_DIGEST = `sha256:${"a".repeat(64)}`;
const LB_ARN = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/cp/1";
const LISTENER_ARN = "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/cp/1/2";
const TARGET_GROUP_ARN = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/cp/1";
const CERT_ARN = "arn:aws:acm:us-east-1:123456789012:certificate/cert-123";

export function ingressEvidence(overrides: Record<string, unknown> = {}) {
  return {
    checkedAt: freshCheckedAt(),
    type: "alb",
    publicUrl: "https://deploy.example.test",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    listenerArn: LISTENER_ARN,
    targetGroupArn: TARGET_GROUP_ARN,
    targetHealth: "healthy",
    certificateArn: CERT_ARN,
    tlsPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
    dnsRecord: "deploy.example.test",
    callbackHost: "deploy-auth.example.test",
    loadBalancer: {
      checkedAt: freshCheckedAt(),
      arn: LB_ARN,
      dnsName: "cp-123.us-east-1.elb.amazonaws.com",
      scheme: "internet-facing",
      vpcId: "vpc-123",
      subnetIds: ["subnet-public-123", "subnet-public-456"],
      securityGroupIds: ["sg-alb"],
      publicReachability: {
        checkedAt: freshCheckedAt(),
        path: "aws-public-lb",
        publicSubnets: ["subnet-public-123", "subnet-public-456"],
        routeTableIds: ["rtb-public-123"],
        internetGatewayId: "igw-123",
        publicVantagePoint: "public-dns-fixture",
        resolvedTarget: "cp-123.us-east-1.elb.amazonaws.com",
      },
    },
    listener: listener(),
    targetGroup: targetGroup(),
    targetRegistration: targetRegistration(),
    targetHealthEvidence: {
      checkedAt: freshCheckedAt(),
      status: "healthy",
      targetId: "i-0abc1234",
      port: 7780,
      serviceProcess: "pid:100",
    },
    certificate: certificate(),
    dns: dnsEvidence(),
    accessControl: accessControl(),
    callbackRoute: callbackRoute(),
    ...overrides,
  };
}

function listener() {
  return {
    checkedAt: freshCheckedAt(),
    arn: LISTENER_ARN,
    loadBalancerArn: LB_ARN,
    vpcId: "vpc-123",
    protocol: "HTTPS",
    port: 443,
    tlsPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
    certificateArn: CERT_ARN,
  };
}

function targetGroup() {
  return {
    checkedAt: freshCheckedAt(),
    arn: TARGET_GROUP_ARN,
    listenerArn: LISTENER_ARN,
    loadBalancerArn: LB_ARN,
    vpcId: "vpc-123",
    protocol: "HTTP",
    port: 7780,
    healthCheck: {
      checkedAt: freshCheckedAt(),
      protocol: "HTTP",
      port: "traffic-port",
      path: "/readyz",
      matcher: "200",
      readinessPath: "/readyz",
      proofDigest: "sha256:target-health-check",
    },
  };
}

function targetRegistration() {
  return {
    checkedAt: freshCheckedAt(),
    targetId: "i-0abc1234",
    instanceId: "i-0abc1234",
    port: 7780,
    serviceProcess: "pid:100",
    serviceUnit: "deployment-control-plane-service.service",
    imageDigest: IMAGE_DIGEST,
    configDigest: "sha256:config",
  };
}

function certificate() {
  return {
    checkedAt: freshCheckedAt(),
    arn: CERT_ARN,
    accountId: "123456789012",
    region: "us-east-1",
    status: "ISSUED",
    listenerArn: LISTENER_ARN,
    notBefore: "2025-01-01T00:00:00.000Z",
    notAfter: "2030-01-01T00:00:00.000Z",
    subjectAlternativeNames: ["deploy.example.test", "deploy-auth.example.test"],
    validationOwnership: reviewed("acm-validation"),
    renewal: reviewed("acm-renewal"),
    dnsValidation: reviewed("acm-dns-validation"),
  };
}

function dnsEvidence() {
  return {
    checkedAt: freshCheckedAt(),
    hostname: "deploy.example.test",
    recordType: "ALIAS",
    targetDnsName: "cp-123.us-east-1.elb.amazonaws.com",
    targetLoadBalancerArn: LB_ARN,
    publicResolution: ["cp-123.us-east-1.elb.amazonaws.com"],
    publicVantagePoint: "public-dns-fixture",
  };
}

function accessControl() {
  return {
    checkedAt: freshCheckedAt(),
    serviceSecurityGroupId: "sg-service",
    loadBalancerSecurityGroupId: "sg-alb",
    sourceSecurityGroupIds: ["sg-alb"],
    targetPort: 7780,
    directPublicServiceIngress: false,
    approvedClientCidrs: ["203.0.113.0/24"],
    waf: reviewed("aws-waf"),
  };
}

function callbackRoute() {
  return {
    checkedAt: freshCheckedAt(),
    host: "deploy-auth.example.test",
    path: "/oidc/callback",
    listenerArn: LISTENER_ARN,
    ruleArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener-rule/app/cp/1/2/3",
    targetGroupArn: TARGET_GROUP_ARN,
  };
}

export function reviewed(id: string) {
  return {
    checkedAt: freshCheckedAt(),
    reviewedReference: `docs/cloud-control-cutover.md#${id}`,
    digest: `sha256:${id}`,
  };
}

export function ingressCommandEvidence(overrides: Record<string, unknown> = {}) {
  const base = baseCommandEvidence();
  return { ...base, ...overrides };
}

function baseCommandEvidence() {
  return {
    dns: command("dns", {
      resolved: true,
      resolvedTargetMatchesSelectedIngress: true,
      publicResolution: ["203.0.113.10"],
      selectedIngressResolution: ["203.0.113.10"],
      selectedLoadBalancerDnsNameDigest: sha("cp-123.us-east-1.elb.amazonaws.com"),
      proofDigest: "sha256:dns-command",
    }),
    tls: command("tls", {
      handshake: true,
      authorized: true,
      coverageMatchedPublicUrl: true,
      coverageMatchedCallbackHost: true,
      notBefore: "2025-01-01T00:00:00.000Z",
      notAfter: "2030-01-01T00:00:00.000Z",
      proofDigest: "sha256:tls-command",
    }),
    health: command("health", {
      readiness: { ok: true, status: 200 },
      targetHealthy: true,
      targetRegistrationBound: true,
      targetGroupArnDigest: sha(TARGET_GROUP_ARN),
      proofDigest: "sha256:health-command",
    }),
    callback: command("callback", {
      status: 200,
      routeMatchesSelectedTargetGroup: true,
      observedTargetGroupArnDigest: sha(TARGET_GROUP_ARN),
      callbackHostDigest: sha("deploy-auth.example.test"),
      callbackPath: "/oidc/callback",
      proofDigest: "sha256:callback-command",
    }),
  };
}

function command(collector: string, evidence: Record<string, unknown>) {
  return {
    schemaVersion: "cloud-control-ingress-command-evidence@1",
    checkedAt: freshCheckedAt(),
    source: "generated-runbook-command",
    collector,
    inputs: ["aws-topology-evidence.json", "config.yaml"],
    evidence,
  };
}

function sha(value: string) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function freshCheckedAt() {
  return new Date().toISOString();
}
