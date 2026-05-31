import { freshEvidenceAt } from "./cloud-control-evidence-helpers";
import {
  SUPABASE_POSTGRES_EVIDENCE_SCHEMA,
  type SupabaseConnectionMode,
  type SupabaseManagedPostgresEvidence,
  type SupabaseManagedPostgresProfile,
} from "./control-plane-supabase-postgres-profile";
import {
  supabaseMigrationSchemaDigest,
  supabaseProfileIdentity,
} from "./control-plane-supabase-postgres-evidence";

export function validateSupabaseEvidenceEnvelope(
  evidence: Partial<SupabaseManagedPostgresEvidence> | undefined,
  opts: {
    expectedRegion?: string;
    expectedMode?: SupabaseConnectionMode;
    validateProfile: (
      value: unknown,
      opts: { expectedRegion?: string; expectedMode?: SupabaseConnectionMode },
    ) => string[];
  },
): string[] {
  if (!evidence || typeof evidence !== "object") return ["Supabase Postgres evidence is missing"];
  const errors: string[] = [];
  if (evidence.schemaVersion !== SUPABASE_POSTGRES_EVIDENCE_SCHEMA) {
    errors.push("Supabase Postgres evidence has unsupported schemaVersion");
  }
  if (!freshEvidenceAt(evidence as Record<string, unknown>, { maxAgeMinutes: maxAge(evidence) })) {
    errors.push("Supabase Postgres evidence is missing or stale");
  }
  if (
    evidence.source !== "generated-provider-hook" &&
    evidence.source !== "reviewed-lifecycle-export"
  ) {
    errors.push("Supabase Postgres evidence source is missing or unsupported");
  }
  if (!Number.isFinite(maxAge(evidence)) || maxAge(evidence) <= 0) {
    errors.push("Supabase Postgres evidence maxAgeMinutes is missing or invalid");
  }
  const profile = evidence.profile as SupabaseManagedPostgresProfile | undefined;
  errors.push(...opts.validateProfile(profile, opts));
  if (profile) {
    errors.push(...validateIdentityBinding(evidence, profile));
    errors.push(...validatePlanBinding(evidence, profile));
    errors.push(...validateUserSeparationBinding(evidence, profile));
    errors.push(...validateMigrationBinding(evidence, profile));
  }
  return errors;
}

function validateIdentityBinding(evidence: any, profile: SupabaseManagedPostgresProfile): string[] {
  return compareFields(
    "selected profile identity",
    evidence.selectedProfileIdentity,
    supabaseProfileIdentity(profile),
  );
}

function validatePlanBinding(evidence: any, profile: SupabaseManagedPostgresProfile): string[] {
  return compareFields("plan capability binding", evidence.planCapabilityBinding, {
    source: profile.planCapabilities.source,
    planClass: profile.planCapabilities.planClass,
    region: profile.project.region,
    connectionMode: profile.connection.mode,
    backup: profile.planCapabilities.backup,
    pitr: profile.planCapabilities.pitr,
    retentionDays: profile.planCapabilities.retentionDays,
  });
}

function validateUserSeparationBinding(
  evidence: any,
  profile: SupabaseManagedPostgresProfile,
): string[] {
  return compareFields("user separation policy binding", evidence.userSeparationPolicyBinding, {
    required: true,
    separated: profile.migration.users?.separated === true,
    migrationUserRef: profile.migration.users?.migrationUserRef,
    runtimeUserRef: profile.migration.users?.runtimeUserRef,
  });
}

function validateMigrationBinding(
  evidence: any,
  profile: SupabaseManagedPostgresProfile,
): string[] {
  return compareFields("migration schema binding", evidence.migrationSchemaBinding, {
    authority: profile.migration.schemaAuthority,
    version: profile.migration.schemaVersion,
    path: profile.migration.schemaPath,
    migrationVersion: profile.migration.migrationVersion,
    digest: supabaseMigrationSchemaDigest(profile),
  });
}

function compareFields(
  label: string,
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
): string[] {
  return Object.entries(expected).flatMap(([field, expectedValue]) =>
    actual && String(actual[field] ?? "") === String(expectedValue ?? "")
      ? []
      : [`Supabase ${label} ${field} does not match selected profile`],
  );
}

function maxAge(evidence: Partial<SupabaseManagedPostgresEvidence>): number {
  return Number(evidence.maxAgeMinutes);
}
