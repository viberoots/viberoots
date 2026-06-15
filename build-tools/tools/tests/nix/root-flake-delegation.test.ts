#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("root flake delegates workspace construction to local viberoots input", async () => {
  const flake = await fsp.readFile("flake.nix", "utf8");
  assert.match(flake, /viberoots\.url\s*=\s*"git\+file:\.\/viberoots"/);
  assert.match(flake, /inputs\.viberoots\.lib\.mkWorkspace/);
  assert.match(flake, /workspaceSrc\s*=\s*\.\/\./);
  assert.match(flake, /viberootsInput\s*=\s*inputs\.viberoots/);
  assert.doesNotMatch(flake, /import\s+\.\/build-tools\/tools\/nix\/flake\/outputs\.nix/);
});

test("root flake lock records local viberoots git input", async () => {
  const lock = JSON.parse(await fsp.readFile("flake.lock", "utf8"));
  assert.equal(lock.nodes.root.inputs.viberoots, "viberoots");
  assert.equal(lock.nodes.viberoots.locked.type, "git");
  assert.equal(lock.nodes.viberoots.locked.url, "file:./viberoots");
});

test("graph planner packages use the workspace source under delegated flakes", async () => {
  const graphGenerator = await fsp.readFile("build-tools/tools/nix/graph-generator.nix", "utf8");
  assert.match(
    graphGenerator,
    /repoStoreRoot\s*=\s*if buckTestSrcEnv != ""[\s\S]*else appsLibsSrc;/,
  );
  assert.doesNotMatch(
    graphGenerator,
    /repoStoreRoot\s*=\s*if buckTestSrcEnv != ""[\s\S]*else \.\/\.\.\/\.\.\/\.\.;/,
  );
});

test("nix develop activates live local pre-extraction current path", async () => {
  const script = `
set -euo pipefail
test "$(realpath .viberoots/current)" = "$(pwd -P)/viberoots"
viberoots status --json | jq -e '.sourceMode == "local" and .currentPointsToLiveCheckout == true'
`;
  const result = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`nix develop --accept-flake-config .#default -c bash --noprofile --norc -c ${script}`;

  assert.equal(
    result.exitCode,
    0,
    `expected nix develop to activate live local submodule workspace\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(await fsp.realpath(path.join(".viberoots", "current")), path.resolve("viberoots"));
});
