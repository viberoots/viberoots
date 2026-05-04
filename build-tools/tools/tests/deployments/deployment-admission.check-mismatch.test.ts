#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { admissionEvalBase, admittedContextFixture } from "./deployment-admission.test-helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("admission explains when a passed check is bound to a different deploy commit", async () => {
  const deployment = nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      requiredChecks: ["ci/deploy-ready"],
    },
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext: admittedContextFixture(deployment, {
          sourceRevision: "rev-required",
        }),
        evidence: {
          requestedBy: { principalId: "user:submitter" },
          checks: [
            {
              name: "ci/deploy-ready",
              subject: "rev-old",
              status: "passed",
              checkedAt: "2026-04-24T00:00:00.000Z",
            },
          ],
        },
      }),
    }),
    /requires check ci\/deploy-ready for commit rev-required, but found passed ci\/deploy-ready for commit rev-old/,
  );
});
