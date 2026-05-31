import type { CutoverEvidence, CutoverValidationOptions } from "./cloud-control-cutover-types";
import { validateSupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-validation";

export function validateSupabaseProfileSource(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  if (!evidence.supabasePostgresProfile) {
    return ["cutover requires independent Supabase Postgres profile evidence"];
  }
  const topology = (evidence.awsTopology || {}) as any;
  const errors = validateSupabaseManagedPostgresProfile(evidence.supabasePostgresProfile, {
    expectedRegion: options.expectedRegion || topology.database?.privatelink?.supabaseRegion,
    expectedMode: topology.database?.mode,
  });
  const topologyProjectRef = topology.database?.privatelink?.supabaseProjectRef;
  if (
    topologyProjectRef &&
    evidence.supabasePostgresProfile.provisioning.projectRef !== topologyProjectRef
  ) {
    errors.push("Supabase profile project ref does not match selected topology project ref");
  }
  return errors;
}
