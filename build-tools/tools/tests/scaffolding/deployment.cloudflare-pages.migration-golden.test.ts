#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const wranglerShape = `{
  "$schema": "../../../node_modules/wrangler/config-schema.json",
  "compatibility_date": "2026-03-18",
}
`;

const deployments = [
  {
    id: "pleomino-staging",
    account: "web-platform-staging",
    domain: "staging.pleomino.com",
    project: "pleomino-staging-pages",
    stage: "staging",
    protectionClass: "shared_nonprod",
    prerequisiteId: "pleomino-dev",
  },
  {
    id: "pleomino-prod",
    account: "web-platform-prod",
    domain: "pleomino.com",
    project: "pleomino-prod-pages",
    stage: "prod",
    protectionClass: "production_facing",
    prerequisiteId: "pleomino-staging",
  },
];

async function readDeploymentFile(deploymentId: string, file: string): Promise<string> {
  return await fsp.readFile(
    path.join(repoRoot, "projects/deployments", deploymentId, file),
    "utf8",
  );
}

function expectedTargets(deployment: (typeof deployments)[number]): string {
  return `load("//projects/deployments/pleomino-shared:family.bzl", "pleomino_cloudflare_deployment")

pleomino_cloudflare_deployment(
    name = "deploy",
    stage = "${deployment.stage}",
    account = "${deployment.account}",
    project = "${deployment.project}",
    domain = "${deployment.domain}",
    admission_policy = "${deployment.stage}_release",
    protection_class = "${deployment.protectionClass}",
    prerequisite = "${deployment.prerequisiteId}",
)
`;
}

test("checked-in Cloudflare Pages deployments keep scaffolded file shape", async () => {
  for (const deployment of deployments) {
    const wrangler = await readDeploymentFile(deployment.id, "wrangler.jsonc");
    assert.equal(wrangler, wranglerShape);
    assert.equal(await readDeploymentFile(deployment.id, "TARGETS"), expectedTargets(deployment));
  }
});
