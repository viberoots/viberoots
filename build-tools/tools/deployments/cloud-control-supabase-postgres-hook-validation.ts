import type { ProviderCapabilityHookEvidenceValidationOptions } from "./cloud-control-provider-capability-hook-contract";
import type { SupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-profile";
import { validateSupabaseManagedPostgresEvidence } from "./control-plane-supabase-postgres-validation";

export function validateSupabaseManagedPostgresPayload(
  id: string,
  value: Record<string, unknown>,
  opts: ProviderCapabilityHookEvidenceValidationOptions,
): string[] {
  if (id !== "supabase-managed-postgres") return [];
  const payload = record(value.providerPayload);
  const errors: string[] = [];
  if (payload?.schemaVersion !== "supabase-managed-postgres-provider-payload@1") {
    errors.push(`${id}: missing Supabase managed Postgres provider payload evidence`);
  }
  if (payload?.evidenceMode !== "evidence-only") {
    errors.push(`${id}: Supabase managed Postgres payload must be evidence-only`);
  }
  if (payload?.automatedProvisioningSuccess === true || payload?.mutationAuthority !== false) {
    errors.push(`${id}: Supabase dashboard/support evidence cannot be provisioning authority`);
  }
  errors.push(...validateSupabaseIdentity(id, payload, opts.expectedSupabasePostgresProfile));
  errors.push(
    ...validateSupabaseManagedPostgresEvidence(payload?.lifecycleEvidence).map(
      (error) => `${id}: ${error}`,
    ),
  );
  return errors;
}

function validateSupabaseIdentity(
  id: string,
  payload: Record<string, unknown> | undefined,
  selectedProfile: SupabaseManagedPostgresProfile | undefined,
) {
  const expected = record(payload?.expectedProfileIdentity);
  const profile = record(record(payload?.lifecycleEvidence)?.profile);
  const errors: string[] = [];
  if (!expected) errors.push(`${id}: missing selected Supabase profile identity`);
  if (!profile) return errors;
  if (selectedProfile) {
    const selected = selectedProfileIdentity(selectedProfile);
    errors.push(
      ...compareIdentity(id, expected, selected, "selected setup profile"),
      ...compareIdentity(id, profileIdentity(profile), selected, "selected setup profile"),
    );
  }
  if (expected)
    errors.push(...compareIdentity(id, profileIdentity(profile), expected, "selected profile"));
  return errors;
}

function compareIdentity(
  id: string,
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
  label: string,
) {
  return Object.entries(expected).flatMap(([field, expectedValue]) =>
    actual && String(actual[field] || "") === String(expectedValue || "")
      ? []
      : [`${id}: lifecycle evidence ${field} does not match ${label}`],
  );
}

function profileIdentity(profile: Record<string, unknown>): Record<string, unknown> {
  const provisioning = record(profile.provisioning);
  const project = record(profile.project);
  const connection = record(profile.connection);
  return {
    organizationId: provisioning?.organizationId,
    projectRef: provisioning?.projectRef,
    region: project?.region,
    mode: connection?.mode,
  };
}

function selectedProfileIdentity(profile: SupabaseManagedPostgresProfile): Record<string, unknown> {
  return {
    organizationId: profile.provisioning.organizationId,
    projectRef: profile.provisioning.projectRef,
    region: profile.project.region,
    mode: profile.connection.mode,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
