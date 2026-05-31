#!/usr/bin/env zx-wrapper
import {
  CONTROL_PLANE_SCHEMA_AUTHORITY,
  CONTROL_PLANE_SCHEMA_PATH,
  CONTROL_PLANE_SCHEMA_VERSION,
} from "./nixos-shared-host-control-plane-backend-schema";

export const SUPABASE_POSTGRES_PROFILE_SCHEMA = "supabase-managed-postgres-profile@1";
export const SUPABASE_POSTGRES_EVIDENCE_SCHEMA = "supabase-managed-postgres-evidence@1";

export type SupabaseConnectionMode = "public" | "privatelink";
export type SupabaseProvisioningMode = "existing-project-import" | "new-project-request";

export type SupabaseManagedPostgresProfile = {
  schemaVersion: typeof SUPABASE_POSTGRES_PROFILE_SCHEMA;
  lifecycleMode: "reviewed" | "fixture";
  provisioning: {
    mode: SupabaseProvisioningMode;
    organizationId: string;
    projectRef: string;
    accessEvidence?: EvidenceRef;
    costConfirmation?: { liveGated: boolean; confirmationRef: string };
  };
  project: {
    region: string;
    planClass: string;
    environment: string;
    databaseIdentityLabel: string;
  };
  connection: { mode: SupabaseConnectionMode; policyEvidenceRef: string };
  planCapabilities: {
    source: "supabase-api" | "reviewed-plan-evidence";
    checkedAt: string;
    planClass: string;
    supportedRegions: string[];
    connectionModes: SupabaseConnectionMode[];
    backup: boolean;
    pitr: boolean;
    retentionDays: number;
    privateLinkRegions?: string[];
  };
  backup: {
    enabled: boolean;
    pitr: boolean;
    retentionDays: number;
    policyEvidenceRef: string;
    restore: { status: "passed"; target: "non-production"; evidenceRef: string };
  };
  migration: {
    schemaAuthority: string;
    schemaVersion: string;
    schemaPath: string;
    migrationVersion: string;
    lockEvidenceRef: string;
    compatibilityEvidenceRef: string;
    connection: "direct" | "pgbouncer";
    pgbouncerProofRef?: string;
    users?: { migrationUserRef?: string; runtimeUserRef?: string; separated?: boolean };
  };
  evidenceOnlyActions?: Array<{ action: string; evidenceRef: string; mutationAuthority: false }>;
};

export type SupabaseManagedPostgresEvidence = {
  schemaVersion: typeof SUPABASE_POSTGRES_EVIDENCE_SCHEMA;
  checkedAt: string;
  profile: SupabaseManagedPostgresProfile;
};

type EvidenceRef = {
  source: "supabase-api" | "reviewed-import";
  checkedAt: string;
  actor: string;
  organizationRole: string;
  projectRole: string;
  evidenceRef: string;
};

export function defaultSupabaseManagedPostgresProfile(opts: {
  instanceId: string;
  region: string;
  mode: SupabaseConnectionMode;
  organizationId?: string;
  projectRef?: string;
  planClass?: string;
  environment?: string;
}): SupabaseManagedPostgresProfile {
  return supabaseManagedPostgresProfile({ ...opts, lifecycleMode: "fixture" });
}

export function reviewedSupabaseManagedPostgresProfile(opts: {
  instanceId: string;
  region: string;
  mode: SupabaseConnectionMode;
  organizationId: string;
  projectRef: string;
  planClass?: string;
  environment?: string;
}): SupabaseManagedPostgresProfile {
  return supabaseManagedPostgresProfile({ ...opts, lifecycleMode: "reviewed" });
}

function supabaseManagedPostgresProfile(opts: {
  instanceId: string;
  region: string;
  mode: SupabaseConnectionMode;
  lifecycleMode: "reviewed" | "fixture";
  organizationId?: string;
  projectRef?: string;
  planClass?: string;
  environment?: string;
}): SupabaseManagedPostgresProfile {
  const region = opts.region;
  const prefix = opts.lifecycleMode === "fixture" ? "fixture-only" : "evidence://supabase";
  return {
    schemaVersion: SUPABASE_POSTGRES_PROFILE_SCHEMA,
    lifecycleMode: opts.lifecycleMode,
    provisioning: {
      mode: "existing-project-import",
      organizationId: opts.organizationId || `${prefix}-supabase-org`,
      projectRef: opts.projectRef || `${prefix}-supabase-project`,
      accessEvidence: evidence("reviewed-import", `${prefix}-supabase-org-project-access`),
    },
    project: {
      region,
      planClass: opts.planClass || "team",
      environment: opts.environment || "production",
      databaseIdentityLabel: `${opts.instanceId}-supabase-postgres`,
    },
    connection: { mode: opts.mode, policyEvidenceRef: `${prefix}-supabase-connection-policy` },
    planCapabilities: {
      source: "reviewed-plan-evidence",
      checkedAt: new Date().toISOString(),
      planClass: opts.planClass || "team",
      supportedRegions: [region],
      connectionModes: opts.mode === "privatelink" ? ["public", "privatelink"] : ["public"],
      backup: true,
      pitr: true,
      retentionDays: 7,
      privateLinkRegions: opts.mode === "privatelink" ? [region] : [],
    },
    backup: {
      enabled: true,
      pitr: true,
      retentionDays: 7,
      policyEvidenceRef: `${prefix}-supabase-backup-policy`,
      restore: {
        status: "passed",
        target: "non-production",
        evidenceRef: `${prefix}-supabase-restore-non-production`,
      },
    },
    migration: {
      schemaAuthority: CONTROL_PLANE_SCHEMA_AUTHORITY,
      schemaVersion: CONTROL_PLANE_SCHEMA_VERSION,
      schemaPath: CONTROL_PLANE_SCHEMA_PATH,
      migrationVersion: CONTROL_PLANE_SCHEMA_VERSION,
      lockEvidenceRef: `${prefix}-control-plane-schema-migration-lock`,
      compatibilityEvidenceRef: `${prefix}-control-plane-schema-compatibility`,
      connection: "direct",
      users: {
        migrationUserRef: `${prefix}-control-plane-migration-user`,
        runtimeUserRef: `${prefix}-control-plane-runtime-user`,
        separated: true,
      },
    },
    evidenceOnlyActions:
      opts.mode === "privatelink"
        ? [
            {
              action: "supabase-dashboard-privatelink-share",
              evidenceRef: `${prefix}-privatelink-request`,
              mutationAuthority: false,
            },
          ]
        : [],
  };
}

function evidence(source: EvidenceRef["source"], evidenceRef: string): EvidenceRef {
  return {
    source,
    checkedAt: new Date().toISOString(),
    actor: "reviewed-operator",
    organizationRole: "owner",
    projectRole: "owner",
    evidenceRef,
  };
}
