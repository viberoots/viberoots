import type {
  CloudProviderCapabilityHookPhase,
  HookAdapter,
  HookAdapterPhase,
} from "./cloud-control-provider-capability-hooks";

export function supabasePrivateLinkAdapter(base: HookAdapter): HookAdapter {
  const phase = (selectedPhase: CloudProviderCapabilityHookPhase): HookAdapterPhase => {
    return async (opts) => {
      const basePhase =
        selectedPhase === "reviewed-import" ? base.reviewedImport : base[selectedPhase];
      const result = await basePhase(opts);
      return {
        ...result,
        payload: {
          schemaVersion: "supabase-privatelink-provider-payload@1",
          evidenceMode: "evidence-only",
          supportMediated: true,
          supportEvidenceRef: "privatelink-request",
          ramPermissionEvidenceRef: "ram-acceptance-permission",
          latticePermissionEvidenceRef: "vpc-lattice-association-permission",
          privateDnsEvidenceRef: "private-dns-proof",
        },
      };
    };
  };
  return {
    ...base,
    preview: phase("preview"),
    apply: phase("apply"),
    evidence: phase("evidence"),
    smoke: phase("smoke"),
    rollback: phase("rollback"),
    reviewedImport: phase("reviewed-import"),
  };
}
