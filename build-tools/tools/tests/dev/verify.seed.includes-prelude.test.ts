#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("verify test-seed includes build-system paths needed by temp Buck repos", async () => {
  const out = await $({
    stdio: "pipe",
  })`nix build --impure .#test-seed --accept-flake-config --no-link --print-out-paths`;
  const seedPath = String(out.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  assert.ok(seedPath, "expected nix build .#test-seed to output a store path");

  const prelude = path.join(seedPath, "prelude");
  const preludeStat = await fsp.lstat(prelude);
  assert.ok(
    preludeStat.isDirectory() || preludeStat.isSymbolicLink(),
    "expected prelude in verify test-seed snapshot",
  );

  const deploymentDefs = path.join(seedPath, "build-tools", "deployments", "defs.bzl");
  const deploymentDefsStat = await fsp.lstat(deploymentDefs);
  assert.ok(deploymentDefsStat.isFile(), "expected deployment defs in verify test-seed snapshot");

  const localViberootsFlake = path.join(seedPath, "viberoots", "flake.nix");
  const localViberootsFlakeStat = await fsp.lstat(localViberootsFlake);
  assert.ok(
    localViberootsFlakeStat.isFile(),
    "expected local viberoots flake input in verify test-seed snapshot",
  );
});
