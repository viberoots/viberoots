#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { DeploymentAdmissionError } from "../../deployments/deployment-control-plane-errors";
import { runFoundationMigrationApply } from "../../deployments/foundation-migration";
import { submitOpenTofuFoundationProvisionOnly } from "../../deployments/opentofu-foundation-provision-only";
import { runInTemp } from "../lib/test-helpers";
import {
  recordingApplyAdapter,
  writeOpenTofuStackFixture,
} from "./kubernetes.opentofu-apply.integration.helpers";
import {
  appDeploymentFixture,
  foundationDeploymentFixture,
  laneGovernanceEvidence,
  migrationAdapter,
  migrationAdapterWithChecks,
  openTofuAdmittedContextFixture,
  writeFoundationRecord,
  writeMigrationBundleFixture,
} from "./opentofu-foundation-migration.helpers";
import { assertPostApplyFailure, passedChecks } from "./opentofu-foundation-checks.helpers";

test("OpenTofu admitted context binds policy resource refs and versions", () => {
  const target = foundationDeploymentFixture();
  const context = openTofuAdmittedContextFixture(target);
  const refs = new Map(context.policyResourceRefs.map((ref) => [ref.kind, ref]));
  assert.equal(refs.get("LanePolicy")?.version, "sha256:lane");
  assert.equal(refs.get("AdmissionPolicy")?.version, "sha256:admission");
  assert.equal(refs.get("ProviderCapabilityPolicy")?.resourceId, "provider-capability:opentofu");
  assert.equal(refs.get("ProviderCapabilityPolicy")?.version, "provider-capability@1");
});

test("OpenTofu foundation provision records migration apply and post-apply checks", async () => {
  await runInTemp("opentofu-foundation-migration", async (tmp) => {
    const target = foundationDeploymentFixture();
    const bundle = await writeMigrationBundleFixture(tmp);
    await writeOpenTofuStackFixture({ workspaceRoot: tmp, deploymentId: target.deploymentId });
    const apply = recordingApplyAdapter({ stdout: "tofu ok" });
    const migrationCalls: string[] = [];
    const { record, recordPath } = await submitOpenTofuFoundationProvisionOnly({
      workspaceRoot: tmp,
      deployment: target,
      recordsRoot: path.join(tmp, "records"),
      migrationBundleArtifactPath: bundle,
      admittedContext: openTofuAdmittedContextFixture(target),
      admissionEvidence: laneGovernanceEvidence(target),
      hooks: {
        openTofuAdapter: apply.adapter,
        migrationAdapter: migrationAdapter(migrationCalls),
        secretRuntimeFactory: () => ({
          async enterStep() {
            return {
              "opentofu-provider-credentials": "secret-opentofu",
              "supabase-service-role": "secret-supabase",
            };
          },
        }),
      },
    });
    assert.equal(record.finalOutcome, "succeeded");
    assert.equal(record.foundationMigrationOutcome.status, "succeeded");
    assert.equal(record.foundationMigrationOutcome.sourceRevision, "rev-schema");
    assert.equal(record.foundationMigrationOutcome.migrationList.length, 2);
    assert.equal(record.foundationMigrationOutcome.postApplyChecks.length, 4);
    assert.match(migrationCalls[0], /supabase:\/\/deployments\/phase0/);
    const persisted = await fsp.readFile(recordPath, "utf8");
    assert.ok(!persisted.includes("secret-supabase"));
  });
});

test("web and worker prerequisites reject stale foundation migration evidence", async () => {
  await runInTemp("opentofu-foundation-stale-prereq", async (tmp) => {
    const target = foundationDeploymentFixture();
    const app = appDeploymentFixture(target);
    await writeFoundationRecord({
      recordsRoot: path.join(tmp, "records"),
      sourceRevision: "old-rev",
    });
    await assert.rejects(
      evaluateDeploymentAdmission({
        workspaceRoot: tmp,
        recordsRoot: path.join(tmp, "records"),
        deployment: app,
        operationKind: "deploy",
        admittedContext: {
          source: { sourceRevision: "new-rev", artifactIdentity: "artifact" },
          targetEnvironment: { providerTargetIdentity: "kubernetes:dev/web/web" },
        },
        prerequisiteProvidersByDeploymentId: { "platform-foundation-dev": "opentofu" },
        evidence: laneGovernanceEvidence(target),
      }),
      (error) =>
        error instanceof DeploymentAdmissionError &&
        /foundation migration evidence is stale/.test(error.message),
    );
  });
});

test("foundation prerequisite lookup includes default OpenTofu records root", async () => {
  await runInTemp("opentofu-foundation-default-record-root", async (tmp) => {
    const target = foundationDeploymentFixture();
    await writeFoundationRecord({
      recordsRoot: path.join(tmp, ".local/deployments/opentofu/records"),
      sourceRevision: "rev-schema",
    });
    const evaluation = await evaluateDeploymentAdmission({
      workspaceRoot: tmp,
      recordsRoot: path.join(tmp, "other-records"),
      deployment: appDeploymentFixture(target),
      operationKind: "deploy",
      admittedContext: {
        source: { sourceRevision: "rev-schema", artifactIdentity: "artifact" },
        targetEnvironment: { providerTargetIdentity: "kubernetes:dev/web/web" },
      },
      evidence: laneGovernanceEvidence(target),
    });
    assert.equal(evaluation.prerequisites[0]?.sourceDeployRunId, "foundation-run");
  });
});

test("foundation migration enforces complete post-apply check set", async () => {
  await runInTemp("opentofu-foundation-missing-check", async (tmp) => {
    const bundle = await writeMigrationBundleFixture(tmp);
    const outcome = await runFoundationMigrationApply({
      bundlePath: bundle,
      targetSupabaseIdentity: "supabase://phase0/dev",
      sourceRevision: "rev-schema",
      secretRuntime: {
        async enterStep() {
          return { "supabase-service-role": "secret-supabase" };
        },
      },
      adapter: migrationAdapterWithChecks(
        passedChecks().filter((check) => check.name !== "required_extension_settings"),
      ),
    });
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.postApplyChecks.length, 4);
    assert.equal(
      outcome.postApplyChecks.find((check) => check.name === "required_extension_settings")?.status,
      "failed",
    );
  });
});

test("foundation post-apply checks block RLS, FK, tenant context, and diagnostics failures", async () => {
  await assertPostApplyFailure({
    name: "rls_tenant_isolation",
    status: "failed",
    diagnostics: "tenant RLS isolation leaked rows",
  });
  await assertPostApplyFailure({
    name: "composite_tenant_fk",
    status: "failed",
    diagnostics: "tenant-aware composite fk violation",
  });
  await assertPostApplyFailure({
    name: "migration_ordering",
    status: "failed",
    diagnostics: "tenant context setup ran before required migration ordering",
  });
  await assertPostApplyFailure({
    name: "required_extension_settings",
    status: "failed",
    diagnostics: "extension posture diagnostics mention required setting drift",
  });
});

test("foundation prerequisites reject absent, failed, and missing-source evidence", async () => {
  for (const [name, record, expected] of [
    ["absent", undefined, /no successful admitted run/],
    ["failed", { status: "failed", sourceRevision: "rev-schema" }, /lacks successful migration/],
    ["missing-source", { status: "succeeded" }, /missing source revision/],
  ] as const) {
    await runInTemp(`opentofu-foundation-${name}`, async (tmp) => {
      const target = foundationDeploymentFixture();
      if (record)
        await writeFoundationRecord({ recordsRoot: path.join(tmp, "records"), ...record });
      await assert.rejects(
        evaluateDeploymentAdmission({
          workspaceRoot: tmp,
          recordsRoot: path.join(tmp, "records"),
          deployment: appDeploymentFixture(target),
          operationKind: "deploy",
          admittedContext: {
            source: { sourceRevision: "rev-schema", artifactIdentity: "artifact" },
            targetEnvironment: { providerTargetIdentity: "kubernetes:dev/web/web" },
          },
          evidence: laneGovernanceEvidence(target),
        }),
        (error) => error instanceof DeploymentAdmissionError && expected.test(error.message),
      );
    });
  }
});

test("foundation migration credentials are provision-scoped and not recorded", async () => {
  await runInTemp("opentofu-foundation-secret-scope", async (tmp) => {
    const target = foundationDeploymentFixture();
    const bundle = await writeMigrationBundleFixture(tmp);
    await writeOpenTofuStackFixture({ workspaceRoot: tmp, deploymentId: target.deploymentId });
    const steps: string[] = [];
    const { record, recordPath } = await submitOpenTofuFoundationProvisionOnly({
      workspaceRoot: tmp,
      deployment: target,
      recordsRoot: path.join(tmp, "records"),
      migrationBundleArtifactPath: bundle,
      admittedContext: openTofuAdmittedContextFixture(target),
      admissionEvidence: laneGovernanceEvidence(target),
      hooks: {
        openTofuAdapter: recordingApplyAdapter({ stdout: "tofu ok" }).adapter,
        migrationAdapter: migrationAdapter([]),
        secretRuntimeFactory: () => ({
          async enterStep(step) {
            steps.push(step);
            return {
              "opentofu-provider-credentials": "secret-opentofu",
              "supabase-service-role": "secret-supabase",
            };
          },
        }),
      },
    });
    assert.deepEqual(steps, ["provision", "provision"]);
    assert.deepEqual(record.foundationMigrationOutcome.credentialEnvNames, [
      "opentofu-provider-credentials",
      "supabase-service-role",
    ]);
    assert.ok(!(await fsp.readFile(recordPath, "utf8")).includes("secret-supabase"));
  });
});
