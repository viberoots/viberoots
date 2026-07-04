#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const wranglerShape = `{
  "$schema": "../../../node_modules/wrangler/config-schema.json",
  "compatibility_date": "2026-03-18",
}
`;

const deployments = [
  {
    id: "sample-webapp-staging",
    packagePath: ["sample-webapp", "staging"],
    account: "web-platform-staging",
    domain: "staging.sample-webapp.com",
    project: "sample-webapp-staging-pages",
    stage: "staging",
    protectionClass: "shared_nonprod",
    prerequisiteId: "sample-webapp-dev",
  },
  {
    id: "sample-webapp-prod",
    packagePath: ["sample-webapp", "prod"],
    account: "web-platform-prod",
    domain: "sample-webapp.com",
    project: "sample-webapp-prod-pages",
    stage: "prod",
    protectionClass: "production_facing",
    prerequisiteId: "sample-webapp-staging",
  },
];

async function readDeploymentFile(
  repoRoot: string,
  packagePath: readonly string[],
  file: string,
): Promise<string> {
  return await fsp.readFile(
    path.join(repoRoot, "projects/deployments", ...packagePath, file),
    "utf8",
  );
}

function expectedTargets(deployment: (typeof deployments)[number]): string {
  return `load("//projects/deployments/sample-webapp/shared:family.bzl", "sample_webapp_cloudflare_deployment")

sample_webapp_cloudflare_deployment(
    name = "deploy",
    stage = "${deployment.stage}",
    domain = "${deployment.domain}",
    admission_policy = "${deployment.stage}_release",
    protection_class = "${deployment.protectionClass}",
    prerequisite = "${deployment.prerequisiteId}",
)
`;
}

async function writeDeploymentFixture(repoRoot: string): Promise<void> {
  for (const deployment of deployments) {
    const deploymentDir = path.join(repoRoot, "projects/deployments", ...deployment.packagePath);
    await fsp.mkdir(deploymentDir, { recursive: true });
    await fsp.writeFile(path.join(deploymentDir, "wrangler.jsonc"), wranglerShape, "utf8");
    await fsp.writeFile(path.join(deploymentDir, "TARGETS"), expectedTargets(deployment), "utf8");
  }
}

test("Cloudflare Pages migration fixture keeps scaffolded file shape", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "deployment-cloudflare-pages-migration-"));
  try {
    await writeDeploymentFixture(tmp);

    for (const deployment of deployments) {
      const wrangler = await readDeploymentFile(tmp, deployment.packagePath, "wrangler.jsonc");
      assert.equal(wrangler, wranglerShape);
      assert.equal(
        await readDeploymentFile(tmp, deployment.packagePath, "TARGETS"),
        expectedTargets(deployment),
      );
    }
  } finally {
    await fsp.rm(tmp, { force: true, recursive: true });
  }
});
