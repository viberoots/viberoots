#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());

async function read(relative: string): Promise<string> {
  return await fsp.readFile(path.join(sourceRoot, relative), "utf8");
}

test("Rust overrides flow only through explicit local-development evaluation bundles", async () => {
  const [planner, template, graph, bundle] = await Promise.all([
    read("build-tools/tools/nix/planner/rust.nix"),
    read("build-tools/tools/nix/templates/rust.nix"),
    read("build-tools/tools/nix/graph-generator.nix"),
    read("build-tools/tools/dev/evaluation-bundle.ts"),
  ]);
  assert.match(planner, /ctx\.languageOverrides/);
  assert.match(planner, /local-development/);
  assert.match(planner, /devOverrides = rustDevOverrides/);
  assert.doesNotMatch(template, /readDevOverrides|builtins\.getEnv.*NIX_RUST/);
  assert.match(template, /\[DEV OVERRIDES ACTIVE\].*Rust/);
  assert.match(graph, /languageOverrides = if evaluationBundle == null then \{\}/);
  assert.match(graph, /lang != "rust".*builtins\.getEnv/s);
  assert.match(bundle, /evaluation bundle with language overrides must be local-development/);
});
