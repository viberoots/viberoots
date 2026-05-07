#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { providerTargetIdentityFor } from "../../deployments/contract";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import {
  queryDeploymentNodes,
  resolveDeploymentFromTarget,
} from "../../deployments/deployment-query";
import { extractDeploymentAdmissionPolicies } from "../../deployments/deployment-policy";
import { writeTempReadinessFrontDoorWorkspace } from "./deploy.front-door-readiness.fixture";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { runInTemp } from "../lib/test-helpers";

const DEPLOYMENT_LABEL = "//projects/deployments/console-staging:deploy";
const POLICY_LABEL = "//projects/deployments/shared:staging_release";

test("deployment cquery preserves readiness gates for front-door resolution", async () => {
  await runInTemp("deploy-front-door-readiness-cquery", async (tmp) => {
    await writeTempReadinessFrontDoorWorkspace(tmp);
    const nodes = await queryDeploymentNodes(tmp, [DEPLOYMENT_LABEL, POLICY_LABEL]);
    const { policies, errors } = extractDeploymentAdmissionPolicies(nodes);
    assert.deepEqual(errors, []);
    assert.equal(policies.get(POLICY_LABEL)?.readinessGates?.[0]?.type, "ragie_acl_semantics");
    const deployment = await resolveDeploymentFromTarget(tmp, DEPLOYMENT_LABEL);
    assert.equal(deployment.admissionPolicy.readinessGates?.[0]?.name, "live/ragie");
  });
});

test("front-door admission enforces resolved readiness gates", async () => {
  await runInTemp("deploy-front-door-readiness-admission", async (tmp) => {
    await writeTempReadinessFrontDoorWorkspace(tmp);
    const deployment = await resolveDeploymentFromTarget(tmp, DEPLOYMENT_LABEL);
    const admittedContext = {
      source: { sourceRevision: "rev-source-123", artifactIdentity: "artifact-123" },
      targetEnvironment: { providerTargetIdentity: providerTargetIdentityFor(deployment) },
    };
    await assert.rejects(
      evaluateDeploymentAdmission({
        workspaceRoot: tmp,
        recordsRoot: path.join(tmp, "records"),
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
      }),
      /requires readiness gate live\/ragie/,
    );
    const passed = await evaluateDeploymentAdmission({
      workspaceRoot: tmp,
      recordsRoot: path.join(tmp, "records"),
      deployment,
      operationKind: "deploy",
      admittedContext,
      evidence: {
        ...reviewedLaneAdmissionEvidenceFixture({ deployment }),
        readinessGates: [
          {
            name: "live/ragie",
            type: "ragie_acl_semantics",
            status: "passed",
            checkedAt: "2026-05-03T12:00:00.000Z",
            gateVersion: "v1",
            deploymentId: deployment.deploymentId,
            environmentStage: deployment.environmentStage,
            providerTargetIdentity: providerTargetIdentityFor(deployment),
            sourceRevision: admittedContext.source.sourceRevision,
            evidenceRef: "evidence://ragie/redacted",
            redactedSummary: "ragie acl semantics passed",
            diagnostics: {
              summary: "redacted ragie acl review",
              reviewContextRef: "evidence://ragie/review",
            },
          },
        ],
        checks: [
          {
            name: "deploy/console-staging",
            subject: admittedContext.source.sourceRevision,
            status: "passed",
            checkedAt: "2026-05-03T12:00:00.000Z",
            deploymentId: deployment.deploymentId,
            environmentStage: deployment.environmentStage,
            admissionPolicyRef: deployment.admissionPolicyRef,
            recordRef: "check://deploy/console-staging",
          },
        ],
      },
    });
    assert.equal(passed.readinessGates[0]?.name, "live/ragie");
  });
});

test("deploy --validate-only rejects cross-app dependencies from queried component graph", async () => {
  await runInTemp("deploy-front-door-app-boundary", async (tmp, $) => {
    await writeTempReadinessFrontDoorWorkspace(tmp, { crossAppDependency: true });
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${DEPLOYMENT_LABEL} --validate-only`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(
      String(result.stderr),
      /app target must not import app target \/\/projects\/apps\/admin:app/,
    );
  });
});
