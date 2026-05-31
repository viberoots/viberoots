#!/usr/bin/env zx-wrapper
import {
  awsFoundationProfileFromInspection,
  foundationCapabilityIds,
} from "../../deployments/cloud-control-aws-foundation-render";
import {
  AWS_FOUNDATION_PRIVATELINK_REQUIRED_QUOTAS,
  AWS_FOUNDATION_REQUIRED_EGRESS,
  AWS_FOUNDATION_REQUIRED_QUOTAS,
  type AwsFoundationProfile,
} from "../../deployments/cloud-control-aws-foundation-types";

export function foundationFromTopology(
  topology: Record<string, any>,
  mode: "create" | "import" = "create",
): AwsFoundationProfile {
  const backend = topology.artifactBackend || "aws-s3";
  const subnets = topology.privateSubnets || [];
  const routeTableIds = [...new Set(subnets.map((subnet: any) => subnet.routeTableId))];
  const alternateEvidence = topology.artifactBackendEvidence;
  return awsFoundationProfileFromInspection({
    checkedAt: topology.checkedAt || new Date().toISOString(),
    source: mode === "create" ? "opentofu-apply-output" : "imported-reviewed-evidence",
    capabilityIds: foundationCapabilityIds(backend),
    accountId: topology.accountId,
    partition: "aws",
    region: topology.region,
    state: {
      backend: "s3",
      encrypted: true,
      lock: "dynamodb",
      workspace: `${topology.region}/deployment-control-plane`,
      drift: {
        checkedAt: new Date().toISOString(),
        status: "in-sync",
        diffDigest: "sha256:drift-clean",
      },
    },
    tags: {
      owner: "deployment-control-plane",
      environment: "test",
      dataClassification: "internal",
      rollback: "required",
    },
    preflight: {
      quotas: [
        ...AWS_FOUNDATION_REQUIRED_QUOTAS,
        ...AWS_FOUNDATION_PRIVATELINK_REQUIRED_QUOTAS,
      ].map((service) => ({
        service,
        required: 2,
        available: 20,
      })),
      costEstimate: {
        checkedAt: new Date().toISOString(),
        monthlyUsd: 126,
        approvedRef: "finops-123",
      },
      kms: {
        selected: true,
        keyArn: `arn:aws:kms:${topology.region}:${topology.accountId}:key/foundation`,
        deletionWindowDays: 30,
      },
    },
    network: {
      vpc: { mode, vpcId: topology.vpc.id },
      privateSubnetIds: subnets.map((subnet: any) => subnet.id),
      privateSubnets: subnets.map((subnet: any) => ({
        id: subnet.id,
        vpcId: subnet.vpcId,
        availabilityZone: subnet.availabilityZone,
        routeTableId: subnet.routeTableId,
        mapPublicIpOnLaunch: subnet.mapPublicIpOnLaunch === true,
      })),
      availabilityZones: [...new Set(subnets.map((subnet: any) => subnet.availabilityZone))],
      routeTableIds,
      natGatewayIds: topology.egress?.natGatewayIds || ["nat-123"],
      internetGatewayId: "igw-123",
      s3VpcEndpoint: {
        endpointId: topology.s3VpcEndpoint?.endpointId || "vpce-123",
        type: topology.s3VpcEndpoint?.type || "gateway",
        routeTableIds: topology.s3VpcEndpoint?.routeTableIds || routeTableIds,
        endpointPolicyDigest:
          topology.s3VpcEndpoint?.endpointPolicyDigest || "sha256:s3-endpoint-policy",
      },
      outboundHttpsTargets: [...AWS_FOUNDATION_REQUIRED_EGRESS],
      outboundPolicyDigests: {
        infisical: "sha256:egress-infisical",
        registry: "sha256:egress-registry",
        "provider-apis": "sha256:egress-provider-apis",
        "supabase-api": "sha256:egress-supabase-api",
        "reviewed-source": "sha256:egress-reviewed-source",
      },
      securityGroupIds: {
        service: topology.securityGroups.service.id,
        worker: topology.securityGroups.worker.id,
        loadBalancer: topology.securityGroups.loadBalancer.id,
        s3Endpoint: topology.securityGroups.s3Endpoint.id,
        privatelink: topology.securityGroups.privatelink.id,
      },
      ingress: {
        mode,
        loadBalancerArn: topology.ingress.loadBalancer.arn,
        listenerArn: topology.ingress.listenerArn,
        targetGroupArn: topology.ingress.targetGroupArn,
        targetAttachmentId: `${topology.ingress.targetGroupArn}/${topology.ingress.targetRegistration.instanceId}`,
        targetInstanceId: topology.ingress.targetRegistration.instanceId,
        targetPort: topology.ingress.targetRegistration.port,
        certificateArn: topology.ingress.certificateArn,
        dnsRecord: topology.ingress.dnsRecord,
        topologyEvidence: topology.ingress,
        stateBackend: "s3",
        stateLock: "dynamodb",
        drift: {
          checkedAt: new Date().toISOString(),
          status: "in-sync",
          diffDigest: "sha256:ingress-drift",
        },
        rollback: { nonDestructive: true, approvalRequiredForSharedResources: true },
      },
    },
    iam: {
      roles: {
        ec2Host: `arn:aws:iam::${topology.accountId}:role/control-plane-host`,
        s3ArtifactAccess: `arn:aws:iam::${topology.accountId}:role/control-plane-artifacts`,
        evidenceCollector: `arn:aws:iam::${topology.accountId}:role/control-plane-evidence`,
        providerHook: `arn:aws:iam::${topology.accountId}:role/control-plane-hook`,
      },
      instanceProfileTrustDigest: "sha256:instance-profile-trust",
      policies: [
        {
          name: "control-plane-artifact-access",
          digest: "sha256:artifact-policy",
          leastPrivilege: true,
          actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
        },
        {
          name: "control-plane-evidence-read",
          digest: "sha256:evidence-policy",
          leastPrivilege: true,
          actions: ["ec2:DescribeVpcs", "ec2:DescribeSubnets", "s3:GetBucketVersioning"],
        },
      ],
    },
    artifactStore: {
      backend,
      bucket: topology.s3VpcEndpoint?.bucket || "reviewed-alternate-artifacts",
      prefix: topology.s3VpcEndpoint?.prefix || "control-plane/",
      endpointPolicyDigest:
        topology.s3VpcEndpoint?.endpointPolicyDigest || alternateEvidence?.digest,
      bucketPolicyDigest: "sha256:artifact-bucket-policy",
      publicAccessBlock: true,
      versioning: true,
      lifecycle: true,
      objectLock: backend === "aws-s3",
      retention: backend === "aws-s3" ? "object-lock" : "imported-reviewed",
      immutablePrefix: true,
      immutablePrefixPolicyDigest: "sha256:immutable-prefix-policy",
      ...(backend !== "aws-s3"
        ? {
            importEvidence: alternateEvidence,
            retentionEvidence: {
              reviewedReference: `${backend}-retention-profile`,
              digest: "sha256:alternate-retention",
            },
            networkPath: {
              expectation: "public-internet",
              reviewedReference: `${backend}-network-path`,
              digest: "sha256:alternate-network-path",
            },
            compatibility: {
              endpointShape: backend,
              signingRegion: topology.region,
              pathStyle: "reviewed",
              metadata: alternateEvidence?.reviewedReference,
            },
          }
        : {}),
    },
  });
}
