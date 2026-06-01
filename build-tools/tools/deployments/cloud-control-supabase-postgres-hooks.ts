import type {
  CloudProviderCapabilityHookPhase,
  HookAdapter,
  HookAdapterPhase,
} from "./cloud-control-provider-capability-hooks";
import { buildSupabaseManagedPostgresEvidence } from "./control-plane-supabase-postgres-evidence";

export function supabaseManagedPostgresAdapter(base: HookAdapter): HookAdapter {
  const phase = (selectedPhase: CloudProviderCapabilityHookPhase): HookAdapterPhase => {
    return async (opts) => {
      const basePhase =
        selectedPhase === "reviewed-import" ? base.reviewedImport : base[selectedPhase];
      const result = await basePhase(opts);
      const profile = opts.supabasePostgresProfile;
      return {
        ...result,
        payload: {
          schemaVersion: "supabase-managed-postgres-provider-payload@1",
          evidenceMode: "evidence-only",
          automatedProvisioningSuccess: false,
          mutationAuthority: false,
          ...(profile
            ? {
                expectedProfileIdentity: {
                  organizationId: profile.provisioning.organizationId,
                  projectRef: profile.provisioning.projectRef,
                  region: profile.project.region,
                  mode: profile.connection.mode,
                },
                lifecycleEvidence: buildSupabaseManagedPostgresEvidence(profile),
              }
            : {}),
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
