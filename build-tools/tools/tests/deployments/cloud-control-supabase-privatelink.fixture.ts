export function privateLinkEndpointEvidence(overrides: Record<string, unknown> = {}) {
  return {
    checkedAt: freshCheckedAt(),
    supabaseProjectRef: "project-review",
    supabaseRegion: "us-east-1",
    awsAccountId: "123456789012",
    awsRegion: "us-east-1",
    regionalAvailability: {
      checkedAt: freshCheckedAt(),
      region: "us-east-1",
      available: true,
      reviewedReference: "docs/cloud-control-cutover.md#supabase-privatelink-regions",
      digest: "sha256:privatelink-region",
    },
    resourceConfigurationArn:
      "arn:aws:vpc-lattice:us-east-1:123456789012:resourceconfiguration/rcfg-123",
    ramShareArn: "arn:aws:ram:us-east-1:123456789012:resource-share/share-123",
    ramShareStatus: "accepted",
    ramPermission: reviewed("ram-acceptance-permission"),
    endpointId: "vpce-privatelink123",
    latticePermission: reviewed("vpc-lattice-endpoint-permission"),
    privateDns: {
      checkedAt: freshCheckedAt(),
      enabled: true,
      hostname: "vpce-privatelink123.vpce.amazonaws.com",
      vpcId: "vpc-123",
      resolvesFromSelectedVpc: true,
    },
    endpointDnsNames: ["vpce-privatelink123.vpce.amazonaws.com"],
    endpointIps: ["10.0.1.12"],
    endpointSecurityGroupId: "sg-privatelink",
    serviceSecurityGroupId: "sg-service",
    workerSecurityGroupId: "sg-worker",
    securityGroupRuleProof: {
      checkedAt: freshCheckedAt(),
      protocol: "tcp",
      port: 5432,
      sourceSecurityGroupIds: ["sg-service", "sg-worker"],
      destinationSecurityGroupId: "sg-privatelink",
    },
    psql: {
      checkedAt: freshCheckedAt(),
      success: true,
      sourceHostIdentity: "i-0abc1234",
      sourceHostKind: "aws-ec2",
      vpcId: "vpc-123",
    },
    psqlProofDigest: "sha256:privatelink-psql-proof",
    databaseUrl: {
      checkedAt: freshCheckedAt(),
      hostname: "vpce-privatelink123.vpce.amazonaws.com",
      classification: "private",
    },
    publicConnectivity: {
      checkedAt: freshCheckedAt(),
      status: "retained",
      retainedPublicPathJustification: "reviewed rollback path during first cutover window",
    },
    ...overrides,
  };
}

export function serviceNetworkAssociationEvidence(overrides: Record<string, unknown> = {}) {
  return privateLinkEndpointEvidence({
    endpointId: undefined,
    serviceNetworkAssociationId: "snra-privatelink123",
    latticePermission: reviewed("vpc-lattice-service-network-permission"),
    privateDns: {
      checkedAt: freshCheckedAt(),
      enabled: true,
      hostname: "project-review.service-network.vpc-lattice-svcs.us-east-1.on.aws",
      vpcId: "vpc-123",
      resolvesFromSelectedVpc: true,
    },
    endpointDnsNames: ["project-review.service-network.vpc-lattice-svcs.us-east-1.on.aws"],
    ...overrides,
  });
}

function reviewed(name: string) {
  return {
    checkedAt: freshCheckedAt(),
    reviewedReference: `docs/cloud-control-cutover.md#${name}`,
    digest: `sha256:${name}`,
  };
}

function freshCheckedAt() {
  return new Date().toISOString();
}
