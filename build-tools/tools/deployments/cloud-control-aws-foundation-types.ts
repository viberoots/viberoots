import type { AwsArtifactBackend } from "./cloud-control-aws-topology-types";

export const AWS_FOUNDATION_PROFILE_SCHEMA = "aws-foundation-profile@1" as const;

export const AWS_FOUNDATION_REQUIRED_QUOTAS = [
  "vpc-endpoints",
  "load-balancers",
  "ec2",
  "ebs",
  "ecr",
  "kms",
  "cloudwatch",
] as const;

export const AWS_FOUNDATION_PRIVATELINK_REQUIRED_QUOTAS = ["vpc-lattice"] as const;

export const AWS_FOUNDATION_REQUIRED_EGRESS = [
  "infisical",
  "registry",
  "provider-apis",
  "supabase-api",
  "reviewed-source",
] as const;

export type AwsFoundationProfile = {
  schemaVersion: typeof AWS_FOUNDATION_PROFILE_SCHEMA;
  checkedAt: string;
  source: "aws-provider-inspection" | "opentofu-apply-output" | "imported-reviewed-evidence";
  capabilityIds: string[];
  accountId: string;
  partition: "aws" | "aws-us-gov" | "aws-cn";
  region: string;
  state: AwsFoundationStateProfile;
  tags: Record<"owner" | "environment" | "dataClassification" | "rollback", string>;
  preflight: AwsFoundationPreflightProfile;
  network: AwsFoundationNetworkProfile;
  iam: AwsFoundationIamProfile;
  artifactStore: AwsFoundationArtifactStoreProfile;
};

export type AwsFoundationStateProfile = {
  backend: "s3";
  encrypted: boolean;
  lock: "dynamodb" | "s3-native";
  workspace: string;
  drift: { checkedAt: string; status: "in-sync"; diffDigest: string };
};

export type AwsFoundationPreflightProfile = {
  quotas: { service: string; required: number; available: number }[];
  costEstimate: { checkedAt: string; monthlyUsd: number; approvedRef: string };
  kms: { selected: boolean; keyArn?: string; deletionWindowDays?: number };
};

export type AwsFoundationNetworkProfile = {
  vpc: { mode: "create" | "import"; vpcId: string };
  privateSubnetIds: string[];
  privateSubnets: {
    id: string;
    vpcId: string;
    availabilityZone: string;
    routeTableId: string;
    mapPublicIpOnLaunch: boolean;
  }[];
  availabilityZones: string[];
  routeTableIds: string[];
  natGatewayIds: string[];
  internetGatewayId: string;
  s3VpcEndpoint: {
    endpointId: string;
    type: "gateway" | "interface";
    routeTableIds: string[];
    endpointPolicyDigest: string;
  };
  outboundHttpsTargets: string[];
  outboundPolicyDigests: Record<
    "infisical" | "registry" | "provider-apis" | "supabase-api" | "reviewed-source",
    string
  >;
  securityGroupIds: Record<
    "service" | "worker" | "loadBalancer" | "s3Endpoint" | "privatelink",
    string
  >;
};

export type AwsFoundationIamProfile = {
  roles: Record<"ec2Host" | "s3ArtifactAccess" | "evidenceCollector" | "providerHook", string>;
  instanceProfileTrustDigest: string;
  policies: { name: string; digest: string; leastPrivilege: boolean; actions: string[] }[];
};

export type AwsFoundationArtifactStoreProfile = {
  backend: AwsArtifactBackend;
  bucket?: string;
  prefix: string;
  endpointPolicyDigest?: string;
  bucketPolicyDigest?: string;
  publicAccessBlock: boolean;
  versioning: boolean;
  lifecycle: boolean;
  objectLock: boolean;
  retention: "object-lock" | "version-retention" | "imported-reviewed";
  immutablePrefix: boolean;
  immutablePrefixPolicyDigest?: string;
  replicationSelected?: boolean;
  replicationEvidence?: { reviewedReference: string; digest: string };
  importEvidence?: { reviewedReference: string; digest: string };
  retentionEvidence?: { reviewedReference: string; digest: string };
  networkPath?: {
    expectation: "public-internet" | "private-endpoint";
    reviewedReference: string;
    digest: string;
  };
  compatibility?: Record<"endpointShape" | "signingRegion" | "pathStyle" | "metadata", string>;
};
