#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function read(relativePath: string) {
  return await fsp.readFile(path.join(process.cwd(), relativePath), "utf8");
}

test("PR-89 docs stay aligned on separated control-plane roles and composable scopes", async () => {
  const [designDoc, contractDoc, scenariosDoc] = await Promise.all([
    read("docs/deployments-design.md"),
    read("docs/deployments-contract.md"),
    read("docs/deployment-scenarios.md"),
  ]);

  assert.match(
    designDoc,
    /admission_reporter[\s\S]*project[\s\S]*environment_stage[\s\S]*admission_domain[\s\S]*all_deployments/i,
  );
  assert.match(contractDoc, /admission_reporter[\s\S]*bootstrap[\s\S]*deployment-system/i);
  assert.match(
    contractDoc,
    /authorization snapshots? and status payloads[\s\S]*full normalized grant set/i,
  );
  assert.match(
    scenariosDoc,
    /human submitter \+ human approver[\s\S]*CI reporter \+ human submitter[\s\S]*CI submitter \+ human approver[\s\S]*CI submitter \+ CI approver/i,
  );
});
