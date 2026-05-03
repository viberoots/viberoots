#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runVercelDeployFrontDoor } from "../../deployments/vercel-front-door.ts";
import { vercelDeploymentFixture } from "./vercel.fixture.ts";

test("public front door rejects protected/shared laptop-local Vercel mutation", async () => {
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
        artifactDirFlag: "/tmp/not-used",
      }),
    /protected\/shared Vercel mutations must use the reviewed control-plane service/,
  );
});
