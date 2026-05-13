#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveDeploymentReviewedTargetEnvironment } from "../../deployments/deployment-reviewed-target-environment";
import { runInTemp } from "../lib/test-helpers";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostAdmissionPolicyFixture,
} from "./nixos-shared-host.fixture";
import { installS3StaticTargets, s3StaticDeploymentFixture } from "./s3-static.fixture";

async function gitStdout(cwd: string, $: any, ...args: string[]): Promise<string> {
  return String((await $({ cwd, stdio: "pipe" })`git ${args}`).stdout).trim();
}

async function commitLocalChange(cwd: string, $: any, name: string): Promise<string> {
  await fsp.writeFile(path.join(cwd, `${name}.txt`), `${name}\n`, "utf8");
  await $({ cwd, stdio: "pipe" })`git add ${`${name}.txt`}`;
  await $({ cwd, stdio: "pipe" })`git commit -m ${name}`;
  return await gitStdout(cwd, $, "rev-parse", "HEAD");
}

test("service-backed s3-static deploy fails closed when client source differs from service ref", async () => {
  await runInTemp("s3-static-reviewed-source-mismatch", async (tmp, $) => {
    const deployment = s3StaticDeploymentFixture({
      admissionPolicy: nixosSharedHostAdmissionPolicyFixture({
        ref: "//projects/deployments/pleomino-shared:staging_release",
        name: "staging_release",
        allowedRefs: ["main"],
        requiredChecks: ["deploy/pleomino-staging-s3"],
        fingerprint: "sha256:admission-pleomino-s3-staging",
      }),
    });
    await installS3StaticTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    const serviceRevision = await gitStdout(tmp, $, "rev-parse", "main");
    const clientRevision = await commitLocalChange(tmp, $, "client-drift");
    assert.notEqual(clientRevision, serviceRevision);
    await assert.rejects(
      resolveDeploymentReviewedTargetEnvironment({
        workspaceRoot: tmp,
        deployment,
        expectedSourceRevision: clientRevision,
        reviewedSourceSnapshot: {
          reviewedRef: "main",
          snapshotRef: "refs/vbr/reviewed-source/test/main",
          sourceRevision: serviceRevision,
          remoteName: "origin",
          repository: deployment.lanePolicy.governance.repository,
          snapshottedAt: "2026-04-06T12:00:00.000Z",
        },
      }),
      new RegExp(
        [
          "reviewed source mismatch for main",
          `clientExpectedSourceRevision=${clientRevision}`,
          `serviceReviewedSourceRevision=${serviceRevision}`,
          "service fetched the reviewed deployment source ref before admission",
          "that source ref is up to date and pushed before retrying",
        ].join("[\\s\\S]*"),
      ),
    );
  });
});
