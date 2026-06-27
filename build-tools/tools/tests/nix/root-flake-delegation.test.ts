#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function activeBuildToolPath(rel: string): Promise<string> {
  const direct = path.join("build-tools", rel);
  try {
    await fsp.access(direct);
    return direct;
  } catch {}
  return path.join("viberoots", "build-tools", rel);
}

test("hidden workspace flake delegates workspace construction to local viberoots input", async () => {
  const flake = await fsp.readFile(path.join(".viberoots", "workspace", "flake.nix"), "utf8");
  assert.match(flake, /viberoots\.url\s*=\s*"path:.*\/viberoots"/);
  assert.match(flake, /inputs\.viberoots\.lib\.mkWorkspace/);
  assert.match(flake, /if root != "" then builtins\.toPath root else \.\.\/\.\./);
  assert.match(flake, /viberootsInput\s*=\s*inputs\.viberoots/);
  assert.doesNotMatch(flake, /import\s+\.\/build-tools\/tools\/nix\/flake\/outputs\.nix/);
});

test("hidden workspace flake lock records local viberoots path input", async () => {
  const lock = JSON.parse(
    await fsp.readFile(path.join(".viberoots", "workspace", "flake.lock"), "utf8"),
  );
  assert.equal(lock.nodes.root.inputs.viberoots, "viberoots");
  assert.equal(lock.nodes.viberoots.locked.type, "path");
  assert.match(lock.nodes.viberoots.locked.path, /viberoots$/);
});

test("graph planner packages use the workspace source under delegated flakes", async () => {
  const graphGenerator = await fsp.readFile(
    await activeBuildToolPath("tools/nix/graph-generator.nix"),
    "utf8",
  );
  assert.match(
    graphGenerator,
    /repoStoreRoot\s*=\s*if buckTestSrcEnv != ""[\s\S]*else appsLibsSrc;/,
  );
  assert.doesNotMatch(
    graphGenerator,
    /repoStoreRoot\s*=\s*if buckTestSrcEnv != ""[\s\S]*else \.\/\.\.\/\.\.\/\.\.;/,
  );
});

test("nix develop activates live local submodule workflow path", async () => {
  const markerText = `live-edit-${Date.now()}`;
  const marker = path.join("viberoots", ".live-edit-marker");
  const script = `
set -euo pipefail
test "$(realpath .viberoots/current)" = "$(pwd -P)/viberoots"
printf '%s\\n' "${markerText}" > viberoots/.live-edit-marker
test "$(cat .viberoots/current/.live-edit-marker)" = "${markerText}"
viberoots status --json | jq -e '.sourceMode == "local" and .currentPointsToLiveCheckout == true'
`;
  try {
    const result = await $({
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`nix develop --impure --accept-flake-config --override-input viberoots ${`path:${path.resolve("viberoots")}`} ${`path:${path.resolve(".viberoots", "workspace")}#default`} -c bash --noprofile --norc -c ${script}`;

    assert.equal(
      result.exitCode,
      0,
      `expected nix develop to activate live local submodule workspace\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.equal(await fsp.realpath(path.join(".viberoots", "current")), path.resolve("viberoots"));
  } finally {
    await fsp.rm(marker, { force: true });
  }
});
