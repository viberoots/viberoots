import type { ManagedDependencyValidationExpectations } from "./control-plane-managed-dependency-types";
import { validateSupabaseManagedPostgresEvidence } from "./control-plane-supabase-postgres-validation";

export function validateSupabasePostgresLifecycle(
  evidence: Record<string, unknown>,
  opts: ManagedDependencyValidationExpectations,
): string[] {
  const lifecycle = evidence.supabasePostgres;
  const postgres = evidence.postgres as Record<string, unknown> | undefined;
  const usesSupabasePostgres = postgres?.provider === "supabase-postgres";
  if (usesSupabasePostgres && lifecycle === undefined) {
    return ["managed dependency evidence missing Supabase Postgres lifecycle evidence"];
  }
  if (!opts.supabasePostgres && lifecycle === undefined) return [];
  if (opts.supabasePostgres && lifecycle === undefined) {
    return ["managed dependency evidence missing Supabase Postgres lifecycle evidence"];
  }
  if (lifecycle === undefined) return [];
  return [
    ...validateSupabaseManagedPostgresEvidence(lifecycle, {
      expectedRegion: opts.expectedSupabaseRegion || opts.expectedRegion,
      expectedMode: opts.expectedDatabaseConnectivityMode,
    }),
    ...compareExpectedProfile(lifecycle as any, opts.supabasePostgres),
  ];
}

function compareExpectedProfile(value: any, expected: any): string[] {
  if (!expected) return [];
  const actual = value?.profile || {};
  const errors: string[] = [];
  for (const [label, actualValue, expectedValue] of [
    ["organization id", actual.provisioning?.organizationId, expected.provisioning?.organizationId],
    ["project ref", actual.provisioning?.projectRef, expected.provisioning?.projectRef],
    ["region", actual.project?.region, expected.project?.region],
    ["connection mode", actual.connection?.mode, expected.connection?.mode],
  ]) {
    if (String(actualValue || "") !== String(expectedValue || "")) {
      errors.push(`Supabase lifecycle evidence ${label} does not match expected profile`);
    }
  }
  return errors;
}
