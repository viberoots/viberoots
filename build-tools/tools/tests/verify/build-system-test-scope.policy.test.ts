#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  hasRelevantBuildSystemChanges,
  isBuildSystemPath,
  isIgnoredBuildSystemScopePath,
  parseBuildSystemTestMode,
} from "../../lib/build-system-test-scope";
import { resolveNonBuildSystemBuckTargets } from "../../lib/non-build-system-scope";
import { runInTemp } from "../lib/test-helpers";

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

test("git helper probes use non-throwing zx calls", async () => {
  const txt = await fsp.readFile("build-tools/tools/lib/build-system-test-scope.ts", "utf8");
  assert.equal(txt.includes("git rev-parse --verify --quiet ${ref}`.nothrow()"), true);
  assert.equal(txt.includes("git merge-base ${ref} HEAD`.nothrow()"), true);
  assert.equal(txt.includes("git status --porcelain=v1`.nothrow()"), true);
});

test("non-build-system target scope derives selectors from top-level workspace roots", async () => {
  await runInTemp("build-system-scope-non-build-roots", async (tmp) => {
    await fsp.mkdir(path.join(tmp, "workspace", "apps", "demo"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "docs"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "build-tools", "tools"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "toolchains", "go"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });

    const targets = await resolveNonBuildSystemBuckTargets(tmp);
    assert.equal(targets.includes("//workspace/..."), true);
    assert.equal(targets.includes("//docs/..."), true);
    assert.equal(targets.includes("//build-tools/..."), false);
    assert.equal(targets.includes("//toolchains/..."), false);
    assert.equal(targets.includes("//third_party/..."), false);
  });
});
