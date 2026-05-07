#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { DeploymentTarget } from "../../deployments/contract";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query";
import { runInTemp } from "../lib/test-helpers";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  admittedContextFixture,
  writeDeploymentPrerequisiteRecord,
} from "./deployment-admission.prerequisites.helpers";

async function realDeployment(label: string): Promise<DeploymentTarget> {
  return await resolveDeploymentFromTarget(process.cwd(), label);
}

async function expectPhase0AdmissionRejects(
  deployment: DeploymentTarget,
  tmp: string,
  providers: Record<string, string>,
  pattern: RegExp,
  health: string[] = [],
) {
  await assert.rejects(
    evaluateDeploymentAdmission({
      workspaceRoot: tmp,
      recordsRoot: path.join(tmp, ".local", "deployments", "kubernetes", "records"),
      deployment,
      prerequisiteProvidersByDeploymentId: providers,
      operationKind: "deploy",
      admittedContext: admittedContextFixture(deployment),
      evidence: deploymentAdmissionEvidenceFixture({
        deployment,
        operationKind: "deploy",
        sourceRevision: "rev-source-123",
        artifactIdentity: "artifact-123",
        prerequisiteHealth: health.map((deploymentId) => ({ deploymentId })),
      }),
    }),
    pattern,
  );
}

test("Phase 0 real worker, web, and console admission blocks source revision drift", async () => {
  const worker = await realDeployment("//projects/deployments/data-room-worker-staging:deploy");
  const web = await realDeployment("//projects/deployments/data-room-web-prod:deploy");
  const console = await realDeployment("//projects/deployments/data-room-console-prod:deploy");
  const workerDev = await realDeployment("//projects/deployments/data-room-worker-dev:deploy");
  const foundationStaging = await realDeployment(
    "//projects/deployments/platform-foundation-staging:deploy",
  );
  const workerProd = await realDeployment("//projects/deployments/data-room-worker-prod:deploy");
  const webStaging = await realDeployment("//projects/deployments/data-room-web-staging:deploy");
  const foundationProd = await realDeployment(
    "//projects/deployments/platform-foundation-prod:deploy",
  );
  const webProd = await realDeployment("//projects/deployments/data-room-web-prod:deploy");
  const consoleStaging = await realDeployment(
    "//projects/deployments/data-room-console-staging:deploy",
  );

  await runInTemp("phase0-real-source-drift", async (tmp) => {
    await writeDeploymentPrerequisiteRecord(tmp, foundationStaging, "opentofu", {
      foundationMigration: true,
    });
    await writeDeploymentPrerequisiteRecord(tmp, workerDev, "kubernetes", {
      sourceRevision: "old-rev",
    });
    await expectPhase0AdmissionRejects(
      worker,
      tmp,
      { "platform-foundation-staging": "opentofu", "data-room-worker-dev": "kubernetes" },
      /data-room-worker-dev source revision differs/,
    );

    await writeDeploymentPrerequisiteRecord(tmp, workerProd, "kubernetes", {
      healthUrl: "service://data-room-worker-prod",
    });
    await writeDeploymentPrerequisiteRecord(tmp, webStaging, "kubernetes", {
      sourceRevision: "old-rev",
    });
    await expectPhase0AdmissionRejects(
      web,
      tmp,
      { "data-room-worker-prod": "kubernetes", "data-room-web-staging": "kubernetes" },
      /data-room-web-staging source revision differs/,
      ["data-room-worker-prod"],
    );

    await writeDeploymentPrerequisiteRecord(tmp, foundationProd, "opentofu", {
      foundationMigration: true,
    });
    await writeDeploymentPrerequisiteRecord(tmp, webProd, "kubernetes", {
      healthUrl: "https://web.data-room.example.invalid/healthz",
    });
    await writeDeploymentPrerequisiteRecord(tmp, consoleStaging, "vercel", {
      sourceRevision: "old-rev",
    });
    await expectPhase0AdmissionRejects(
      console,
      tmp,
      { "data-room-web-prod": "kubernetes", "data-room-console-staging": "vercel" },
      /data-room-console-staging source revision differs/,
      ["data-room-web-prod"],
    );
  });
});

test("Phase 0 real console admission blocks missing web readiness and migration evidence", async () => {
  const console = await realDeployment("//projects/deployments/data-room-console-prod:deploy");
  const foundationProd = await realDeployment(
    "//projects/deployments/platform-foundation-prod:deploy",
  );
  const webProd = await realDeployment("//projects/deployments/data-room-web-prod:deploy");
  const consoleStaging = await realDeployment(
    "//projects/deployments/data-room-console-staging:deploy",
  );

  await runInTemp("phase0-real-console-prereqs", async (tmp) => {
    await writeDeploymentPrerequisiteRecord(tmp, webProd, "kubernetes", {
      healthUrl: "https://web.data-room.example.invalid/healthz",
    });
    await writeDeploymentPrerequisiteRecord(tmp, consoleStaging, "vercel");
    const providers = { "data-room-web-prod": "kubernetes", "data-room-console-staging": "vercel" };
    await expectPhase0AdmissionRejects(
      console,
      tmp,
      providers,
      /health_gated prerequisite lacks fresh health evidence: data-room-web-prod/,
    );

    await writeDeploymentPrerequisiteRecord(tmp, foundationProd, "opentofu");
    await writeDeploymentPrerequisiteRecord(tmp, webProd, "kubernetes", {
      healthUrl: "https://web.data-room.example.invalid/healthz",
    });
    await expectPhase0AdmissionRejects(
      console,
      tmp,
      providers,
      /foundation prerequisite lacks successful migration evidence: platform-foundation-prod/,
      ["data-room-web-prod"],
    );
  });
});

test("Phase 0 real console admission accepts reviewed current hotfix exception", async () => {
  const console = await realDeployment("//projects/deployments/data-room-console-prod:deploy");
  const foundationProd = await realDeployment(
    "//projects/deployments/platform-foundation-prod:deploy",
  );
  const webProd = await realDeployment("//projects/deployments/data-room-web-prod:deploy");
  const consoleStaging = await realDeployment(
    "//projects/deployments/data-room-console-staging:deploy",
  );

  await runInTemp("phase0-current-hotfix-exception", async (tmp) => {
    await writeDeploymentPrerequisiteRecord(tmp, foundationProd, "opentofu", {
      foundationMigration: true,
    });
    await writeDeploymentPrerequisiteRecord(tmp, webProd, "kubernetes", {
      healthUrl: "https://web.data-room.example.invalid/healthz",
    });
    await writeDeploymentPrerequisiteRecord(tmp, consoleStaging, "vercel", {
      sourceRevision: "staging-hotfix-rev",
      compatibilityException: {
        reviewedBy: "release-owner",
        reason: "staging console record remains compatible",
        expiresAt: "2099-01-01T00:00:00Z",
      },
    });
    const admittedContext = {
      ...admittedContextFixture(console),
      source: { sourceRevision: "hotfix-rev", artifactIdentity: "artifact-123" },
    };
    const evaluation = await evaluateDeploymentAdmission({
      workspaceRoot: tmp,
      recordsRoot: path.join(tmp, ".local", "deployments", "kubernetes", "records"),
      deployment: console,
      prerequisiteProvidersByDeploymentId: {
        "data-room-web-prod": "kubernetes",
        "data-room-console-staging": "vercel",
      },
      operationKind: "deploy",
      admittedContext,
      evidence: deploymentAdmissionEvidenceFixture({
        deployment: console,
        operationKind: "deploy",
        sourceRevision: "hotfix-rev",
        artifactIdentity: "artifact-123",
        prerequisiteHealth: [{ deploymentId: "data-room-web-prod" }],
        phase0CompatibilityException: {
          reviewedBy: "release-owner",
          reason: "console hotfix remains compatible with current web release",
          expiresAt: "2099-01-01T00:00:00Z",
        },
      }),
    });

    assert.deepEqual(
      evaluation.prerequisites.map((prerequisite) => prerequisite.deploymentId),
      ["data-room-web-prod", "data-room-console-staging"],
    );
    assert.equal(
      (admittedContext as { phase0CompatibilityException?: { reason?: string } })
        .phase0CompatibilityException?.reason,
      "console hotfix remains compatible with current web release",
    );
  });
});

test("Phase 0 real targets stay single-provider and consume existing PR-19 metadata", async () => {
  const labels = [
    "//projects/deployments/platform-foundation-prod:deploy",
    "//projects/deployments/data-room-worker-prod:deploy",
    "//projects/deployments/data-room-web-prod:deploy",
    "//projects/deployments/data-room-console-prod:deploy",
  ];
  const deployments = await Promise.all(labels.map((label) => realDeployment(label)));
  assert.deepEqual(
    deployments.map((deployment) => deployment.provider),
    ["opentofu", "kubernetes", "kubernetes", "vercel"],
  );
  assert.ok(!deployments.some((deployment) => deployment.provider === "phase0-release"));
  assert.equal(
    deployments[0]?.migrationBundleRef,
    "//projects/deployments/platform-shared:migration_bundle",
  );
  assert.ok(
    deployments[1]?.prerequisites.some(
      (entry) => entry.deploymentId === "platform-foundation-prod",
    ),
  );
  assert.ok(
    deployments[2]?.prerequisites.some((entry) => entry.deploymentId === "data-room-worker-prod"),
  );
  assert.ok(
    deployments[3]?.runtimeConfigRequirements.some(
      (entry) => entry.name === "data-room-web-base-url",
    ),
  );
});
