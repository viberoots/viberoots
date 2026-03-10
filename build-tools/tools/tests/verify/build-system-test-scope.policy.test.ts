#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasRelevantBuildSystemChanges,
  isBuildSystemPath,
  isIgnoredBuildSystemScopePath,
  parseBuildSystemTestMode,
} from "../../lib/build-system-test-scope.ts";

test("build-system test scope mode parsing supports auto/always/never", () => {
  assert.equal(parseBuildSystemTestMode(undefined), "auto");
  assert.equal(parseBuildSystemTestMode(""), "auto");
  assert.equal(parseBuildSystemTestMode("always"), "always");
  assert.equal(parseBuildSystemTestMode("1"), "always");
  assert.equal(parseBuildSystemTestMode("true"), "always");
  assert.equal(parseBuildSystemTestMode("never"), "never");
  assert.equal(parseBuildSystemTestMode("0"), "never");
  assert.equal(parseBuildSystemTestMode("false"), "never");
  assert.equal(parseBuildSystemTestMode("junk"), "auto");
});

test("build-system path detection includes toolchain/build files and excludes project/docs paths", () => {
  assert.equal(isBuildSystemPath("build-tools/tools/dev/verify.ts"), true);
  assert.equal(isBuildSystemPath("build-tools/tools/tests/verify/foo.test.ts"), true);
  assert.equal(isBuildSystemPath("flake.lock"), true);
  assert.equal(isBuildSystemPath("toolchains/rust/TARGETS"), true);
  assert.equal(isBuildSystemPath("third_party/providers/auto_map.bzl"), true);
  assert.equal(isBuildSystemPath("workspace/apps/myapp/src/index.ts"), false);
  assert.equal(isBuildSystemPath("build-tools/docs/build-system-design.md"), false);
  assert.equal(isBuildSystemPath("docs/handbook/ci.md"), false);
});

test("auto-scope ignores generated metadata and transient dependency/cache directories", () => {
  assert.equal(
    isIgnoredBuildSystemScopePath("build-tools/tools/nix/node-modules.hashes.json"),
    true,
  );
  assert.equal(isIgnoredBuildSystemScopePath("build-tools/tools/node/workspace-map.json"), true);
  assert.equal(isIgnoredBuildSystemScopePath("workspace/apps/puzzle/node_modules"), true);
  assert.equal(
    isIgnoredBuildSystemScopePath("workspace/apps/puzzle/node_modules/react/index.js"),
    true,
  );
  assert.equal(
    isIgnoredBuildSystemScopePath("workspace/apps/puzzle/.vite-cache/vitest/results.json"),
    true,
  );
  assert.equal(isIgnoredBuildSystemScopePath("build-tools/tools/dev/verify.ts"), false);
});

test("relevant build-system changes exclude ignored paths", () => {
  assert.equal(
    hasRelevantBuildSystemChanges([
      "build-tools/tools/nix/node-modules.hashes.json",
      "build-tools/tools/node/workspace-map.json",
      "workspace/apps/puzzle/node_modules",
    ]),
    false,
  );
  assert.equal(
    hasRelevantBuildSystemChanges([
      "build-tools/tools/nix/node-modules.hashes.json",
      "build-tools/tools/dev/verify.ts",
    ]),
    true,
  );
});
