#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator.ts";
import { providerTargetIdentityFor } from "../../deployments/contract.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

function admittedContextFixture(deployment: ReturnType<typeof nixosSharedHostDeploymentFixture>) {
  return {
    source: {
      sourceRevision: "rev-source-123",
      artifactIdentity: "artifact-123",
    },
    targetEnvironment: {
      providerTargetIdentity: providerTargetIdentityFor(deployment),
    },
  };
}

async function writeSuccessfulPrerequisiteRecord(
  tmp: string,
  deploymentId: string,
  options: Partial<{ publicUrl: string; healthUrl: string }> = {},
) {
  const recordPath = path.join(
    tmp,
    ".local",
    "deployments",
    "nixos-shared-host",
    "records",
    "runs",
    `${deploymentId}-success.json`,
  );
  await fsp.mkdir(path.dirname(recordPath), { recursive: true });
  await fsp.writeFile(
    recordPath,
    JSON.stringify(
      {
        schemaVersion: "deploy-record@2026-04-04",
        deployRunId: `${deploymentId}-run`,
        deploymentId,
        finalOutcome: "succeeded",
        ...(options.publicUrl ? { publicUrl: options.publicUrl } : {}),
        ...(options.healthUrl ? { healthUrl: options.healthUrl } : {}),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

test("ordering_only prerequisites require a prior successful run and health_gated requires fresh health evidence", async () => {
  await runInTemp("deployment-admission-prereqs", async (tmp) => {
    await writeSuccessfulPrerequisiteRecord(tmp, "demoapp-dev", {
      publicUrl: "https://demoapp.apps.kilty.io/",
      healthUrl: "https://demoapp.apps.kilty.io/healthz",
    });
    const orderingOnly = nixosSharedHostDeploymentFixture({
      prerequisites: [{ deploymentId: "demoapp-dev", mode: "ordering_only" }],
    });
    const orderingEval = await evaluateDeploymentAdmission({
      workspaceRoot: tmp,
      recordsRoot: path.join(tmp, ".local", "deployments", "nixos-shared-host", "records"),
      deployment: orderingOnly,
      operationKind: "deploy",
      admittedContext: admittedContextFixture(orderingOnly),
    });
    assert.equal(orderingEval.prerequisites[0]?.mode, "ordering_only");
    const healthGated = nixosSharedHostDeploymentFixture({
      prerequisites: [{ deploymentId: "demoapp-dev", mode: "health_gated" }],
    });
    await assert.rejects(
      evaluateDeploymentAdmission({
        workspaceRoot: tmp,
        recordsRoot: path.join(tmp, ".local", "deployments", "nixos-shared-host", "records"),
        deployment: healthGated,
        operationKind: "deploy",
        admittedContext: admittedContextFixture(healthGated),
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
      recordsRoot: path.join(tmp, ".local", "deployments", "nixos-shared-host", "records"),
      deployment: healthGated,
      operationKind: "deploy",
      admittedContext: admittedContextFixture(healthGated),
      evidence: healthEvidence,
    });
    assert.equal(healthEval.prerequisites[0]?.mode, "health_gated");
    assert.equal(healthEval.prerequisites[0]?.healthEvidenceRef, "health://demoapp-dev");
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
