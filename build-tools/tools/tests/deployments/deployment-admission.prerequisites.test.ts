#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { revalidateControlPlaneAdmission } from "../../deployments/deployment-control-plane-revalidation";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { runInTemp } from "../lib/test-helpers";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  admittedContextFixture,
  writeCloudflarePrerequisiteRecord,
  writeSuccessfulPrerequisiteRecord,
} from "./deployment-admission.prerequisites.helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("ordering_only prerequisites require a prior successful run and health_gated requires fresh health evidence", async () => {
  await runInTemp("deployment-admission-prereqs", async (tmp) => {
    const recordsRoot = path.join(tmp, ".local", "deployments", "nixos-shared-host", "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    await writeSuccessfulPrerequisiteRecord(tmp, backendDatabaseUrl, "demoapp-dev", {
      publicUrl: "https://demoapp.apps.kilty.io/",
      healthUrl: "https://demoapp.apps.kilty.io/healthz",
    });
    const orderingOnly = nixosSharedHostDeploymentFixture({
      prerequisites: [{ deploymentId: "demoapp-dev", mode: "ordering_only" }],
    });
    const orderingEval = await evaluateDeploymentAdmission({
      workspaceRoot: tmp,
      recordsRoot,
      deployment: orderingOnly,
      backendDatabaseUrl,
      prerequisiteProvidersByDeploymentId: { "demoapp-dev": "nixos-shared-host" },
      operationKind: "deploy",
      admittedContext: admittedContextFixture(orderingOnly),
      evidence: deploymentAdmissionEvidenceFixture({
        deployment: orderingOnly,
        operationKind: "deploy",
        sourceRevision: "rev-source-123",
      }),
    });
    assert.equal(orderingEval.prerequisites[0]?.mode, "ordering_only");
    const healthGated = nixosSharedHostDeploymentFixture({
      prerequisites: [{ deploymentId: "demoapp-dev", mode: "health_gated" }],
    });
    await assert.rejects(
      evaluateDeploymentAdmission({
        workspaceRoot: tmp,
        recordsRoot,
        deployment: healthGated,
        backendDatabaseUrl,
        prerequisiteProvidersByDeploymentId: { "demoapp-dev": "nixos-shared-host" },
        operationKind: "deploy",
        admittedContext: admittedContextFixture(healthGated),
        evidence: deploymentAdmissionEvidenceFixture({
          deployment: healthGated,
          operationKind: "deploy",
          sourceRevision: "rev-source-123",
        }),
      }),
      /lacks fresh health evidence/,
    );
    const healthEvidence = deploymentAdmissionEvidenceFixture({
      deployment: healthGated,
      operationKind: "deploy",
      sourceRevision: "rev-source-123",
      prerequisiteHealth: [{ deploymentId: "demoapp-dev" }],
    });
    const healthEval = await evaluateDeploymentAdmission({
      workspaceRoot: tmp,
      recordsRoot,
      deployment: healthGated,
      backendDatabaseUrl,
      prerequisiteProvidersByDeploymentId: { "demoapp-dev": "nixos-shared-host" },
      operationKind: "deploy",
      admittedContext: admittedContextFixture(healthGated),
      evidence: healthEvidence,
    });
    assert.equal(healthEval.prerequisites[0]?.mode, "health_gated");
    assert.equal(healthEval.prerequisites[0]?.healthEvidenceRef, "health://demoapp-dev");
  });
});

test("prerequisite routing follows the prerequisite provider for mixed-provider deployments", async () => {
  await runInTemp("deployment-admission-prereq-provider-routing", async (tmp) => {
    const sharedRecordsRoot = path.join(
      tmp,
      ".local",
      "deployments",
      "nixos-shared-host",
      "records",
    );
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(sharedRecordsRoot);
    await writeSuccessfulPrerequisiteRecord(tmp, backendDatabaseUrl, "shared-prereq", {
      publicUrl: "https://shared-prereq.apps.kilty.io/",
    });
    await writeCloudflarePrerequisiteRecord(tmp, "pages-prereq", {
      publicUrl: "https://pages-prereq.pages.dev/",
    });

    const cloudflareTarget = cloudflarePagesDeploymentFixture({
      deploymentId: "target-pages",
      prerequisites: [{ deploymentId: "shared-prereq", mode: "ordering_only" }],
    });
    const cloudflareEval = await evaluateDeploymentAdmission({
      workspaceRoot: tmp,
      recordsRoot: sharedRecordsRoot,
      deployment: cloudflareTarget,
      backendDatabaseUrl,
      prerequisiteProvidersByDeploymentId: { "shared-prereq": "nixos-shared-host" },
      operationKind: "deploy",
      admittedContext: admittedContextFixture(cloudflareTarget),
      evidence: deploymentAdmissionEvidenceFixture({
        deployment: cloudflareTarget,
        operationKind: "deploy",
        sourceRevision: "rev-source-123",
      }),
    });
    assert.equal(cloudflareEval.prerequisites[0]?.sourceDeployRunId, "shared-prereq-run");
    assert.equal(
      cloudflareEval.prerequisites[0]?.publicUrl,
      "https://shared-prereq.apps.kilty.io/",
    );
    assert.equal(cloudflareEval.prerequisites[0]?.healthUrl, undefined);

    const sharedTarget = nixosSharedHostDeploymentFixture({
      prerequisites: [{ deploymentId: "pages-prereq", mode: "ordering_only" }],
    });
    const sharedEval = await evaluateDeploymentAdmission({
      workspaceRoot: tmp,
      recordsRoot: sharedRecordsRoot,
      deployment: sharedTarget,
      backendDatabaseUrl,
      prerequisiteProvidersByDeploymentId: { "pages-prereq": "cloudflare-pages" },
      operationKind: "deploy",
      admittedContext: admittedContextFixture(sharedTarget),
      evidence: deploymentAdmissionEvidenceFixture({
        deployment: sharedTarget,
        operationKind: "deploy",
        sourceRevision: "rev-source-123",
      }),
    });
    assert.equal(sharedEval.prerequisites[0]?.sourceDeployRunId, "pages-prereq-run");
    assert.equal(sharedEval.prerequisites[0]?.publicUrl, "https://pages-prereq.pages.dev/");
    assert.equal(sharedEval.prerequisites[0]?.healthUrl, undefined);
  });
});

test("protected/shared admission rejects deployment-local executable hooks", async () => {
  const deployment = nixosSharedHostDeploymentFixture({
    publisher: { type: "projects/deployments/demoapp:deploy.ts" },
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      workspaceRoot: process.cwd(),
      recordsRoot: path.join(
        process.cwd(),
        ".local",
        "deployments",
        "nixos-shared-host",
        "records",
      ),
      deployment,
      operationKind: "deploy",
      admittedContext: admittedContextFixture(deployment),
    }),
    /rejects non-built-in nixos-shared-host publisher/,
  );
});

test("shared control-plane revalidation fails closed when health-gated prerequisites lack backend authority", async () => {
  await runInTemp("deployment-admission-prereq-revalidation", async (tmp) => {
    const recordsRoot = path.join(tmp, ".local", "deployments", "nixos-shared-host", "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    await writeSuccessfulPrerequisiteRecord(tmp, backendDatabaseUrl, "demoapp-dev", {
      healthUrl: "https://demoapp.apps.kilty.io/healthz",
    });
    const deployment = nixosSharedHostDeploymentFixture({
      prerequisites: [{ deploymentId: "demoapp-dev", mode: "health_gated" }],
    });
    await assert.rejects(
      revalidateControlPlaneAdmission({
        workspaceRoot: tmp,
        recordsRoot,
        deployment,
        admittedContext: {
          targetEnvironment: {
            targetRef: "HEAD",
          },
          policyEvaluation: {
            evaluatedAt: "2026-04-12T10:00:00.000Z",
            requestedBy: { principalId: "app:deploy-bot" },
            binding: {
              payloadFingerprint: "sha256:payload",
              targetIdentity: "target:demoapp",
            },
            requiredChecks: [],
            requiredApprovals: [],
            prerequisites: [
              {
                deploymentId: "demoapp-dev",
                mode: "health_gated",
                sourceDeployRunId: "demoapp-dev-run",
              },
            ],
            supplyChainGates: [],
          },
        },
      }),
      /health_gated prerequisite no longer passes fresh revalidation: demoapp-dev/,
    );
  });
});
