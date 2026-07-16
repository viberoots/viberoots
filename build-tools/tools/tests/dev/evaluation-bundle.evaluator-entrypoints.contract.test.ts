#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

async function source(rel: string): Promise<string> {
  return await fsp.readFile(path.join(root, rel), "utf8");
}

test("normal selected and full evaluators consume registered bundle roots", async () => {
  const filtered = await source("build-tools/tools/dev/filtered-flake.ts");
  const selected = await source("build-tools/tools/dev/build-selected.ts");
  const runnable = await source("build-tools/tools/dev/run-runnable-source.ts");
  const full = await source("build-tools/tools/dev/dev-build/materialize-pure.ts");
  const legacy = await source("build-tools/tools/dev/nix-build-filtered-flake.ts");

  assert.match(filtered, /materializeEvaluationBundle/);
  assert.match(filtered, /bundleDigest: bundle\.digest/);
  assert.doesNotMatch(runnable, /flakeRef: `path:\$\{path\.resolve\(opts\.workspaceRoot\)\}/);
  assert.doesNotMatch(runnable, /flakeRef: `\$\{opts\.workspaceRoot\}#/);
  assert.match(selected, /classification: localDevelopment \? "local-development" : "hermetic"/);
  assert.match(full, /const bundle = await evaluationBundle/);
  assert.match(legacy, /const bundle = await materializeEvaluationBundle/);
  assert.match(legacy, /"--no-write-lock-file"/);
});

test("bundle registration is bounded and never receives a raw live workspace", async () => {
  const registration = await source("build-tools/tools/dev/evaluation-bundle-register.ts");
  const materializer = await source("build-tools/tools/dev/evaluation-bundle.ts");
  const owner = await source("build-tools/tools/dev/evaluation-bundle-owner.ts");
  assert.match(registration, /timeoutMs: 120_000/);
  assert.match(registration, /"store", "add-path"/);
  assert.match(materializer, /path\.join\(tempRoot, "bundle"\)/);
  assert.match(
    materializer,
    /registerEvaluationBundle\)\(\s*bundleRoot,\s*claim\.recordProcessGroup/,
  );
  assert.doesNotMatch(materializer, /registerEvaluationBundle\)\(opts\.stagedSource\)/);
  assert.match(registration, /onSpawn: recordProcessGroup/);
  assert.match(owner, /process\.kill|kill -TERM/);
  assert.match(owner, /evaluation-bundle-process-group/);
  assert.match(owner, /cat "\$M".*= "\$I"/);
});

test("bundle source filtering excludes mutable and credential roots", async () => {
  const filtering = await source("build-tools/tools/dev/nix-build-filtered-flake-filters.ts");
  for (const excluded of [
    '".viberoots/workspace/buck"',
    '"node_modules"',
    '"buck-out"',
    '".env"',
    '".aws"',
    '".ssh"',
    '".netrc"',
  ]) {
    assert.ok(filtering.includes(excluded), `missing bundle exclusion ${excluded}`);
  }
  assert.match(filtering, /DEFAULT_FILTERED_FLAKE_WORKSPACE_PATHS/);
  assert.doesNotMatch(filtering, /DEFAULT_FILTERED_FLAKE_ROOTS = \["\.viberoots"/);
});
