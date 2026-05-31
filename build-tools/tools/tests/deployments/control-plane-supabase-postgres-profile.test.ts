#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateManagedDependencyEvidence } from "../../deployments/control-plane-managed-dependency-validation";
import { parseManagedDependencyProfile } from "../../deployments/control-plane-managed-dependency-profiles";
import {
  defaultSupabaseManagedPostgresProfile,
  reviewedSupabaseManagedPostgresProfile,
} from "../../deployments/control-plane-supabase-postgres-profile";
import { validateSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-validation";
import { managedDependencyEvidence } from "./cloud-control-cutover-managed-dependencies.fixture";

test("Supabase profile validates existing-project access, plan, backup, and migration authority", () => {
  const profile = reviewedSupabaseManagedPostgresProfile({
    instanceId: "cloud-control-plane",
    region: "us-east-1",
    mode: "privatelink",
    organizationId: "org-control-plane-prod",
    projectRef: "project-review",
  });
  assert.deepEqual(
    validateSupabaseManagedPostgresProfile(profile, {
      expectedRegion: "us-east-1",
      expectedMode: "privatelink",
    }),
    [],
  );
  const broken = {
    ...profile,
    provisioning: { ...profile.provisioning, accessEvidence: undefined },
    planCapabilities: {
      ...profile.planCapabilities,
      connectionModes: ["public"],
      privateLinkRegions: [],
      pitr: false,
    },
    backup: { ...profile.backup, enabled: false },
    migration: {
      ...profile.migration,
      schemaVersion: "other",
      migrationVersion: "",
      lockEvidenceRef: "nonempty",
      compatibilityEvidenceRef: "manual-note",
      connection: "pgbouncer",
      users: { separated: true },
    },
  };
  const errors = validateSupabaseManagedPostgresProfile(broken as any, {
    expectedRegion: "us-east-1",
    expectedMode: "privatelink",
  }).join("\n");
  assert.match(errors, /import access evidence/);
  assert.match(errors, /does not support selected connection mode/);
  assert.match(errors, /does not support PrivateLink/);
  assert.match(errors, /does not prove PITR support/);
  assert.match(errors, /backup policy evidence is missing/);
  assert.match(errors, /schema version does not match reviewed schema/);
  assert.match(errors, /migration version does not match reviewed schema version/);
  assert.match(errors, /migration lock evidence must be a structured evidence reference/);
  assert.match(errors, /schema compatibility evidence must be a structured evidence reference/);
  assert.match(errors, /PgBouncer migration path requires operation-specific proof/);
  assert.match(errors, /migration user evidence.*runtime user evidence/s);
});

test("fixture-only Supabase profiles and placeholder refs fail closed", () => {
  const fixture = defaultSupabaseManagedPostgresProfile({
    instanceId: "cloud-control-plane",
    region: "us-east-1",
    mode: "privatelink",
  });
  const errors = validateSupabaseManagedPostgresProfile(fixture).join("\n");
  assert.match(errors, /must be reviewed, not fixture-only/);
  assert.match(errors, /must not be placeholder evidence/);
});

test("managed dependency evidence requires profile-derived Supabase lifecycle readiness", () => {
  const profile = reviewedSupabaseManagedPostgresProfile({
    instanceId: "cloud-control-plane",
    region: "us-east-1",
    mode: "privatelink",
    organizationId: "org-control-plane-prod",
    projectRef: "project-review",
  });
  const missing = validateManagedDependencyEvidence(
    managedDependencyEvidence({
      supabasePostgres: undefined,
    }),
    60,
    { supabasePostgres: profile },
  ).join("\n");
  assert.match(missing, /missing Supabase Postgres lifecycle evidence/);

  const invalid = validateManagedDependencyEvidence(
    managedDependencyEvidence({
      supabasePostgres: {
        schemaVersion: "supabase-managed-postgres-evidence@1",
        checkedAt: new Date().toISOString(),
        profile: {
          ...profile,
          backup: { ...profile.backup, restore: { ...profile.backup.restore, status: "missing" } },
        },
      },
    }),
    60,
    { supabasePostgres: profile },
  ).join("\n");
  assert.match(invalid, /restore evidence must prove non-production restore/);
});

test("managed dependency profile import rejects fixture Supabase lifecycle profiles", () => {
  const fixture = defaultSupabaseManagedPostgresProfile({
    instanceId: "cloud-control-plane",
    region: "us-east-1",
    mode: "public",
  });
  assert.throws(
    () =>
      parseManagedDependencyProfile(
        [
          "profileName: fixture",
          "runtimePath:",
          "  expectedHostProfile: aws-ec2",
          "  expectedAwsRegion: us-east-1",
          "  databaseConnectivityMode: public",
          `supabasePostgres: ${JSON.stringify(fixture)}`,
          "postgres:",
          "  provider: supabase-postgres",
          "  urlFile: /run/credentials/db",
          "artifactStore:",
          "  provider: aws-s3",
          "  credentialMode: aws-instance-profile",
          "  bucket: artifacts",
          "  region: us-east-1",
          "  endpointFile: /run/credentials/endpoint",
        ].join("\n"),
        { credentialDirectory: "/run/credentials", baseDir: "/tmp/profile" },
      ),
    /fixture-only|placeholder/,
  );
});

test("managed dependency profile import rejects missing Supabase lifecycle profile", () => {
  assert.throws(
    () =>
      parseManagedDependencyProfile(
        [
          "profileName: missing-supabase",
          "runtimePath:",
          "  expectedHostProfile: aws-ec2",
          "  expectedAwsRegion: us-east-1",
          "  databaseConnectivityMode: public",
          "postgres:",
          "  provider: supabase-postgres",
          "  urlFile: /run/credentials/db",
          "artifactStore:",
          "  provider: aws-s3",
          "  credentialMode: aws-instance-profile",
          "  bucket: artifacts",
          "  region: us-east-1",
          "  endpointFile: /run/credentials/endpoint",
        ].join("\n"),
        { credentialDirectory: "/run/credentials", baseDir: "/tmp/profile" },
      ),
    /requires supabasePostgres/,
  );
  assert.match(
    validateManagedDependencyEvidence(
      managedDependencyEvidence({ supabasePostgres: undefined }),
      60,
    ).join("\n"),
    /missing Supabase Postgres lifecycle evidence/,
  );
});
