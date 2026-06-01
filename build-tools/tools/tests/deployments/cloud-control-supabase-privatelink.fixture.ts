import {
  SUPABASE_PRIVATELINK_OPENTOFU_APPLY_SCHEMA,
  SUPABASE_PRIVATELINK_OPENTOFU_PLAN_SCHEMA,
  SUPABASE_PRIVATELINK_READONLY_SCHEMA,
} from "../../deployments/cloud-control-supabase-privatelink-iac-evidence";
import {
  SUPABASE_PRIVATELINK_IAC_PATHS,
  SUPABASE_PRIVATELINK_OPENTOFU_DIR,
} from "../../deployments/cloud-control-supabase-privatelink-iac-rules";

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

export function privateLinkIacEvidence(evidence = privateLinkEndpointEvidence()) {
  const common = {
    checkedAt: freshCheckedAt(),
    bundleRoot: "$PROFILE_ROOT",
    workingDirectory: SUPABASE_PRIVATELINK_OPENTOFU_DIR,
    outputPath: "$PROFILE_ROOT/supabase-privatelink-opentofu.out.json",
    expected: {
      accountId: "123456789012",
      region: "us-east-1",
      vpcId: "vpc-123",
      ramShareArn: evidence.ramShareArn,
      resourceConfigurationArn: evidence.resourceConfigurationArn,
      endpointId: evidence.endpointId,
      serviceNetworkAssociationId: evidence.serviceNetworkAssociationId,
    },
    ram: {
      ramShareArn: evidence.ramShareArn,
      ramShareStatus: evidence.ramShareStatus,
      permissionDigest: evidence.ramPermission.digest,
    },
    lattice: {
      resourceConfigurationArn: evidence.resourceConfigurationArn,
      endpointId: evidence.endpointId,
      serviceNetworkAssociationId: evidence.serviceNetworkAssociationId,
      permissionDigest: evidence.latticePermission.digest,
    },
    privateDns: evidence.privateDns,
    routeSecurityGroupPosture: {
      endpointSecurityGroupId: evidence.endpointSecurityGroupId,
      serviceSecurityGroupId: evidence.serviceSecurityGroupId,
      workerSecurityGroupId: evidence.workerSecurityGroupId,
      rule: evidence.securityGroupRuleProof,
    },
  };
  return {
    plan: {
      schemaVersion: SUPABASE_PRIVATELINK_OPENTOFU_PLAN_SCHEMA,
      source: "reviewed-opentofu-plan",
      ...common,
      evidencePath: SUPABASE_PRIVATELINK_IAC_PATHS.plan,
      outputPath: "$PROFILE_ROOT/supabase-privatelink-opentofu-plan.out.json",
      planDigest: `sha256:${"1".repeat(64)}`,
      importAdoption: {
        mode: "managed",
        reviewedReference: "docs/control-plane-guide.md",
        importBlock: "import {}",
      },
    },
    apply: {
      schemaVersion: SUPABASE_PRIVATELINK_OPENTOFU_APPLY_SCHEMA,
      source: "reviewed-opentofu-apply",
      ...common,
      evidencePath: SUPABASE_PRIVATELINK_IAC_PATHS.apply,
      outputPath: "$PROFILE_ROOT/supabase-privatelink-opentofu-apply.out.json",
      planDigest: `sha256:${"1".repeat(64)}`,
      applyDigest: `sha256:${"2".repeat(64)}`,
    },
    readOnly: {
      schemaVersion: SUPABASE_PRIVATELINK_READONLY_SCHEMA,
      source: "aws-privatelink-readonly-inspection",
      ...common,
      evidencePath: SUPABASE_PRIVATELINK_IAC_PATHS.readOnly,
      outputPath: "$PROFILE_ROOT/supabase-privatelink-readonly-evidence.out.json",
      evidenceDigest: `sha256:${"3".repeat(64)}`,
      psql: evidence.psql,
      psqlProofDigest: evidence.psqlProofDigest,
    },
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
