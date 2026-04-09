#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { findRepoRoot } from "../../lib/repo.ts";
import { listDeploymentsForCli } from "../../deployments/deploy-front-door.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";
import { s3StaticDeploymentFixture } from "./s3-static.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

test("deploy --list returns the stable repo-level discovery document", async () => {
  const workspaceRoot = await findRepoRoot(process.cwd());
  const listed = await listDeploymentsForCli(workspaceRoot);
  assert.equal(listed.schemaVersion, "deploy-list@1");
  assert.ok(
    listed.deployments.some(
      (entry) => entry.label === "//projects/deployments/pleomino-dev:deploy",
    ),
  );
});

test("deploy --validate-only returns validation output without creating local records", async () => {
  await runInTemp("deploy-validate-only-contract", async (tmp, $) => {
    const deploymentJson = path.join(tmp, "deployment.json");
    const recordsRoot = path.join(tmp, "records");
    await writeDeploymentJson(deploymentJson, nixosSharedHostDeploymentFixture());
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --validate-only`;
    const payload = JSON.parse(String(result.stdout));
    assert.equal(payload.schemaVersion, "deploy-validate@1");
    assert.equal(payload.valid, true);
    assert.equal(
      await fsp
        .access(recordsRoot)
        .then(() => "present")
        .catch(() => "missing"),
      "missing",
    );
  });
});

test("deploy front door rejects cloudflare-pages --provision-only", async () => {
  await runInTemp("deploy-cloudflare-provision-only-guard", async (tmp, $) => {
    const deploymentJson = path.join(tmp, "deployment.json");
    await writeDeploymentJson(deploymentJson, cloudflarePagesDeploymentFixture());
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --provision-only`,
      /does not support --provision-only/,
    );
  });
});

test("deploy front door rejects s3-static --provision-only", async () => {
  await runInTemp("deploy-s3-static-provision-only-guard", async (tmp, $) => {
    const deploymentJson = path.join(tmp, "deployment.json");
    await writeDeploymentJson(deploymentJson, s3StaticDeploymentFixture());
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --provision-only`,
      /provisions as part of deploy/,
    );
  });
});
