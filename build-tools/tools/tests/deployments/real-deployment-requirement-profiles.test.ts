#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { extractDeployments } from "../../deployments/contract";
import {
  queryDeploymentNodes,
  resolveDeploymentFromTarget,
} from "../../deployments/deployment-query";
import type { GraphNode } from "../../lib/graph";

const STAGING = "//projects/deployments/pleomino/staging:deploy";
const PROD = "//projects/deployments/pleomino/prod:deploy";
const SCAFFOLD_WRANGLER = `{
  "$schema": "../../../node_modules/wrangler/config-schema.json",
  "compatibility_date": "2026-03-18",
}
`;

test("real pleomino Cloudflare deployments declare typed external requirement profiles", async () => {
  for (const label of [STAGING, PROD]) {
    const deployment = await resolveDeploymentFromTarget(process.cwd(), label);
    assert.deepEqual(deployment.externalRequirementProfiles, ["cloudflare_provider"]);
  }
});

test("real pleomino Cloudflare profile fails closed when a lifecycle secret is missing", async () => {
  const nodes = await queryDeploymentNodes(process.cwd(), [
    STAGING,
    "//projects/apps/pleomino:app",
    "//projects/deployments/pleomino/dev:deploy",
    "//projects/deployments/pleomino/shared:lane",
    "//projects/deployments:defaults",
    "//projects/deployments/pleomino/shared:lane_governance",
    "//projects/deployments/pleomino/shared:staging_release",
  ]);
  const mutated = nodes.map((node): GraphNode => {
    if (node.name !== STAGING) return node;
    return {
      ...node,
      secret_requirements: [],
    };
  });
  const { errors } = extractDeployments(mutated);
  assert.ok(
    errors.some((entry) =>
      entry.includes("cloudflare_provider missing secret_requirements cloudflare_api_token"),
    ),
  );
});

test("real pleomino Cloudflare wrangler configs match the scaffolded minimal shape", async () => {
  for (const stage of ["staging", "prod"]) {
    const wranglerPath = path.join("projects", "deployments", "pleomino", stage, "wrangler.jsonc");
    assert.equal(await fsp.readFile(wranglerPath, "utf8"), SCAFFOLD_WRANGLER);
  }
});
