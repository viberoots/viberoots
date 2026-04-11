#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { listDeploymentsForCli } from "../../deployments/deploy-front-door.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import {
  writeTempCloudflareValidationWorkspace,
  writeTempListedDeploymentWorkspace,
} from "./deploy.front-door.fixture.ts";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture.ts";
import { s3StaticDeploymentFixture } from "./s3-static.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

test("deploy --list returns the stable repo-level discovery document from scaffolded targets", async () => {
  await runInTemp("deploy-list-contract", async (tmp) => {
    await writeTempListedDeploymentWorkspace(tmp);
    const listed = await listDeploymentsForCli(tmp);
    assert.equal(listed.schemaVersion, "deploy-list@1");
    assert.ok(
      listed.deployments.some((entry) => entry.label === "//sandbox/deployments/demo-dev:deploy"),
    );
  });
});

test("deploy --validate-only validates the reviewed front-door contract without creating local records", async () => {
  await runInTemp("deploy-validate-only-contract", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    await writeTempCloudflareValidationWorkspace(tmp);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-staging:deploy --validate-only`;
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

test("deploy --validate-only fails closed on malformed cloudflare provider config content", async () => {
  await runInTemp("deploy-validate-only-cloudflare-invalid-config", async (tmp, $) => {
    await writeTempCloudflareValidationWorkspace(tmp, {
      wranglerConfig: '{ "name": "demo-staging-pages", "account_id": ',
    });
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-staging:deploy --validate-only`,
      /invalid wrangler config/,
    );
  });
});

test("deploy --validate-only validates referenced Buck target kind expectations", async () => {
  await runInTemp("deploy-validate-only-component-kind", async (tmp, $) => {
    await writeTempCloudflareValidationWorkspace(tmp, {
      appLabels: ["kind:app"],
    });
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-staging:deploy --validate-only`,
      /is not a supported static-webapp/,
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

test("deploy front door routes kubernetes deploys through the reviewed provider guardrails", async () => {
  await runInTemp("deploy-kubernetes-provision-only-guard", async (tmp, $) => {
    const deploymentJson = path.join(tmp, "deployment.json");
    await writeDeploymentJson(deploymentJson, kubernetesDeploymentFixture());
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --provision-only`,
      /kubernetes initial slice provisions as part of deploy/,
    );
  });
});
