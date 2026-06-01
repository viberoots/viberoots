import type {
  CloudProviderCapabilityHookPhase,
  HookAdapter,
  HookAdapterPhase,
  HookAdapterPhaseOptions,
} from "./cloud-control-provider-capability-hooks";
import type { AwsDatabaseEvidence } from "./cloud-control-aws-topology-types";
import { validateSupabasePrivateLinkEvidence } from "./cloud-control-supabase-privatelink-evidence";
import {
  summarizeSupabasePrivateLinkIac,
  validateSupabasePrivateLinkIacBundle,
} from "./cloud-control-supabase-privatelink-iac-evidence";

export function supabasePrivateLinkAdapter(base: HookAdapter): HookAdapter {
  const phase = (selectedPhase: CloudProviderCapabilityHookPhase): HookAdapterPhase => {
    return async (opts) => {
      const basePhase =
        selectedPhase === "reviewed-import" ? base.reviewedImport : base[selectedPhase];
      const result = await basePhase(opts);
      const privatelink = privateLinkEvidence(opts);
      const iac = opts.supabasePrivateLinkIac || {};
      return {
        ...result,
        summary: privatelink
          ? `${result.summary} AWS-side PrivateLink IaC evidence`
          : result.summary,
        rawOutput: privatelink
          ? `${result.rawOutput} iac=opentofu readOnlyEvidence=ram,lattice,private-dns,sg,psql`
          : result.rawOutput,
        payload: {
          schemaVersion: "supabase-privatelink-provider-payload@1",
          ...(privatelink ? iacPayload(selectedPhase, opts, privatelink, iac) : evidencePayload()),
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

function iacPayload(
  phase: CloudProviderCapabilityHookPhase,
  opts: HookAdapterPhaseOptions,
  evidence: NonNullable<ReturnType<typeof privateLinkEvidence>>,
  iac: NonNullable<HookAdapterPhaseOptions["supabasePrivateLinkIac"]>,
) {
  const errors = validateSupabasePrivateLinkIacBundle({
    iac,
    phase,
    topology: opts.awsTopologyEvidence,
  });
  if (errors.length > 0) {
    throw new Error(
      `supabase-privatelink-prerequisite IaC evidence rejected: ${errors.join("; ")}`,
    );
  }
  return {
    evidenceMode: "iac-reviewed",
    supportMediated: true,
    supportEvidenceRef: "privatelink-request",
    expected: {
      accountId: opts.awsTopologyEvidence?.accountId,
      region: opts.awsTopologyEvidence?.region,
      ramShareArn: evidence.ramShareArn,
      resourceConfigurationArn: evidence.resourceConfigurationArn,
      endpointId: evidence.endpointId,
      serviceNetworkAssociationId: evidence.serviceNetworkAssociationId,
    },
    iac: {
      orchestration: "reviewed-opentofu-artifacts",
      ownership: "opentofu-managed-or-reviewed-import",
      outcomes: summarizeSupabasePrivateLinkIac(iac),
      plan: iac.plan,
      apply: iac.apply,
      readOnly: iac.readOnly,
    },
  };
}
