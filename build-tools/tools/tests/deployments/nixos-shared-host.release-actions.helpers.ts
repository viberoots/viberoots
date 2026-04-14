#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { deploymentReleaseActionFixture } from "./deployment-metadata.fixture.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

export async function releaseActionMarkers(
  recordsRoot: string,
  deployRunId: string,
): Promise<string[]> {
  return (await fsp.readdir(path.join(recordsRoot, "release-actions", deployRunId))).sort();
}

export async function readLatestRunRecord(recordsRoot: string) {
  const [recordName] = (await fsp.readdir(path.join(recordsRoot, "runs"))).sort().slice(-1);
  return JSON.parse(await fsp.readFile(path.join(recordsRoot, "runs", recordName), "utf8"));
}

export function releaseActionDeployment() {
  return nixosSharedHostDeploymentFixture({
    releaseActions: [
      deploymentReleaseActionFixture({
        ref: "//test-workspace/deployments/demoapp-shared:success_marker",
        type: "post_publish_verification",
        phase: "post_smoke",
        runCondition: "success_only",
        requiredSecretRequirementNames: [],
        requiredRuntimeConfigRequirementNames: [],
        duplicateSafety: {},
        operationKeys: {},
      }),
      deploymentReleaseActionFixture({
        ref: "//test-workspace/deployments/demoapp-shared:failure_marker",
        type: "post_publish_verification",
        phase: "post_smoke",
        runCondition: "failure_only",
        requiredSecretRequirementNames: [],
        requiredRuntimeConfigRequirementNames: [],
        duplicateSafety: {},
        operationKeys: {},
      }),
      deploymentReleaseActionFixture({
        ref: "//test-workspace/deployments/demoapp-shared:always_marker",
        type: "post_publish_verification",
        phase: "post_smoke",
        runCondition: "always",
        requiredSecretRequirementNames: [],
        requiredRuntimeConfigRequirementNames: [],
        duplicateSafety: {},
        operationKeys: {},
      }),
      deploymentReleaseActionFixture({
        ref: "//test-workspace/deployments/demoapp-shared:publish_failure_cleanup",
        type: "post_publish_verification",
        phase: "post_publish_pre_smoke",
        runCondition: "failure_only",
        requiredSecretRequirementNames: [],
        requiredRuntimeConfigRequirementNames: [],
        duplicateSafety: {},
        operationKeys: {},
      }),
      deploymentReleaseActionFixture({
        ref: "//test-workspace/deployments/demoapp-shared:publish_always_marker",
        type: "post_publish_verification",
        phase: "post_publish_pre_smoke",
        runCondition: "always",
        requiredSecretRequirementNames: [],
        requiredRuntimeConfigRequirementNames: [],
        duplicateSafety: {},
        operationKeys: {},
      }),
    ],
  });
}
