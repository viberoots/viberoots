#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { artifactNixPolicyArgs } from "../../lib/artifact-nix-policy";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { assertArtifactNetworkPolicyInventory } from "./artifact-network-policy.contract";

function read(rel: string): string {
  return fs.readFileSync(viberootsSourcePath(rel), "utf8");
}

test("policy command fixes sandbox, builders, substituters, and keys", () => {
  const args = artifactNixPolicyArgs();
  for (const required of [
    "sandbox",
    "sandbox-fallback",
    "sandbox-paths",
    "extra-sandbox-paths",
    "builders",
    "substituters",
    "trusted-public-keys",
  ]) {
    assert.ok(args.includes(required), `missing ${required}`);
  }
  assert.equal(args[args.indexOf("sandbox") + 1], "true");
  assert.equal(args[args.indexOf("sandbox-fallback") + 1], "false");
  assert.equal(args[args.indexOf("sandbox-paths") + 1], "");
  assert.equal(args[args.indexOf("extra-sandbox-paths") + 1], "");
});

test("CI graph builds and cache admission cannot fail open or claim impure evaluation", () => {
  const stage = read("build-tools/tools/ci/run-stage.ts");
  assert.match(stage, /chooseRunnableFlakeRef/);
  assert.doesNotMatch(stage, /attribute missing; skipping|catch \(e\)/);
  const cache = read("build-tools/tools/ci/cache-publication-policy.ts");
  assert.match(cache, /impureEvaluation: false/);
});

test("network-capable Nix sources have exact fixed-output or runtime ownership", () => {
  assertArtifactNetworkPolicyInventory();
});
