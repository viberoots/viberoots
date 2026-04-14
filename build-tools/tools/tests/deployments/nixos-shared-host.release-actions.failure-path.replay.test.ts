#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runNixosSharedHostReleaseActionPhase } from "../../deployments/nixos-shared-host-release-actions.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { deploymentReleaseActionFixture } from "./deployment-metadata.fixture.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

async function markerNames(recordsRoot: string, deployRunId: string): Promise<string[]> {
  return (await fsp.readdir(path.join(recordsRoot, "release-actions", deployRunId))).sort();
}

test("failure-path release-action replay honors rerun and skip dispositions", async () => {
  await runInTemp("nixos-shared-host-release-actions-failure-replay-rerun", async (tmp) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const recordsRoot = path.join(tmp, "records");
    await runNixosSharedHostReleaseActionPhase({
      recordsRoot,
      deployRunId: "deploy-123",
      deployment,
      operationKind: "deploy",
      publishBehavior: "publish-only",
      phase: "post_publish_pre_smoke",
      executionPath: "failure",
      releaseActions: [
        deploymentReleaseActionFixture({
          ref: "//test-workspace/deployments/demoapp-shared:rerun_failure_cleanup",
          phase: "post_publish_pre_smoke",
          runCondition: "failure_only",
          replayPolicy: {
            deploy_publish_slice: "rerun",
            retry: "skip",
            rollback: "skip",
            promotion: "skip",
          },
          duplicateSafety: { deploy_publish_slice: "control_plane_deduplicated" },
          operationKeys: { deploy_publish_slice: "cleanup:${deploy_run_id}" },
          requiredSecretRequirementNames: [],
          requiredRuntimeConfigRequirementNames: [],
        }),
        deploymentReleaseActionFixture({
          ref: "//test-workspace/deployments/demoapp-shared:skip_failure_cleanup",
          phase: "post_publish_pre_smoke",
          runCondition: "failure_only",
          replayPolicy: {
            deploy_publish_slice: "skip",
            retry: "skip",
            rollback: "skip",
            promotion: "skip",
          },
          duplicateSafety: {},
          operationKeys: {},
          requiredSecretRequirementNames: [],
          requiredRuntimeConfigRequirementNames: [],
        }),
      ],
    });
    assert.deepEqual(await markerNames(recordsRoot, "deploy-123"), [
      "post_publish_pre_smoke.demoapp-shared_rerun_failure_cleanup.json",
    ]);
  });
});

test("failure-path release-action replay fails closed when rerun is not authorized", async () => {
  await runInTemp("nixos-shared-host-release-actions-failure-replay-fail", async (tmp) => {
    const deployment = nixosSharedHostDeploymentFixture();
    await assert.rejects(
      runNixosSharedHostReleaseActionPhase({
        recordsRoot: path.join(tmp, "records"),
        deployRunId: "deploy-456",
        deployment,
        operationKind: "deploy",
        publishBehavior: "publish-only",
        phase: "post_publish_pre_smoke",
        executionPath: "failure",
        releaseActions: [
          deploymentReleaseActionFixture({
            ref: "//test-workspace/deployments/demoapp-shared:blocked_failure_cleanup",
            phase: "post_publish_pre_smoke",
            runCondition: "failure_only",
            replayPolicy: {
              deploy_publish_slice: "fail",
              retry: "skip",
              rollback: "skip",
              promotion: "skip",
            },
            duplicateSafety: {},
            operationKeys: {},
            requiredSecretRequirementNames: [],
            requiredRuntimeConfigRequirementNames: [],
          }),
        ],
      }),
      /does not permit deploy_publish_slice replay/,
    );
  });
});
