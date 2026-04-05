#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  cloudflarePagesPreviewFixture,
  cloudflarePagesDeploymentFixture,
} from "./cloudflare-pages.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

test("cloudflare-pages preview requires --source-run-id for shared/protected previews", async () => {
  await runInTemp("cloudflare-pages-preview-source-run-guard", async (tmp, $) => {
    const deploymentJson = path.join(tmp, "deployment.json");
    await writeDeploymentJson(
      deploymentJson,
      cloudflarePagesDeploymentFixture({ preview: cloudflarePagesPreviewFixture() }),
    );
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --preview`,
      /--preview requires --source-run-id/,
    );
  });
});

test("cloudflare-pages preview cleanup requires explicit preview identity", async () => {
  await runInTemp("cloudflare-pages-preview-cleanup-guard", async (tmp, $) => {
    const deploymentJson = path.join(tmp, "deployment.json");
    await writeDeploymentJson(
      deploymentJson,
      cloudflarePagesDeploymentFixture({ preview: cloudflarePagesPreviewFixture() }),
    );
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --preview-cleanup`,
      /--preview-cleanup requires --source-run-id/,
    );
  });
});

test("cloudflare-pages preview is rejected when deployment metadata does not opt in", async () => {
  await runInTemp("cloudflare-pages-preview-metadata-guard", async (tmp, $) => {
    const deploymentJson = path.join(tmp, "deployment.json");
    await writeDeploymentJson(deploymentJson, cloudflarePagesDeploymentFixture());
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --preview --source-run-id deploy-123`,
      /preview is not enabled/,
    );
  });
});
