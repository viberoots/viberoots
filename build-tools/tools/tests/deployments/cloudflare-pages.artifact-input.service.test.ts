#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/cloudflare-pages-control-plane-api-contract.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { startControlPlaneHarness } from "./nixos-shared-host.control-plane.helpers.ts";

test("cloudflare-pages service rejects laptop-local artifactDir submissions", async () => {
  await runInTemp("cloudflare-pages-service-rejects-artifact-dir", async (tmp) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    });
    try {
      const response = await fetch(new URL("/api/v1/submissions", harness.controlPlane.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
          submissionId: "submission-local-artifact-dir",
          submittedAt: new Date().toISOString(),
          deployment,
          operationKind: "deploy",
          artifactDir: "/tmp/laptop/dist",
        }),
      });
      assert.equal(response.ok, false);
      assert.match(await response.text(), /protected\/shared submissions must use artifactInput/);
    } finally {
      await harness.close();
    }
  });
});
