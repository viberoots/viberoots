#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cloudflarePagesPreviewFixture,
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { runInTemp } from "../lib/test-helpers";
import { execManaged } from "../lib/test-helpers/managed-exec";

async function assertDeploymentRejected(
  cwd: string,
  args: string[],
  pattern: RegExp,
): Promise<void> {
  await assert.rejects(
    execManaged(
      "zx-wrapper",
      [viberootsToolScript("build-tools/tools/deployments/deploy-internal.ts"), ...args],
      { cwd, env: process.env },
    ),
    pattern,
  );
}

test("cloudflare-pages preview requires --source-run-id for shared/protected previews", async () => {
  await runInTemp("cloudflare-pages-preview-source-run-guard", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture({
      preview: cloudflarePagesPreviewFixture(),
    });
    await installCloudflarePagesTargets(tmp, [deployment]);
    await assertDeploymentRejected(
      tmp,
      ["--deployment", deployment.label, "--preview"],
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
    await assertDeploymentRejected(
      tmp,
      ["--deployment", deployment.label, "--preview-cleanup"],
      /--preview-cleanup requires --source-run-id/,
    );
  });
});

test("cloudflare-pages preview is rejected when deployment metadata does not opt in", async () => {
  await runInTemp("cloudflare-pages-preview-metadata-guard", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    await installCloudflarePagesTargets(tmp, [deployment]);
    await assertDeploymentRejected(
      tmp,
      ["--deployment", deployment.label, "--preview", "--source-run-id", "deploy-123"],
      /preview is not enabled/,
    );
  });
});
