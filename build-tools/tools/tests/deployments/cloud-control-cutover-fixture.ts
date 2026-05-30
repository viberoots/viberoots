import { capabilityDeclaration } from "../../deployments/cloud-control-setup-contract";
import { AWS_TOPOLOGY_EVIDENCE_SCHEMA } from "../../deployments/cloud-control-aws-topology-types";
import {
  CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SCHEMA,
  CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SOURCE,
} from "../../deployments/cloud-control-provider-capability-hook-contract";

export const IMAGE_DIGEST = `sha256:${"a".repeat(64)}`;
export const IMAGE_REF = `registry.example.com/platform/deployment-control-plane@${IMAGE_DIGEST}`;
export const IMAGE_BUILD_IDENTITY = `nix-source-${"b".repeat(64)}`;

export function evidence(overrides: Record<string, unknown> = {}) {
  return {
    hostProfile: "aws-ec2",
    region: "us-east-1",
    generatedAt: new Date().toISOString(),
    health: {
      cloudHealth: true,
      readiness: true,
      workerHeartbeats: 2,
      databaseConnectivity: true,
      artifactStoreCompatibility: true,
      authCallbackReachability: true,
      uiReads: true,
      mcpReads: true,
    },
    imagePublication: imagePublicationEvidence(),
    managedDependencies: managedDependencyEvidence(),
    awsTopology: privateLinkAwsTopology(),
    latestNonProductionDeployment: {
      runId: "deploy-run-1",
      hostProfile: "aws-ec2",
      image: IMAGE_REF,
      trafficIngressHostProfile: "aws-ec2",
      cloudPrimaryPath: true,
      stagingDeploymentSucceeded: true,
    },
    providerCapabilities: {
      "aws-ec2-control-plane-host": capabilityEvidence("aws-ec2-control-plane-host"),
      "aws-network-foundation": capabilityEvidence("aws-network-foundation"),
      "aws-s3-artifact-store": capabilityEvidence("aws-s3-artifact-store"),
      "supabase-managed-postgres": capabilityEvidence("supabase-managed-postgres"),
      "supabase-privatelink-prerequisite": capabilityEvidence("supabase-privatelink-prerequisite"),
    },
    standby: { mode: "service-only", doubleExecutionPrevented: true },
    restore: restoreEvidence(),
    rollback: { trafficReturn: true, authoritySemanticsUnchanged: true },
    breakGlass: {
      statusInspect: true,
      pauseWorkers: true,
      auditPreserved: true,
      providerMutationBlocked: true,
    },
    audit: { cutover: true, rollback: true, restore: true, "break-glass": true },
    ...overrides,
  };
}

export function imagePublicationEvidence(overrides: Record<string, unknown> = {}) {
  return {
    image: IMAGE_REF,
    sourceRevision: "source-cutover",
    imageBuildIdentity: IMAGE_BUILD_IDENTITY,
    digest: IMAGE_DIGEST,
    inspectedDigest: IMAGE_DIGEST,
    tag: "registry.example.com/platform/deployment-control-plane:source-cutover",
    ...overrides,
  };
}

export function capabilityEvidence(id = "aws-ec2-control-plane-host") {
  const declaration = capabilityDeclaration(id);
  return {
    schemaVersion: CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SCHEMA,
    source: CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SOURCE,
    checkedAt: freshCheckedAt(),
    capabilityId: id,
    phase: "smoke",
    declaration,
    auditEvidence: [...declaration.auditEvidence],
    auditIdentity: "operator-1",
    rollbackProcedure: true,
    smokeEvidence: true,
    hook: { adapter: "fixture-reviewed-hook", automated: true, manualPrerequisite: false },
    output: {
      classification: "redact_before_display",
      redacted: true,
      summary: "payload redacted (sha256:fixture)",
      fingerprint: "sha256:fixture",
    },
  };
}

export function restoreEvidence() {
  return {
    databaseRecords: true,
    artifactObjects: true,
    imageDigest: true,
    config: true,
    exportedConfigDigest: "sha256:config",
    credentialManifest: true,
    authConfiguration: true,
    durableStateReferences: ["submission:1", "artifact:1"],
  };
}

export function managedDependencyEvidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "control-plane-managed-dependency-evidence@1",
    profileName: "cloud-control-plane",
    checkedAt: freshCheckedAt(),
    postgres: {
      provider: "supabase-postgres",
      serverVersionNum: 150000,
      checkedFeatures: ["jsonb", "listen-notify"],
    },
    artifactStore: {
      provider: "s3-compatible",
      bucket: "deployment-control-plane-artifacts",
      region: "us-east-1",
      endpointHost: "s3.us-east-1.amazonaws.com",
      checkedOperations: ["PUT", "GET", "HEAD", "metadata", "content-type", "digest"],
      digest: "sha256:artifact-store-proof",
      objectKey: "control-plane/proof",
    },
    ...overrides,
  };
}

export function publicAwsTopology(overrides: Record<string, unknown> = {}) {
  return {
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
}

export function privateLinkAwsTopology(overrides: Record<string, unknown> = {}) {
  return {
    ...baseAwsTopology(),
    securityGroups: {
      ...baseSecurityGroups(),
      privatelink: sg("sg-privatelink", "supabase-privatelink-endpoint"),
    },
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
      routeTableIds: ["rtb-123"],
      natGatewayIds: ["nat-123"],
    },
    privateSubnets: [
      {
        checkedAt: freshCheckedAt(),
        id: "subnet-123",
        vpcId: "vpc-123",
        availabilityZone: "us-east-1a",
        routeTableId: "rtb-123",
      },
    ],
    securityGroups: baseSecurityGroups(),
    s3VpcEndpoint: {
      checkedAt: freshCheckedAt(),
      type: "gateway",
      endpointId: "vpce-123",
      routeTableIds: ["rtb-123"],
      endpointPolicyDigest: "sha256:s3-endpoint-policy",
      bucket: "deployment-control-plane-artifacts",
      prefix: "control-plane/",
    },
    compute: {
      checkedAt: freshCheckedAt(),
      mode: "ec2-instance",
      instanceId: "i-0abc1234",
      launchTemplateId: "lt-123",
      launchTemplateVersion: "7",
      amiId: "ami-123",
      instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/control-plane",
      processEvidence: { checkedAt: freshCheckedAt(), service: "pid:100", workers: ["pid:101"] },
    },
    ingress: {
      checkedAt: freshCheckedAt(),
      type: "alb",
      listenerArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/cp/1/2",
      targetGroupArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/cp/1",
      targetHealth: "healthy",
      certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/cert-123",
      tlsPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
      dnsRecord: "deploy.example.test",
      callbackHost: "deploy-auth.example.test",
    },
  };
}

function baseSecurityGroups() {
  return {
    service: sg("sg-service", "control-plane-service"),
    worker: sg("sg-worker", "control-plane-worker"),
    loadBalancer: sg("sg-alb", "load-balancer"),
    s3Endpoint: sg("sg-s3", "s3-endpoint"),
  };
}

function sg(id: string, purpose: string) {
  return { checkedAt: freshCheckedAt(), id, vpcId: "vpc-123", purpose };
}

function freshCheckedAt() {
  return new Date().toISOString();
}
