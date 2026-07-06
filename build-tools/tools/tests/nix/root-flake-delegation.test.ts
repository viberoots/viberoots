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

test("hidden workspace flake delegates workspace construction through the selected viberoots input", async () => {
  const flake = await fsp.readFile(path.join(".viberoots", "workspace", "flake.nix"), "utf8");
  assert.match(flake, /viberoots\.url\s*=\s*"path:.*\/viberoots(?:-flake-input)?"/);
  assert.match(flake, /inputs\.viberoots\.lib\.mkWorkspace/);
  assert.match(flake, /if root != "" then builtins\.toPath root else \.\.\/\.\./);
  assert.match(flake, /viberootsInput\s*=\s*inputs\.viberoots/);
  assert.doesNotMatch(flake, /import\s+\.\/build-tools\/tools\/nix\/flake\/outputs\.nix/);
});

test("hidden workspace flake lock records the selected viberoots input", async () => {
  const lock = JSON.parse(
    await fsp.readFile(path.join(".viberoots", "workspace", "flake.lock"), "utf8"),
  );
  assert.equal(lock.nodes.root.inputs.viberoots, "viberoots");
  const locked = lock.nodes.viberoots.locked;
  if (locked.type === "path") {
    assert.match(locked.path, /viberoots(?:-flake-input)?$/);
  } else {
    assert.equal(locked.type, "git");
    assert.match(locked.url, /github\.com\/viberoots\/viberoots\.git$/);
  }
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
