#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cloudflarePagesPreviewFixture,
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { runInTemp } from "../lib/test-helpers";

test("cloudflare-pages preview requires --source-run-id for shared/protected previews", async () => {
  await runInTemp("cloudflare-pages-preview-source-run-guard", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture({
      preview: cloudflarePagesPreviewFixture(),
    });
    await installCloudflarePagesTargets(tmp, [deployment]);
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --preview`,
      /--preview requires --source-run-id/,
    );
  });
});

test("cloudflare-pages preview cleanup requires explicit preview identity", async () => {
  await runInTemp("cloudflare-pages-preview-cleanup-guard", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture({
      preview: cloudflarePagesPreviewFixture(),
    });
    await installCloudflarePagesTargets(tmp, [deployment]);
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --preview-cleanup`,
      /--preview-cleanup requires --source-run-id/,
    );
  });
});

test("cloudflare-pages preview is rejected when deployment metadata does not opt in", async () => {
  await runInTemp("cloudflare-pages-preview-metadata-guard", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    await installCloudflarePagesTargets(tmp, [deployment]);
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --preview --source-run-id deploy-123`,
      /preview is not enabled/,
    );
  });
});
