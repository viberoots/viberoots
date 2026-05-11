#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

async function read(relativePath: string) {
  return await fsp.readFile(path.join(repoRoot, relativePath), "utf8");
}

test("deployment service docs stay aligned on hosted token enforcement and staged-reference binding", async () => {
  const [apiDoc, usageDoc, setupDoc, contractDoc] = await Promise.all([
    read("docs/deployment-secrets-api.md"),
    read("docs/nixos-shared-host-usage.md"),
    read("docs/nixos-shared-host-setup.md"),
    read("docs/deployments-contract.md"),
  ]);

  assert.match(
    apiDoc,
    /--control-plane-token <token>[\s\S]*required bearer token[\s\S]*VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1/,
  );
  assert.match(
    apiDoc,
    /challenge issuance rejects[\s\S]*expectedArtifactIdentity[\s\S]*expectedCompositeArtifactIdentity/,
  );
  assert.match(
    apiDoc,
    /stored challenge binding[\s\S]*binding fingerprint[\s\S]*finalized staged artifact reference/,
  );

  assert.match(
    usageDoc,
    /VBR_DEPLOY_CONTROL_PLANE_TOKEN[\s\S]*hosted service[\s\S]*cleans staged artifacts|bounded janitor/i,
  );
  assert.match(
    setupDoc,
    /startup fails closed without a bearer token[\s\S]*VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1/,
  );
  assert.match(
    contractDoc,
    /authenticate the required hosted service bearer token[\s\S]*finalized staged artifact reference/,
  );
  assert.match(
    contractDoc,
    /fail closed when the bearer-token requirement is missing[\s\S]*explicit local fixture mode/,
  );
});
