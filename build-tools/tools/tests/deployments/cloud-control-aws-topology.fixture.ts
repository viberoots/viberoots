import { AWS_TOPOLOGY_EVIDENCE_SCHEMA } from "../../deployments/cloud-control-aws-topology-types";
import { foundationFromTopology } from "./cloud-control-aws-foundation-fixture";
import { ingressEvidence } from "./cloud-control-aws-ingress.fixture";

export const IMAGE_DIGEST = `sha256:${"a".repeat(64)}`;
export const IMAGE_REF = `registry.example.com/platform/deployment-control-plane@${IMAGE_DIGEST}`;
export const IMAGE_BUILD_IDENTITY = `nix-source-${"b".repeat(64)}`;

export function publicAwsTopology(overrides: Record<string, unknown> = {}) {
  const topology = {
    ...baseAwsTopology(),
    database: {
      mode: "public",
      publicTls: {
        checkedAt: freshCheckedAt(),
        sourceHost: "i-0abc1234",
        targetHost: "db.project.supabase.co",
        tlsValidated: true,
        psqlProofDigest: "sha256:public-psql-proof",
      },
    },
    ...overrides,
  };
  return { ...topology, foundation: topology.foundation ?? foundationFromTopology(topology) };
}

export function privateLinkAwsTopology(overrides: Record<string, unknown> = {}) {
  const topology = {
    ...baseAwsTopology(),
    securityGroups: { ...baseSecurityGroups(), privatelink: sg("sg-privatelink") },
    database: {
      mode: "privatelink",
      privatelink: {
        checkedAt: freshCheckedAt(),
        resourceConfigurationArn:
          "arn:aws:vpc-lattice:us-east-1:123456789012:resourceconfiguration/rcfg-123",
        ramShareArn: "arn:aws:ram:us-east-1:123456789012:resource-share/share-123",
        endpointId: "vpce-privatelink123",
        endpointDnsNames: ["vpce-privatelink123.vpce.amazonaws.com"],
        endpointIps: ["10.0.1.12"],
        psqlProofDigest: "sha256:privatelink-psql-proof",
      },
    },
    ...overrides,
  };
  return { ...topology, foundation: topology.foundation ?? foundationFromTopology(topology) };
}

export function topologyForPublishedImage<T extends { compute?: unknown }>(
  topology: T,
  image: string,
  digest: string,
): T {
  const compute = (topology as any).compute;
  const ingress = (topology as any).ingress;
  const next = {
    ...topology,
    compute: {
      ...compute,
      processEvidence: { ...compute.processEvidence, imageDigest: digest },
      registryPullProof: { ...compute.registryPullProof, image, digest },
    },
    ingress: {
      ...ingress,
      targetRegistration: { ...ingress.targetRegistration, imageDigest: digest },
    },
  } as Record<string, unknown>;
  return { ...next, foundation: foundationFromTopology(next) } as T;
}

function baseAwsTopology() {
  return {
    schemaVersion: AWS_TOPOLOGY_EVIDENCE_SCHEMA,
    checkedAt: freshCheckedAt(),
    accountId: "123456789012",
    region: "us-east-1",
    artifactBackend: "aws-s3",
    vpc: { checkedAt: freshCheckedAt(), id: "vpc-123", dnsSupport: true, dnsHostnames: true },
    egress: {
      checkedAt: freshCheckedAt(),
      mode: "nat-gateway",
      routeTableIds: ["rtb-123", "rtb-456"],
      natGatewayIds: ["nat-123"],
    },
    publicSubnets: [
      publicSubnet("subnet-public-123", "us-east-1a", "rtb-public-123"),
      publicSubnet("subnet-public-456", "us-east-1b", "rtb-public-123"),
    ],
    privateSubnets: [
      privateSubnet("subnet-123", "us-east-1a", "rtb-123"),
      privateSubnet("subnet-456", "us-east-1b", "rtb-456"),
    ],
    securityGroups: baseSecurityGroups(),
    s3VpcEndpoint: {
      checkedAt: freshCheckedAt(),
      type: "gateway",
      endpointId: "vpce-123",
      routeTableIds: ["rtb-123", "rtb-456"],
      endpointPolicyDigest: "sha256:s3-endpoint-policy",
      bucket: "deployment-control-plane-artifacts",
      prefix: "control-plane/",
    },
    compute: computeEvidence(),
    operationalVisibility: operationalVisibility(),
    ingress: ingressEvidence(),
  };
}

function computeEvidence() {
  return {
    checkedAt: freshCheckedAt(),
    mode: "ec2-instance",
    instanceId: "i-0abc1234",
    launchTemplateId: "lt-123",
    launchTemplateVersion: "7",
    amiId: "ami-123",
    amiBuildIdentity: IMAGE_BUILD_IDENTITY,
    amiSelection: {
      source: "reviewed-nixos-build-import",
      amiId: "ami-123",
      buildIdentity: IMAGE_BUILD_IDENTITY,
      pinPath: "sha256:nixos-ami-import",
      ownerReviewed: true,
    },
    launchTemplateSubnetIds: ["subnet-123", "subnet-456"],
    securityGroupIds: ["sg-service", "sg-worker"],
    instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/control-plane",
    ebs: { encrypted: true, statePath: "/var/lib/deployment-control-plane" },
    access: { mode: "ssm-session-manager", evidenceDigest: "sha256:ssm", broadInboundSsh: false },
    recovery: {
      mode: "manual-reviewed",
      workerLeaseFencing: {
        durableBackend: "postgres",
        duplicateActiveWorkersPrevented: true,
        evidenceDigest: "sha256:worker-lease-fencing",
      },
    },
    userData: { activatesGeneratedArtifacts: true, providerMutation: false, digest: "sha256:user" },
    patchCadence: { hostImage: "monthly-reviewed-ami", containerImage: "per-source-revision" },
    registryPullProof: registryPullProof(),
    processEvidence: processEvidence(),
  };
}

function operationalVisibility() {
  return {
    checkedAt: freshCheckedAt(),
    logSink: { kind: "cloudwatch", retentionDays: 30, accessControlDigest: "sha256:log-access" },
    unitLogRouting: { service: "deployment-control-plane-service.service", worker: "workers" },
    history: { readiness: true, workerHeartbeat: true },
    alarms: [
      "service-down",
      "readiness-failure",
      "missing-worker-heartbeat",
      "queue-backlog",
      "repeated-worker-crash",
    ].map((id) => ({ id, target: `sns-${id}` })),
  };
}

function registryPullProof() {
  return {
    hostProfile: "aws-ec2",
    image: IMAGE_REF,
    digest: IMAGE_DIGEST,
    checkedAt: freshCheckedAt(),
    principal: "arn:aws:iam::123456789012:role/control-plane-instance-profile",
  };
}

function processEvidence() {
  return {
    checkedAt: freshCheckedAt(),
    service: "pid:100",
    workers: ["pid:101", "pid:102"],
    imageDigest: IMAGE_DIGEST,
    configDigest: "sha256:config",
    credentialManifestDigest: "sha256:credential-manifest",
    serviceReadiness: true,
    workerHeartbeat: true,
    gracefulShutdown: true,
  };
}

function privateSubnet(id: string, availabilityZone: string, routeTableId: string) {
  return {
    checkedAt: freshCheckedAt(),
    id,
    vpcId: "vpc-123",
    availabilityZone,
    routeTableId,
    mapPublicIpOnLaunch: false,
  };
}

function publicSubnet(id: string, availabilityZone: string, routeTableId: string) {
  return {
    checkedAt: freshCheckedAt(),
    id,
    vpcId: "vpc-123",
    availabilityZone,
    routeTableId,
    mapPublicIpOnLaunch: true,
  };
}

function baseSecurityGroups() {
  return {
    service: sg("sg-service"),
    worker: sg("sg-worker"),
    loadBalancer: sg("sg-alb"),
    s3Endpoint: sg("sg-s3"),
    privatelink: sg("sg-privatelink"),
  };
}

function sg(id: string) {
  return { checkedAt: freshCheckedAt(), id, vpcId: "vpc-123", purpose: id };
}

export function freshCheckedAt() {
  return new Date().toISOString();
}
