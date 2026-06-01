import type {
  CloudProviderCapabilityHookPhase,
  HookAdapter,
  HookAdapterPhase,
  HookAdapterPhaseOptions,
} from "./cloud-control-provider-capability-hooks";
import type { AwsDatabaseEvidence } from "./cloud-control-aws-topology-types";
import { validateSupabasePrivateLinkEvidence } from "./cloud-control-supabase-privatelink-evidence";

export function supabasePrivateLinkAdapter(base: HookAdapter): HookAdapter {
  const phase = (selectedPhase: CloudProviderCapabilityHookPhase): HookAdapterPhase => {
    return async (opts) => {
      const basePhase =
        selectedPhase === "reviewed-import" ? base.reviewedImport : base[selectedPhase];
      const result = await basePhase(opts);
      const privatelink = privateLinkEvidence(opts);
      return {
        ...result,
        summary: privatelink
          ? `${result.summary} AWS-side PrivateLink automation evidence`
          : result.summary,
        rawOutput: privatelink
          ? `${result.rawOutput} awsSideAutomation=ram,lattice,private-dns,psql`
          : result.rawOutput,
        payload: {
          schemaVersion: "supabase-privatelink-provider-payload@1",
          ...(privatelink ? automatedPayload(selectedPhase, opts, privatelink) : evidencePayload()),
        },
      };
    };
  };
  return {
    ...base,
    automated: true,
    preview: phase("preview"),
    apply: phase("apply"),
    evidence: phase("evidence"),
    smoke: phase("smoke"),
    rollback: phase("rollback"),
    reviewedImport: phase("reviewed-import"),
  };
}

function privateLinkEvidence(opts: HookAdapterPhaseOptions) {
  const database = opts.awsTopologyEvidence?.database as AwsDatabaseEvidence | undefined;
  if (database?.mode !== "privatelink") return undefined;
  const errors = validateSupabasePrivateLinkEvidence(database.privatelink, {
    maxAgeMinutes: 60,
    awsAccountId: opts.awsTopologyEvidence?.accountId,
    awsRegion: opts.awsTopologyEvidence?.region,
    vpcId: opts.awsTopologyEvidence?.vpc.id,
    serviceSecurityGroupId: opts.awsTopologyEvidence?.securityGroups.service.id,
    workerSecurityGroupId: opts.awsTopologyEvidence?.securityGroups.worker.id,
    privateLinkSecurityGroupId: opts.awsTopologyEvidence?.securityGroups.privatelink?.id,
  });
  if (errors.length > 0) {
    throw new Error(`supabase-privatelink-prerequisite rejected: ${errors.join("; ")}`);
  }
  return database.privatelink;
}

function evidencePayload() {
  return {
    evidenceMode: "evidence-only",
    supportMediated: true,
    supportEvidenceRef: "privatelink-request",
    ramPermissionEvidenceRef: "ram-acceptance-permission",
    latticePermissionEvidenceRef: "vpc-lattice-association-permission",
    privateDnsEvidenceRef: "private-dns-proof",
  };
}

function automatedPayload(
  phase: CloudProviderCapabilityHookPhase,
  opts: HookAdapterPhaseOptions,
  evidence: NonNullable<ReturnType<typeof privateLinkEvidence>>,
) {
  return {
    evidenceMode: "aws-side-automated",
    supportMediated: true,
    supportEvidenceRef: "privatelink-request",
    awsApiInputsPresent: true,
    expected: {
      accountId: opts.awsTopologyEvidence?.accountId,
      region: opts.awsTopologyEvidence?.region,
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
    psql: {
      checkedAt: evidence.psql.checkedAt,
      proofDigest: evidence.psqlProofDigest,
      success: evidence.psql.success,
      sourceHostIdentity: evidence.psql.sourceHostIdentity,
      vpcId: evidence.psql.vpcId,
    },
    mutationOutcomes: mutationOutcomes(phase, evidence),
  };
}

function mutationOutcomes(
  phase: CloudProviderCapabilityHookPhase,
  evidence: NonNullable<ReturnType<typeof privateLinkEvidence>>,
) {
  const mode = phase === "apply" || phase === "rollback" ? "recorded-or-reconciled" : "verified";
  return [
    { action: "ram-share-acceptance", status: evidence.ramShareStatus, mode },
    {
      action: evidence.endpointId
        ? "vpc-lattice-endpoint-association"
        : "vpc-lattice-service-network-association",
      status: "associated",
      mode,
    },
  ];
}
