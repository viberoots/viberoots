import type { CutoverEvidence, CutoverValidationOptions } from "./cloud-control-cutover-types";
import { validateSupabaseManagedPostgresEvidence } from "./control-plane-supabase-postgres-validation";
import type { SupabaseManagedPostgresEvidence } from "./control-plane-supabase-postgres-profile";

export function validateSupabaseProfileSource(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  const lifecycle = cutoverSupabaseLifecycleEvidence(evidence);
  if (!lifecycle) {
    return ["cutover requires freshness-gated Supabase Postgres lifecycle evidence"];
  }
  const topology = (evidence.awsTopology || {}) as any;
  const errors = validateSupabaseManagedPostgresEvidence(lifecycle, {
    expectedRegion: options.expectedRegion || topology.database?.privatelink?.supabaseRegion,
    expectedMode: topology.database?.mode,
  });
  if (!lifecycle.profile) return errors;
  const topologyProjectRef = topology.database?.privatelink?.supabaseProjectRef;
  if (topologyProjectRef && lifecycle.profile.provisioning.projectRef !== topologyProjectRef) {
    errors.push(
      "Supabase lifecycle profile project ref does not match selected topology project ref",
    );
  }
  if (evidence.supabasePostgresProfile) {
    errors.push(...compareSelectedProfile(lifecycle, evidence.supabasePostgresProfile));
  }
  return errors;
}

function cutoverSupabaseLifecycleEvidence(
  evidence: CutoverEvidence,
): SupabaseManagedPostgresEvidence | undefined {
  return (
    providerLifecycleEvidence(evidence.providerCapabilities?.["supabase-managed-postgres"]) ||
    evidence.managedDependencies?.supabasePostgres
  );
}

function providerLifecycleEvidence(value: unknown): SupabaseManagedPostgresEvidence | undefined {
  const payload = (value as any)?.providerPayload;
  return payload?.lifecycleEvidence;
}

function compareSelectedProfile(
  lifecycle: SupabaseManagedPostgresEvidence,
  selected: any,
): string[] {
  return [
    [
      "organization id",
      lifecycle.profile.provisioning.organizationId,
      selected.provisioning?.organizationId,
    ],
    ["project ref", lifecycle.profile.provisioning.projectRef, selected.provisioning?.projectRef],
    ["region", lifecycle.profile.project.region, selected.project?.region],
    ["connection mode", lifecycle.profile.connection.mode, selected.connection?.mode],
  ].flatMap(([label, actual, expected]) =>
    String(actual || "") === String(expected || "")
      ? []
      : [`Supabase lifecycle evidence ${label} does not match selected cutover profile`],
  );
}
