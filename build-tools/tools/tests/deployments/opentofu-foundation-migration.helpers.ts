#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { OpenTofuDeployment } from "../../deployments/contract";
import type { FoundationMigrationAdapter } from "../../deployments/foundation-migration";
import { OPENTOFU_STACK_PROVISIONER } from "../../deployments/opentofu-stack";

const BRANCH_PROTECTIONS = [
  {
    stage: "dev",
    branch: "main",
    requiredChecks: [],
    fastForwardOnly: true,
    normalAdvancePrincipals: ["app:deploy-bot"],
    emergencyDirectPushPrincipals: ["team:sre-break-glass"],
  },
];

export function foundationDeploymentFixture(): OpenTofuDeployment {
  const lanePolicy: any = {
    ref: "//projects/deployments/platform-shared:lane",
    name: "lane",
    stages: ["dev"],
    stageBranches: { dev: "main" },
    allowedPromotionEdges: [],
    artifactReuseMode: "same_artifact",
    governanceRef: "//projects/deployments/platform-shared:lane_governance",
    governance: {
      scmBackend: "github",
      repository: "kiltyj/viberoots",
      branchProtections: BRANCH_PROTECTIONS,
      fingerprint: "sha256:governance",
    },
    fingerprint: "sha256:lane",
  };
  const admissionPolicy: any = {
    ref: "//projects/deployments/platform-shared:dev_release",
    name: "dev_release",
    allowedRefs: [],
    requiredChecks: [],
    requiredApprovals: [],
    retryBranchPolicy: "branch_independent",
    retryApprovalReuse: "fresh_only",
    artifactAttestationMode: "recorded_exact_artifact",
    supplyChainGates: [],
    fingerprint: "sha256:admission",
  };
  return {
    deploymentId: "platform-foundation-dev",
    label: "//projects/deployments/platform-foundation-dev:deploy",
    name: "deploy",
    provider: "opentofu",
    protectionClass: "local_only",
    lanePolicyRef: lanePolicy.ref,
    lanePolicy,
    environmentStage: "dev",
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    prerequisites: [],
    secretRequirements: [
      {
        name: "opentofu-provider-credentials",
        step: "provision",
        contractId: "secret://deployments/phase0/platform-foundation-dev/opentofu",
        required: true,
      },
      {
        name: "supabase-service-role",
        step: "provision",
        contractId: "secret://deployments/phase0/platform-foundation-dev/supabase-service-role",
        required: true,
      },
    ],
    runtimeConfigRequirements: [],
    releaseActions: [],
    targetExceptions: [],
    migrationBundleRef: "//projects/deployments/platform-shared:migration_bundle",
    component: {
      kind: "provision-only",
      target: "//projects/deployments/platform-shared:migration_bundle",
    },
    components: [
      {
        id: "default",
        kind: "provision-only",
        target: "//projects/deployments/platform-shared:migration_bundle",
      },
    ],
    publisher: { type: "provision-only" },
    provisioner: {
      type: OPENTOFU_STACK_PROVISIONER,
      config: "opentofu/stack.json",
      stackDirectory: "opentofu",
      stackIdentity: "phase0/platform-foundation/dev",
      stateBackendIdentity: "s3://state/dev/platform-foundation",
      allowedEnvironmentDifferences: [],
    },
    providerTarget: {
      provider: "opentofu",
      stackIdentity: "phase0/platform-foundation/dev",
      stateBackendIdentity: "s3://state/dev/platform-foundation",
      providerTargetIdentity:
        "opentofu:phase0/platform-foundation/dev#state:s3://state/dev/platform-foundation",
      allowedEnvironmentDifferences: [],
    },
  };
}

export function laneGovernanceEvidence(deployment: OpenTofuDeployment) {
  return {
    laneGovernance: {
      lanePolicyRef: deployment.lanePolicyRef,
      governanceRef: deployment.lanePolicy.governanceRef,
      governanceFingerprint: deployment.lanePolicy.governance.fingerprint,
      verifiedAt: "2026-05-07T12:00:00.000Z",
      verificationSource: "client_supplied" as const,
      scmBackend: "github" as const,
      repository: "kiltyj/viberoots",
      branchProtections: BRANCH_PROTECTIONS,
    },
  };
}

export function openTofuAdmittedContextFixture(target: OpenTofuDeployment) {
  return {
    lanePolicyRef: target.lanePolicyRef,
    lanePolicyFingerprint: target.lanePolicy.fingerprint,
    admissionPolicyRef: target.admissionPolicyRef,
    admissionPolicyFingerprint: target.admissionPolicy.fingerprint,
    environmentStage: target.environmentStage,
    secretRequirements: target.secretRequirements,
    admittedSecretReferences: [],
    runtimeConfigRequirements: [],
    referenceResolutionPolicy: {
      secrets: "exact_admitted_references" as const,
      runtimeConfig: "exact_contract_ids" as const,
    },
    targetExceptionRefs: [],
    source: {
      mode: "stage_branch_head" as const,
      sourceRef: "refs/heads/main",
      sourceRevision: "rev-schema",
      artifactIdentity: "migration-bundle:test",
      artifactTrustMode: "recorded_exact_artifact" as const,
    },
    targetEnvironment: {
      mode: "stage_branch_snapshot" as const,
      targetRef: "refs/heads/main",
      targetRevision: "rev-schema",
      providerTargetIdentity: target.providerTarget.providerTargetIdentity,
      lockScope: target.providerTarget.providerTargetIdentity,
      reviewedSourceSnapshot: { mode: "stage_branch", ref: "refs/heads/main" } as any,
    },
  };
}

export function migrationAdapter(calls: string[]): FoundationMigrationAdapter {
  return {
    async apply(opts) {
      calls.push(`apply:${opts.targetSupabaseIdentity}:${opts.credentialEnvNames.join(",")}`);
      return { status: "succeeded", diagnostics: "applied bundle" };
    },
    async check() {
      return [
        { name: "rls_tenant_isolation", status: "passed" },
        { name: "composite_tenant_fk", status: "passed" },
        { name: "migration_ordering", status: "passed" },
        { name: "required_extension_settings", status: "passed" },
      ];
    },
  };
}

export function migrationAdapterWithChecks(
  checks: Awaited<ReturnType<FoundationMigrationAdapter["check"]>>,
) {
  const adapter: FoundationMigrationAdapter = {
    async apply() {
      return { status: "succeeded", diagnostics: "applied bundle" };
    },
    async check() {
      return checks;
    },
  };
  return adapter;
}

export function appDeploymentFixture(target = foundationDeploymentFixture()): any {
  return {
    ...target,
    deploymentId: "data-room-web-dev",
    label: "//projects/deployments/data-room-web-dev:deploy",
    provider: "kubernetes",
    publisher: { type: "helm-release", config: "helm/values.yaml" },
    provisioner: undefined,
    prerequisites: [{ deploymentId: "platform-foundation-dev", mode: "health_gated" }],
    providerTarget: {
      cluster: "dev",
      namespace: "web",
      release: "web",
      id: "dev/web/web",
      providerTargetIdentity: "kubernetes:dev/web/web",
    },
  };
}

export async function writeFoundationRecord(opts: {
  recordsRoot: string;
  status?: string;
  sourceRevision?: string;
}) {
  await fsp.mkdir(path.join(opts.recordsRoot, "runs"), { recursive: true });
  const deployment = foundationDeploymentFixture();
  const outcome: Record<string, string> = {
    status: opts.status || "succeeded",
  };
  if (opts.sourceRevision !== undefined) outcome.sourceRevision = opts.sourceRevision;
  await fsp.writeFile(
    path.join(opts.recordsRoot, "runs/foundation.json"),
    JSON.stringify({
      deployRunId: "foundation-run",
      deploymentId: "platform-foundation-dev",
      finalOutcome: "succeeded",
      lanePolicyRef: deployment.lanePolicyRef,
      artifact: { identity: "migration-bundle:test" },
      providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
      foundationMigrationOutcome: outcome,
    }),
  );
}

export async function writeMigrationBundleFixture(tmp: string): Promise<string> {
  const bundle = path.join(tmp, "bundle");
  await fsp.mkdir(bundle, { recursive: true });
  await fsp.writeFile(
    path.join(bundle, "manifest.json"),
    JSON.stringify({
      schema_version: "deployment-migration-bundle@1",
      ordered_migration_sets: [
        { index: 0, target: "//projects/libs/platform-db:migrations" },
        { index: 1, target: "//projects/libs/data-room-db:migrations" },
      ],
      dependency_graph_fingerprint:
        "migration-sets://projects/libs/platform-db:migrations|//projects/libs/data-room-db:migrations",
    }),
  );
  return bundle;
}
