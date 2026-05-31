#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateManagedDependencyEvidence } from "../../deployments/control-plane-managed-dependency-validation";
import { buildSupabaseManagedPostgresEvidence } from "../../deployments/control-plane-supabase-postgres-evidence";
import { reviewedSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-profile";
import { validateSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-validation";
import { managedDependencyEvidence } from "./cloud-control-cutover-managed-dependencies.fixture";

test("Supabase setup and managed lifecycle evidence reject unsafe access evidence sources", () => {
  const profile = reviewedSupabaseManagedPostgresProfile({
    instanceId: "cloud-control-plane",
    region: "us-east-1",
    mode: "public",
    organizationId: "org-control-plane-prod",
    projectRef: "project-review",
  });
  for (const source of ["self-attested", "dashboard-only"]) {
    const unsafe = accessSourceProfile(profile, source);
    assert.match(validateSupabaseManagedPostgresProfile(unsafe).join("\n"), /reviewed provider/);
    assert.match(
      validateManagedDependencyEvidence(
        managedDependencyEvidence({
          supabasePostgres: buildSupabaseManagedPostgresEvidence(unsafe),
        }),
        60,
        { supabasePostgres: profile },
      ).join("\n"),
      /reviewed provider/,
    );
  }
});

function accessSourceProfile(profile: any, source: string) {
  return {
    ...profile,
    provisioning: {
      ...profile.provisioning,
      accessEvidence: { ...profile.provisioning.accessEvidence, source },
    },
  };
}
