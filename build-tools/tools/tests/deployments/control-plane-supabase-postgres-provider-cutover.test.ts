#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { validateProviderCapabilityHookEvidenceShape } from "../../deployments/cloud-control-provider-capability-hook-contract";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { reviewedSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-profile";
import { evidence, IMAGE_BUILD_IDENTITY } from "./cloud-control-cutover-fixture";
import { managedDependencyEvidence } from "./cloud-control-cutover-managed-dependencies.fixture";

test("Supabase provider hook payload is structured evidence-only lifecycle proof", async () => {
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "supabase-managed-postgres",
    phase: "evidence",
    deploymentLabel: "//deployments:staging",
    supabasePostgresProfile: reviewedSupabaseManagedPostgresProfile({
      instanceId: "cloud-control-plane",
      region: "us-east-1",
      mode: "public",
      organizationId: "org-control-plane-prod",
      projectRef: "project-review",
    }),
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
});

test("cutover consumes Supabase profile-derived project expectations", () => {
  const imported = managedDependencyEvidence();
  const profile = (imported.supabasePostgres as any).profile;
  const result = validateCloudControlCutover(
    evidence({
      managedDependencies: managedDependencyEvidence({
        supabasePostgres: {
          ...(imported.supabasePostgres as Record<string, unknown>),
          profile: {
            ...profile,
            provisioning: { ...profile.provisioning, projectRef: "other-project" },
          },
        },
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
  assert.match(result.errors.join("\n"), /project ref does not match expected profile/);
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
        supabasePostgres: {
          ...(imported.supabasePostgres as Record<string, unknown>),
          profile: wrongProfile,
        },
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
  assert.match(result.errors.join("\n"), /does not match expected profile/);
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
        supabasePostgres: {
          ...(imported.supabasePostgres as Record<string, unknown>),
          profile: wrongProfile,
        },
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
  assert.match(result.errors.join("\n"), /profile project ref does not match selected topology/);
});
