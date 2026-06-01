export const AWS_TOPOLOGY_EVIDENCE_SCHEMA = "aws-topology-evidence@1" as const;

export type AwsDatabaseConnectivityMode = "public" | "privatelink";
import type { AwsFoundationProfile } from "./cloud-control-aws-foundation-types";
import type { AwsIngressEvidence } from "./cloud-control-aws-ingress-types";

export type AwsArtifactBackend =
  | "aws-s3"
  | "supabase-storage-s3"
  | "cloudflare-r2"
  | "s3-compatible";

export type AwsTopologyEvidence = {
  schemaVersion: typeof AWS_TOPOLOGY_EVIDENCE_SCHEMA;
  checkedAt: string;
  accountId: string;
  region: string;
  artifactBackend?: AwsArtifactBackend;
  vpc: AwsVpcEvidence;
  egress: AwsEgressEvidence;
  publicSubnets?: AwsSubnetEvidence[];
  privateSubnets: AwsSubnetEvidence[];
  securityGroups: AwsSecurityGroupsEvidence;
  s3VpcEndpoint?: AwsS3VpcEndpointEvidence;
  foundation?: AwsFoundationProfile;
  artifactBackendEvidence?: AwsReviewedEvidence;
  compute: AwsComputeEvidence;
  ingress: AwsIngressEvidence;
  database: AwsDatabaseEvidence;
  selectedEdges?: AwsSelectedEdgesEvidence;
  adjacentSystems?: AwsAdjacentSystemsEvidence;
  supportPrerequisites?: AwsSupportPrerequisiteEvidence[];
};

export type AwsVpcEvidence = {
  checkedAt: string;
  id: string;
  dnsSupport: boolean;
  dnsHostnames?: boolean;
};

export type AwsEgressEvidence =
  | {
      checkedAt: string;
      mode: "nat-gateway";
      routeTableIds: string[];
      natGatewayIds: string[];
    }
  | {
      checkedAt: string;
      mode: "controlled-egress";
      routeTableIds: string[];
    };

export type AwsSubnetEvidence = {
  checkedAt: string;
  id: string;
  vpcId: string;
  availabilityZone: string;
  routeTableId: string;
  mapPublicIpOnLaunch?: boolean;
};

export type AwsSecurityGroupEvidence = {
  checkedAt: string;
  id: string;
  vpcId: string;
  purpose: string;
};

export type AwsSecurityGroupsEvidence = {
  service: AwsSecurityGroupEvidence;
  worker: AwsSecurityGroupEvidence;
  loadBalancer: AwsSecurityGroupEvidence;
  s3Endpoint: AwsSecurityGroupEvidence;
  privatelink?: AwsSecurityGroupEvidence;
};

export type AwsS3VpcEndpointEvidence =
  | {
      checkedAt: string;
      type: "gateway";
      endpointId: string;
      routeTableIds: string[];
      endpointPolicyDigest: string;
      bucket: string;
      prefix: string;
    }
  | {
      checkedAt: string;
      type: "interface";
      endpointId: string;
      securityGroupIds: string[];
      endpointPolicyDigest: string;
      bucket: string;
      prefix: string;
    };

export type AwsReviewedEvidence = {
  checkedAt: string;
  reviewedReference: string;
  digest: string;
};

export type AwsComputeEvidence = {
  checkedAt: string;
  mode: "ec2-instance" | "auto-scaling-group";
  instanceId?: string;
  autoScalingGroupName?: string;
  launchTemplateId?: string;
  launchTemplateVersion?: string;
  amiId: string;
  instanceType?: string;
  instanceProfileArn: string;
  processEvidence: {
    checkedAt: string;
    service: string;
    workers: string[];
  };
};

export type AwsDatabaseEvidence =
  | {
      mode: "public";
      publicTls: {
        checkedAt: string;
        sourceHost: string;
        targetHost: string;
        tlsValidated: boolean;
        psqlProofDigest: string;
      };
    }
  | {
      mode: "privatelink";
      privatelink: {
        checkedAt: string;
        supabaseProjectRef: string;
        supabaseRegion: string;
        awsAccountId: string;
        awsRegion: string;
        regionalAvailability: AwsReviewedEvidence & {
          region: string;
          available: boolean;
        };
        resourceConfigurationArn: string;
        ramShareArn: string;
        ramShareStatus: "accepted";
        ramPermission: AwsReviewedEvidence;
        endpointId?: string;
        serviceNetworkAssociationId?: string;
        latticePermission: AwsReviewedEvidence;
        privateDns: {
          checkedAt: string;
          enabled: boolean;
          hostname: string;
          vpcId: string;
          resolvesFromSelectedVpc: boolean;
        };
        endpointDnsNames: string[];
        endpointIps: string[];
        endpointSecurityGroupId: string;
        serviceSecurityGroupId: string;
        workerSecurityGroupId: string;
        securityGroupRuleProof: {
          checkedAt: string;
          protocol: "tcp";
          port: 5432;
          sourceSecurityGroupIds: string[];
          destinationSecurityGroupId: string;
        };
        psql: {
          checkedAt: string;
          success: boolean;
          sourceHostIdentity: string;
          sourceHostKind: "aws-ec2";
          vpcId: string;
        };
        psqlProofDigest: string;
        databaseUrl: {
          checkedAt: string;
          hostname: string;
          classification: "private";
        };
        publicConnectivity: {
          checkedAt: string;
          status: "retained" | "disabled";
          retainedPublicPathJustification?: string;
          privatePathClientsPassed?: boolean;
        };
      };
    };

export type AwsSelectedEdgesEvidence = {
  cloudflare?: {
    checkedAt: string;
    dnsProxy: AwsReviewedEvidence;
    tlsMode: AwsReviewedEvidence;
    wafRules: AwsReviewedEvidence;
    bypass: AwsReviewedEvidence;
    publicReachability: AwsReviewedEvidence;
    callbackRoute: AwsReviewedEvidence;
  };
  vercel?: {
    checkedAt: string;
    project: AwsReviewedEvidence;
    domain: AwsReviewedEvidence;
    edgeSettings: AwsReviewedEvidence;
    callbackRoute: AwsReviewedEvidence;
  };
};

export type AwsAdjacentSystemsEvidence = {
  atticd?: boolean;
  remoteBuildWorkerFleet?: boolean;
};

export type AwsSupportPrerequisiteEvidence = {
  checkedAt: string;
  capabilityId: string;
  evidenceRef: string;
  status: "requested" | "accepted" | "complete";
};
