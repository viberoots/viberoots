#!/usr/bin/env zx-wrapper
import {
  SUPABASE_POSTGRES_PROFILE_SCHEMA,
  type SupabaseConnectionMode,
  type SupabaseManagedPostgresEvidence,
  type SupabaseManagedPostgresProfile,
} from "./control-plane-supabase-postgres-profile";
import { validateSupabaseEvidenceEnvelope } from "./control-plane-supabase-postgres-evidence-validation";
import {
  CONTROL_PLANE_SCHEMA_PATH,
  CONTROL_PLANE_SCHEMA_AUTHORITY,
  CONTROL_PLANE_SCHEMA_VERSION,
} from "./nixos-shared-host-control-plane-backend-schema";

export function validateSupabaseManagedPostgresProfile(
  value: unknown,
  opts: { expectedRegion?: string; expectedMode?: SupabaseConnectionMode } = {},
): string[] {
  const profile = value as Partial<SupabaseManagedPostgresProfile> | undefined;
  if (!profile || typeof profile !== "object") return ["Supabase Postgres profile is missing"];
  const errors: string[] = [];
  if (profile.schemaVersion !== SUPABASE_POSTGRES_PROFILE_SCHEMA) {
    errors.push("Supabase Postgres profile has unsupported schemaVersion");
  }
  if (profile.lifecycleMode !== "reviewed") {
    errors.push("Supabase Postgres lifecycle profile must be reviewed, not fixture-only");
  }
  const provisioning = profile.provisioning || ({} as any);
  const project = profile.project || ({} as any);
  requireText(errors, provisioning.organizationId, "Supabase organization id");
  requireText(errors, provisioning.projectRef, "Supabase project ref");
  rejectPlaceholder(errors, provisioning.organizationId, "Supabase organization id");
  rejectPlaceholder(errors, provisioning.projectRef, "Supabase project ref");
  requireText(errors, project.databaseIdentityLabel, "Supabase database identity label");
  if (provisioning.mode === "existing-project-import") validateAccessEvidence(errors, provisioning);
  if (provisioning.mode === "new-project-request") validateCostConfirmation(errors, provisioning);
  if (opts.expectedRegion && project.region !== opts.expectedRegion) {
    errors.push("Supabase profile region does not match selected runtime region");
  }
  if (opts.expectedMode && profile.connection?.mode !== opts.expectedMode) {
    errors.push("Supabase profile connection mode does not match selected runtime mode");
  }
  validatePlan(errors, profile as SupabaseManagedPostgresProfile);
  validateBackup(errors, profile.backup);
  validateMigration(errors, profile.migration);
  validateEvidenceOnly(errors, profile.evidenceOnlyActions);
  requireEvidenceRef(
    errors,
    profile.connection?.policyEvidenceRef,
    "Supabase connection policy evidence",
  );
  if (SECRET_PATTERN.test(JSON.stringify(profile))) {
    errors.push("Supabase profile contains secret material");
  }
  return errors;
}

export function validateSupabaseManagedPostgresEvidence(
  value: unknown,
  opts: { expectedRegion?: string; expectedMode?: SupabaseConnectionMode } = {},
): string[] {
  const evidence = value as Partial<SupabaseManagedPostgresEvidence> | undefined;
  return validateSupabaseEvidenceEnvelope(evidence, {
    ...opts,
    validateProfile: validateSupabaseManagedPostgresProfile,
  });
}

function validateAccessEvidence(errors: string[], provisioning: any): void {
  const access = provisioning.accessEvidence || {};
  for (const field of ACCESS_EVIDENCE_FIELDS) {
    requireText(errors, access[field], `Supabase import access evidence ${field}`);
    rejectUnsupportedProfileEvidence(
      errors,
      access[field],
      `Supabase import access evidence ${field}`,
    );
  }
  if (typeof access.source === "string" && !SUPPORTED_ACCESS_EVIDENCE_SOURCES.has(access.source)) {
    errors.push("Supabase import access evidence source is unsupported");
  }
  requireEvidenceRef(errors, access.evidenceRef, "Supabase import access evidence ref");
}

function validateCostConfirmation(errors: string[], provisioning: any): void {
  if (provisioning.costConfirmation?.liveGated !== true) {
    errors.push("Supabase new project request requires live-gated cost confirmation");
  }
  requireText(errors, provisioning.costConfirmation?.confirmationRef, "Supabase cost confirmation");
  requireEvidenceRef(
    errors,
    provisioning.costConfirmation?.confirmationRef,
    "Supabase cost confirmation",
  );
}

function validatePlan(errors: string[], profile: SupabaseManagedPostgresProfile): void {
  const plan = profile.planCapabilities || ({} as any);
  const region = profile.project?.region;
  const mode = profile.connection?.mode;
  if (!plan.supportedRegions?.includes(region)) {
    errors.push("Supabase plan does not support selected region");
  }
  if (!plan.connectionModes?.includes(mode)) {
    errors.push("Supabase plan does not support selected connection mode");
  }
  if (mode === "privatelink" && !plan.privateLinkRegions?.includes(region)) {
    errors.push("Supabase plan/region does not support PrivateLink");
  }
  if (!plan.backup) errors.push("Supabase plan does not prove backup support");
  if (profile.backup?.pitr && !plan.pitr) errors.push("Supabase plan does not prove PITR support");
  if ((plan.retentionDays || 0) < (profile.backup?.retentionDays || 0)) {
    errors.push("Supabase plan retention is lower than selected retention posture");
  }
}

function validateBackup(errors: string[], backup: any): void {
  if (backup?.enabled !== true) errors.push("Supabase backup policy evidence is missing");
  if (backup?.restore?.status !== "passed" || backup.restore.target !== "non-production") {
    errors.push("Supabase restore evidence must prove non-production restore");
  }
  requireEvidenceRef(errors, backup?.policyEvidenceRef, "Supabase backup policy evidence");
  requireEvidenceRef(errors, backup?.restore?.evidenceRef, "Supabase restore evidence");
}

function validateMigration(errors: string[], migration: any): void {
  if (migration?.schemaAuthority !== CONTROL_PLANE_SCHEMA_AUTHORITY) {
    errors.push("Supabase migration readiness must reference the reviewed schema authority");
  }
  if (migration?.schemaVersion !== CONTROL_PLANE_SCHEMA_VERSION) {
    errors.push("Supabase migration readiness schema version does not match reviewed schema");
  }
  if (migration?.schemaPath !== CONTROL_PLANE_SCHEMA_PATH) {
    errors.push("Supabase migration readiness schema path does not match reviewed schema");
  }
  if (migration?.migrationVersion !== CONTROL_PLANE_SCHEMA_VERSION) {
    errors.push("Supabase migration version does not match reviewed schema version");
  }
  requireEvidenceRef(errors, migration?.lockEvidenceRef, "Supabase migration lock evidence");
  requireEvidenceRef(
    errors,
    migration?.compatibilityEvidenceRef,
    "Supabase schema compatibility evidence",
  );
  if (migration?.connection === "pgbouncer" && !migration?.pgbouncerProofRef) {
    errors.push("PgBouncer migration path requires operation-specific proof");
  }
  if (migration?.users?.separated !== true) {
    errors.push("Supabase migration and runtime user separation evidence is missing");
  }
  if (migration?.users?.separated === true) {
    requireEvidenceRef(
      errors,
      migration.users.migrationUserRef,
      "Supabase migration user evidence",
    );
    requireEvidenceRef(errors, migration.users.runtimeUserRef, "Supabase runtime user evidence");
  }
}

function validateEvidenceOnly(errors: string[], actions: any): void {
  for (const action of Array.isArray(actions) ? actions : []) {
    if (action.mutationAuthority !== false) {
      errors.push("Supabase dashboard/support steps cannot be mutation authority");
    }
    requireEvidenceRef(errors, action.evidenceRef, "Supabase dashboard/support evidence ref");
  }
}

function requireText(errors: string[], value: unknown, label: string): void {
  if (typeof value !== "string" || !value.trim()) errors.push(`${label} is missing`);
}

function requireEvidenceRef(errors: string[], value: unknown, label: string): void {
  requireText(errors, value, label);
  const text = String(value || "");
  if (!/^(evidence:\/\/|sha256:)[A-Za-z0-9._:/-]+$/.test(text)) {
    errors.push(`${label} must be a structured evidence reference`);
  }
  rejectPlaceholder(errors, text, label);
  rejectUnsupportedProfileEvidence(errors, text, label);
}

function rejectPlaceholder(errors: string[], value: unknown, label: string): void {
  if (
    /\b(fixture[- ]only|placeholder|reviewed-supabase|reviewed-import)\b/i.test(String(value || ""))
  ) {
    errors.push(`${label} must not be placeholder evidence`);
  }
}

function rejectUnsupportedProfileEvidence(errors: string[], value: unknown, label: string): void {
  if (UNSUPPORTED_PROFILE_EVIDENCE_PATTERN.test(String(value || ""))) {
    errors.push(`${label} must be reviewed provider evidence`);
  }
}

const ACCESS_EVIDENCE_FIELDS = [
  "source",
  "checkedAt",
  "actor",
  "organizationRole",
  "projectRole",
  "evidenceRef",
] as const;
const SUPPORTED_ACCESS_EVIDENCE_SOURCES = new Set<string>(["supabase-api", "reviewed-import"]);
const UNSUPPORTED_PROFILE_EVIDENCE_PATTERN =
  /\b(self[- ]attested|dashboard[- ]only|raw[- ]iac[- ]only|manual[- ]only|manual[- ]notes?|notes?[- ]only|screenshots?|screen[- ]shots?)\b|(?:^|[/:_-])test(?:[/:_-]|$)|\btest-ref\b|placeholder|fixture[- ]only/i;
const SECRET_PATTERN =
  /postgres(?:ql)?:\/\/[^<\s]+:[^<\s]+@|service[_-]?role|password|secret|token/i;
