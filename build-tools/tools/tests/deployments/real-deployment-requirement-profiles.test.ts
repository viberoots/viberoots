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
import { runInTemp } from "../lib/test-helpers";
import {
  CUTOVER_APP,
  CUTOVER_DEV,
  CUTOVER_SHARED,
  CUTOVER_STAGING,
  minimalWranglerConfig,
  writeCutoverDeploymentFixture,
} from "./infisical-cutover.fixture";

test("fixture Cloudflare deployments declare typed external requirement profiles", async () => {
  await runInTemp("requirement-profiles-fixture", async (tmp) => {
    await writeCutoverDeploymentFixture(tmp);
    for (const label of [CUTOVER_STAGING]) {
      const deployment = await resolveDeploymentFromTarget(tmp, label);
      assert.deepEqual(deployment.externalRequirementProfiles, ["cloudflare_provider"]);
    }
  });
});

test("fixture Cloudflare profile fails closed when a lifecycle secret is missing", async () => {
  await runInTemp("requirement-profiles-missing-secret", async (tmp) => {
    await writeCutoverDeploymentFixture(tmp);
    const nodes = await queryDeploymentNodes(tmp, [
      CUTOVER_STAGING,
      CUTOVER_APP,
      CUTOVER_DEV,
      `${CUTOVER_SHARED}:defaults`,
      `${CUTOVER_SHARED}:lane`,
      `${CUTOVER_SHARED}:lane_governance`,
      `${CUTOVER_SHARED}:staging_release`,
    ]);
    const mutated = nodes.map((node): GraphNode => {
      if (node.name !== CUTOVER_STAGING) return node;
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
});

test("fixture Cloudflare wrangler configs match the scaffolded minimal shape", async () => {
  await runInTemp("requirement-profiles-wrangler", async (tmp) => {
    await writeCutoverDeploymentFixture(tmp);
    for (const stage of ["staging", "prod"]) {
      const wranglerPath = path.join(
        tmp,
        "projects",
        "deployments",
        "cutover-demo",
        stage,
        "wrangler.jsonc",
      );
      assert.equal(await fsp.readFile(wranglerPath, "utf8"), minimalWranglerConfig());
    }
  });
});
