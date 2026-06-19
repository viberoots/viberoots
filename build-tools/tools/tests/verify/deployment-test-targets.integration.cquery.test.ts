#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  deploymentSafetyFloorTargets,
  queryDeploymentDomainTargets,
} from "../../lib/deployment-test-targets";
import { REVIEWED_DEPLOYMENT_TEST_AREA } from "../../lib/deployment-verify-scope";
import { targetLabelFromScript } from "../../lib/template-owned-tests";

async function deploymentTestTargets(root: string): Promise<string[]> {
  const dir = path.join(root, "viberoots", REVIEWED_DEPLOYMENT_TEST_AREA);
  const entries = await fsp.readdir(dir);
  return entries
    .filter((entry) => entry.endsWith(".test.ts"))
    .map((entry) => targetLabelFromScript(path.posix.join(REVIEWED_DEPLOYMENT_TEST_AREA, entry)))
    .map((label) => label.replace(/^\/\//, "viberoots//"))
    .sort();
}

test("deployment selector query resolves the reviewed deployment suite", async () => {
  const expected = await deploymentTestTargets(process.cwd());
  const targets = await queryDeploymentDomainTargets(process.cwd());
  assert.ok(targets.length > 0);
  assert.deepEqual(targets, expected);
});

test("deployment selector safety floor stays non-empty and inside the deployment suite", async () => {
  const targets = await queryDeploymentDomainTargets(process.cwd());
  const safetyFloorTargets = deploymentSafetyFloorTargets(process.cwd());
  assert.ok(safetyFloorTargets.length > 0);
  for (const target of safetyFloorTargets) {
    assert.ok(targets.includes(target), `expected deployment safety floor to include ${target}`);
  }
});
