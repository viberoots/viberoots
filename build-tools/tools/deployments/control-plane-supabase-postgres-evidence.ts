import crypto from "node:crypto";
import type {
  SupabaseManagedPostgresEvidence,
  SupabaseManagedPostgresProfile,
  SupabaseProfileIdentity,
} from "./control-plane-supabase-postgres-profile";
import { SUPABASE_POSTGRES_EVIDENCE_SCHEMA } from "./control-plane-supabase-postgres-profile";

export function buildSupabaseManagedPostgresEvidence(
  profile: SupabaseManagedPostgresProfile,
  opts: {
    checkedAt?: string;
    maxAgeMinutes?: number;
    source?: SupabaseManagedPostgresEvidence["source"];
  } = {},
): SupabaseManagedPostgresEvidence {
  const checkedAt = opts.checkedAt || new Date().toISOString();
  return {
    schemaVersion: SUPABASE_POSTGRES_EVIDENCE_SCHEMA,
    source: opts.source || "generated-provider-hook",
    checkedAt,
    maxAgeMinutes: opts.maxAgeMinutes ?? 60,
    selectedProfileIdentity: supabaseProfileIdentity(profile),
    planCapabilityBinding: {
      source: profile.planCapabilities.source,
      planClass: profile.planCapabilities.planClass,
      region: profile.project.region,
      connectionMode: profile.connection.mode,
      backup: profile.planCapabilities.backup,
      pitr: profile.planCapabilities.pitr,
      retentionDays: profile.planCapabilities.retentionDays,
    },
    userSeparationPolicyBinding: {
      required: true,
      separated: profile.migration.users?.separated === true,
      migrationUserRef: profile.migration.users?.migrationUserRef,
      runtimeUserRef: profile.migration.users?.runtimeUserRef,
    },
    migrationSchemaBinding: {
      authority: profile.migration.schemaAuthority,
      version: profile.migration.schemaVersion,
      path: profile.migration.schemaPath,
      migrationVersion: profile.migration.migrationVersion,
      digest: supabaseMigrationSchemaDigest(profile),
    },
    profile,
  };
}

export function supabaseMigrationSchemaDigest(profile: SupabaseManagedPostgresProfile): string {
  return digestJson({
    authority: profile.migration.schemaAuthority,
    version: profile.migration.schemaVersion,
    path: profile.migration.schemaPath,
    migrationVersion: profile.migration.migrationVersion,
  });
}

export function supabaseProfileIdentity(
  profile: SupabaseManagedPostgresProfile,
): SupabaseProfileIdentity {
  return {
    organizationId: profile.provisioning.organizationId,
    projectRef: profile.provisioning.projectRef,
    region: profile.project.region,
    mode: profile.connection.mode,
  };
}

function digestJson(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
