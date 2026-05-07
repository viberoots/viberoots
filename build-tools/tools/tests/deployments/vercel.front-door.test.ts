#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { usesServiceBackedWorkerRuntime } from "../../deployments/deploy-cli";
import { runVercelDeployFrontDoor } from "../../deployments/vercel-front-door";
import { vercelDeploymentFixture } from "./vercel.fixture";
import {
  deploymentWithVercelSecret,
  withVercelFixtureSecrets,
  withVercelSmokeServer,
  writeVercelArtifact,
  writeVercelPublisherConfig,
} from "./vercel.control-plane.helpers";

const PUBLISH_AND_SMOKE_TOKEN = {
  "vercel/api-token": {
    value: "token-fixture",
    allowedSteps: ["publish", "smoke"],
    targetScopes: ["*"],
  },
};

async function captureDeployJson(fn: () => Promise<void>): Promise<any> {
  const output: string[] = [];
  const previous = console.log;
  console.log = (value?: unknown) => output.push(String(value));
  try {
    await fn();
  } finally {
    console.log = previous;
  }
  assert.ok(output.length > 0, "expected deploy front door to print JSON");
  return JSON.parse(output[output.length - 1]!);
}

test("public front door requires a control-plane URL for protected/shared Vercel mutation", async () => {
  await assert.rejects(
    () =>
      runVercelDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: vercelDeploymentFixture(),
        requireServiceForProtectedShared: true,
        publishOnly: false,
        preview: false,
        previewCleanup: false,
        rollback: false,
        sourceRunId: "deploy-1",
        artifactDirFlag: "",
      }),
    /vercel (shared_nonprod|production_facing) mutation requires --control-plane-url/,
  );
});

test("protected/shared Vercel rollback requires --publish-only", async () => {
  await assert.rejects(
    () =>
      runVercelDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: vercelDeploymentFixture(),
        requireServiceForProtectedShared: true,
        publishOnly: false,
        preview: false,
        previewCleanup: false,
        rollback: true,
        sourceRunId: "deploy-1",
        artifactDirFlag: "",
      }),
    /vercel rollback requires --publish-only/,
  );
});

test("protected/shared Vercel rejects --records-root and --control-plane-database-url", async () => {
  await assert.rejects(
    () =>
      runVercelDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: vercelDeploymentFixture(),
        requireServiceForProtectedShared: true,
        publishOnly: false,
        preview: false,
        previewCleanup: false,
        rollback: false,
        sourceRunId: "",
        artifactDirFlag: "",
        hasFlag: (flag) => flag === "records-root",
      }),
    /service-only vercel deploy does not support --records-root/,
  );
});

test("protected/shared Vercel deploy rejects laptop-local artifact paths before submit", async () => {
  await assert.rejects(
    () =>
      runVercelDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: vercelDeploymentFixture(),
        requireServiceForProtectedShared: true,
        publishOnly: false,
        preview: false,
        previewCleanup: false,
        rollback: false,
        sourceRunId: "",
        artifactDirFlag: "/tmp/vercel-output",
      }),
    /protected\/shared vercel deploy does not support --artifact-dir/,
  );
});

test("protected/shared Vercel preview rejects laptop-local artifact paths before submit", async () => {
  await assert.rejects(
    () =>
      runVercelDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: vercelDeploymentFixture(),
        requireServiceForProtectedShared: true,
        publishOnly: false,
        preview: true,
        previewCleanup: false,
        rollback: false,
        sourceRunId: "deploy-1",
        artifactDirFlag: "/tmp/vercel-output",
      }),
    /protected\/shared vercel deploy does not support --artifact-dir/,
  );
});

test("protected/shared Vercel rejects component artifact inputs before submit", async () => {
  await assert.rejects(
    () =>
      runVercelDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: vercelDeploymentFixture(),
        requireServiceForProtectedShared: true,
        publishOnly: false,
        preview: true,
        previewCleanup: false,
        rollback: false,
        sourceRunId: "deploy-1",
        artifactDirFlag: "",
        hasFlag: (flag) => flag === "component-artifacts",
      }),
    /protected\/shared vercel deploy does not support --artifact-dir/,
  );
});

test("protected/shared Vercel deploy and preview require admitted source-run selectors", async () => {
  await assert.rejects(
    () =>
      runVercelDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: vercelDeploymentFixture(),
        requireServiceForProtectedShared: true,
        publishOnly: false,
        preview: false,
        previewCleanup: false,
        rollback: false,
        sourceRunId: "",
        artifactDirFlag: "",
      }),
    /protected\/shared vercel deploy requires --source-run-id/,
  );
  await assert.rejects(
    () =>
      runVercelDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: vercelDeploymentFixture(),
        requireServiceForProtectedShared: true,
        publishOnly: false,
        preview: true,
        previewCleanup: false,
        rollback: false,
        sourceRunId: "",
        artifactDirFlag: "",
      }),
    /protected\/shared vercel preview requires --source-run-id/,
  );
});

test("public deploy CLI treats protected/shared Vercel as worker-side secret runtime", () => {
  assert.equal(usesServiceBackedWorkerRuntime(vercelDeploymentFixture(), true), true);
  assert.equal(
    usesServiceBackedWorkerRuntime(
      vercelDeploymentFixture({ protectionClass: "local_only" }),
      true,
    ),
    false,
  );
});

test("explicit local-only Vercel front-door deploy still uses local publisher path", async () => {
  await withVercelFixtureSecrets(PUBLISH_AND_SMOKE_TOKEN, async (tmp) => {
    await withVercelSmokeServer(async (smokeConnectOverride) => {
      const deployment = vercelDeploymentFixture({
        protectionClass: "local_only",
        secretRequirements: deploymentWithVercelSecret().secretRequirements,
      });
      await writeVercelPublisherConfig(tmp);
      const artifactDir = await writeVercelArtifact(`${tmp}/artifact`);
      const summary = await captureDeployJson(() =>
        runVercelDeployFrontDoor({
          workspaceRoot: tmp,
          deployment,
          requireServiceForProtectedShared: true,
          publishOnly: false,
          preview: false,
          previewCleanup: false,
          rollback: false,
          sourceRunId: "",
          artifactDirFlag: artifactDir,
          smokeConnectOverride,
        }),
      );
      assert.equal(summary.finalOutcome, "succeeded");
      assert.equal(summary.publicUrl.includes("vercel.app"), true);
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.provider, "vercel");
      assert.equal(record.providerReleaseId.startsWith("dpl_"), true);
    });
  });
});
