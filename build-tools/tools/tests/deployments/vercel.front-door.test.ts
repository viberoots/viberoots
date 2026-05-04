#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runVercelDeployFrontDoor } from "../../deployments/vercel-front-door";
import { vercelDeploymentFixture } from "./vercel.fixture";

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
        sourceRunId: "",
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
