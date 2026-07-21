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

function selectedViberootsSource(flake: string): string {
  const selected = flake.match(
    /viberoots\.url\s*=\s*"path:(\/nix\/store\/[a-z0-9]{32}-source|\.\/viberoots-flake-input)"/,
  )?.[1];
  assert.ok(selected, "generated flake must select an immutable viberoots source capture");
  return selected;
}

test("hidden workspace flake delegates workspace construction through the selected viberoots input", async () => {
  const flake = await fsp.readFile(path.join(".viberoots", "workspace", "flake.nix"), "utf8");
  selectedViberootsSource(flake);
  assert.match(flake, /inputs\.viberoots\.lib\.mkWorkspace/);
  assert.match(flake, /workspaceSrc\s*=\s*\.\.\/\.\.;/);
  assert.match(flake, /viberootsInput\s*=\s*inputs\.viberoots/);
  assert.doesNotMatch(flake, /import\s+\.\/build-tools\/tools\/nix\/flake\/outputs\.nix/);
});

test("hidden workspace flake lock records the selected viberoots input", async () => {
  const flake = await fsp.readFile(path.join(".viberoots", "workspace", "flake.nix"), "utf8");
  const selectedSource = selectedViberootsSource(flake);
  const lock = JSON.parse(
    await fsp.readFile(path.join(".viberoots", "workspace", "flake.lock"), "utf8"),
  );
  assert.equal(lock.nodes.root.inputs.viberoots, "viberoots");
  const locked = lock.nodes.viberoots.locked;
  assert.equal(locked.type, "path");
  assert.match(locked.path, /^\/nix\/store\/[a-z0-9]{32}-source$/);
  assert.equal(lock.nodes.viberoots.original.type, "path");
  assert.equal(lock.nodes.viberoots.original.path, locked.path);
  if (selectedSource.startsWith("/nix/store/")) assert.equal(locked.path, selectedSource);
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
actual_current="$(realpath .viberoots/current)"
expected_current="$(pwd -P)/viberoots"
if [ "$actual_current" != "$expected_current" ]; then
  echo "expected .viberoots/current to resolve to $expected_current"
  echo "actual: $actual_current"
  echo "link: $(readlink .viberoots/current || true)"
  exit 1
fi
printf '%s\\n' "${markerText}" > viberoots/.live-edit-marker
test "$(cat .viberoots/current/.live-edit-marker)" = "${markerText}"
status_json="$(viberoots status --json)"
printf '%s\\n' "$status_json"
printf '%s\\n' "$status_json" | jq -e '.sourceMode == "local" and .currentPointsToLiveCheckout == true'
`;
  try {
    const result = await $({
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`nix develop --impure --accept-flake-config --no-write-lock-file ${`path:${path.resolve(".viberoots", "workspace")}#default`} -c bash --noprofile --norc -c ${script}`;

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
