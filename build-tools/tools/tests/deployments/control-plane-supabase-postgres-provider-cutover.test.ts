#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { validateProviderCapabilityHookEvidenceShape } from "../../deployments/cloud-control-provider-capability-hook-contract";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { reviewedSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-profile";
import { buildSupabaseManagedPostgresEvidence } from "../../deployments/control-plane-supabase-postgres-evidence";
import { evidence, IMAGE_BUILD_IDENTITY } from "./cloud-control-cutover-fixture";
import { managedDependencyEvidence } from "./cloud-control-cutover-managed-dependencies.fixture";
import { publicSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

test("Supabase provider hook payload is structured evidence-only lifecycle proof", async () => {
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "supabase-managed-postgres",
    phase: "evidence",
    deploymentLabel: "//deployments:staging",
    supabasePostgresProfile: publicSupabaseProfile(),
  });
  assert.deepEqual(
    validateProviderCapabilityHookEvidenceShape("supabase-managed-postgres", hook, {
      allowedPhases: ["evidence"],
    }),
    [],
  );
  assert.match(
    validateProviderCapabilityHookEvidenceShape(
      "supabase-managed-postgres",
      {
        ...hook,
        providerPayload: {
          ...hook.providerPayload,
          automatedProvisioningSuccess: true,
          mutationAuthority: true,
        },
      },
      { allowedPhases: ["evidence"] },
    ).join("\n"),
    /cannot be provisioning authority/,
  );
  assert.match(
    validateProviderCapabilityHookEvidenceShape(
      "supabase-managed-postgres",
      {
        ...hook,
        providerPayload: {
          ...hook.providerPayload,
          lifecycleEvidence: {
            ...(hook.providerPayload?.lifecycleEvidence as Record<string, unknown>),
            profile: {
              ...((hook.providerPayload?.lifecycleEvidence as any).profile as Record<
                string,
                unknown
              >),
              project: {
                ...((hook.providerPayload?.lifecycleEvidence as any).profile.project as Record<
                  string,
                  unknown
                >),
                region: "us-west-2",
              },
            },
          },
        },
      },
      { allowedPhases: ["evidence"] },
    ).join("\n"),
    /region does not match selected profile/,
  );
  assert.match(
    validateProviderCapabilityHookEvidenceShape(
      "supabase-managed-postgres",
      { ...hook, providerPayload: { notes: "reviewed in dashboard" } },
      { allowedPhases: ["evidence"] },
    ).join("\n"),
    /missing Supabase managed Postgres provider payload evidence/,
  );
  assert.match(
    validateProviderCapabilityHookEvidenceShape(
      "supabase-managed-postgres",
      {
        ...hook,
        providerPayload: {
          ...hook.providerPayload,
          lifecycleEvidence: {
            ...(hook.providerPayload?.lifecycleEvidence as Record<string, unknown>),
            source: "self-attested",
          },
        },
      },
      { allowedPhases: ["evidence"] },
    ).join("\n"),
    /self-attested\/dashboard\/manual\/raw notes/,
  );
});

test("cutover consumes Supabase profile-derived project expectations", () => {
  const imported = managedDependencyEvidence();
  const profile = (imported.supabasePostgres as any).profile;
  const wrongProfile = {
    ...profile,
    provisioning: { ...profile.provisioning, projectRef: "other-project" },
  };
  const result = validateCloudControlCutover(
    evidence({
      managedDependencies: managedDependencyEvidence({
        supabasePostgres: buildSupabaseManagedPostgresEvidence(wrongProfile),
      }),
    }),
    {
      operation: "cutover",
      expectedHostProfile: "aws-ec2",
      expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
      expectedRegion: "us-east-1",
      selectedCapabilities: [],
      maxAgeMinutes: 60,
    },
  );
  assert.match(
    result.errors.join("\n"),
    /managed Postgres Supabase project ref does not match expected value/,
  );
});

test("cutover rejects bare Supabase profile without freshness-gated lifecycle evidence", () => {
  const result = validateCloudControlCutover(
    evidence({
      supabasePostgresProfile: (managedDependencyEvidence().supabasePostgres as any).profile,
      managedDependencies: { ...managedDependencyEvidence(), supabasePostgres: undefined },
      providerCapabilities: {},
    }),
    {
      operation: "cutover",
      expectedHostProfile: "aws-ec2",
      expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
      expectedRegion: "us-east-1",
      selectedCapabilities: [],
      maxAgeMinutes: 60,
    },
  );
  assert.match(result.errors.join("\n"), /freshness-gated Supabase Postgres lifecycle evidence/);
});

test("cutover rejects consistently wrong managed lifecycle evidence against selected profile", () => {
  const imported = managedDependencyEvidence();
  const wrongProfile = reviewedSupabaseManagedPostgresProfile({
    instanceId: "cloud-control-plane",
    region: "us-west-2",
    mode: "public",
    organizationId: "org-other",
    projectRef: "other-project",
  });
  const result = validateCloudControlCutover(
    evidence({
      managedDependencies: managedDependencyEvidence({
        runtimePath: {
          ...(imported.runtimePath as Record<string, unknown>),
          databaseConnectivityMode: "public",
          supabaseProjectRef: "other-project",
          supabaseRegion: "us-west-2",
        },
        postgres: {
          ...(imported.postgres as Record<string, unknown>),
          databaseConnectivityMode: "public",
          supabaseProjectRef: "other-project",
          supabaseRegion: "us-west-2",
        },
        supabasePostgres: buildSupabaseManagedPostgresEvidence(wrongProfile),
      }),
      providerCapabilities: {},
    }),
    {
      operation: "cutover",
      expectedHostProfile: "aws-ec2",
      expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
      expectedRegion: "us-east-1",
      selectedCapabilities: [],
      maxAgeMinutes: 60,
    },
  );
  assert.match(result.errors.join("\n"), /region does not match selected runtime region/);
});

test("cutover reconciles selected Supabase profile project ref with topology", () => {
  const imported = managedDependencyEvidence();
  const wrongProfile = reviewedSupabaseManagedPostgresProfile({
    instanceId: "cloud-control-plane",
    region: "us-east-1",
    mode: "privatelink",
    organizationId: "org-control-plane-prod",
    projectRef: "other-project",
  });
  const result = validateCloudControlCutover(
    evidence({
      supabasePostgresProfile: wrongProfile,
      managedDependencies: managedDependencyEvidence({
        runtimePath: {
          ...(imported.runtimePath as Record<string, unknown>),
          supabaseProjectRef: "other-project",
        },
        postgres: {
          ...(imported.postgres as Record<string, unknown>),
          supabaseProjectRef: "other-project",
        },
        supabasePostgres: buildSupabaseManagedPostgresEvidence(wrongProfile),
      }),
    }),
    {
      operation: "cutover",
      expectedHostProfile: "aws-ec2",
      expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
      expectedRegion: "us-east-1",
      selectedCapabilities: [],
      maxAgeMinutes: 60,
    },
  );
  assert.match(
    result.errors.join("\n"),
    /lifecycle evidence project ref does not match selected cutover profile/,
  );
});
