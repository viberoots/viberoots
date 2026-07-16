#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  collectChangedPaths,
  hasRelevantBuildSystemChanges,
  isBuildSystemPath,
  isIgnoredBuildSystemScopePath,
  parseBuildSystemTestMode,
  requireChangedPaths,
  resolveBuildSystemBuckTestScope,
} from "../../lib/build-system-test-scope";
import { resolveNonBuildSystemBuckTargets } from "../../lib/non-build-system-scope";
import { mktemp, runInTemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

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
  assert.equal(isBuildSystemPath("viberoots/build-tools/tools/dev/verify.ts"), true);
  assert.equal(isBuildSystemPath("build-tools/tools/tests/verify/foo.test.ts"), true);
  assert.equal(isBuildSystemPath("flake.lock"), true);
  assert.equal(isBuildSystemPath("toolchains/rust/TARGETS"), true);
  assert.equal(isBuildSystemPath(".viberoots/workspace/providers/auto_map.bzl"), true);
  assert.equal(isBuildSystemPath("workspace/apps/myapp/src/index.ts"), false);
  assert.equal(isBuildSystemPath("viberoots/build-tools/docs/build-system-design.md"), false);
  assert.equal(isBuildSystemPath("docs/handbook/ci.md"), false);
});

test("auto-scope ignores generated metadata and transient dependency/cache directories", () => {
  assert.equal(
    isIgnoredBuildSystemScopePath("viberoots/build-tools/tools/nix/node-modules.hashes.json"),
    true,
  );
  assert.equal(isIgnoredBuildSystemScopePath(".viberoots/workspace/node/workspace-map.json"), true);
  assert.equal(isIgnoredBuildSystemScopePath("projects"), true);
  assert.equal(isIgnoredBuildSystemScopePath("projects/"), true);
  assert.equal(isIgnoredBuildSystemScopePath("workspace/apps/puzzle/node_modules"), true);
  assert.equal(
    isIgnoredBuildSystemScopePath("workspace/apps/puzzle/node_modules/react/index.js"),
    true,
  );
  assert.equal(
    isIgnoredBuildSystemScopePath("workspace/apps/puzzle/.vite-cache/vitest/results.json"),
    true,
  );
  assert.equal(isIgnoredBuildSystemScopePath("viberoots/build-tools/tools/dev/verify.ts"), false);
});

test("relevant build-system changes exclude ignored paths", () => {
  assert.equal(
    hasRelevantBuildSystemChanges([
      "viberoots/build-tools/tools/nix/node-modules.hashes.json",
      ".viberoots/workspace/node/workspace-map.json",
      "workspace/apps/puzzle/node_modules",
    ]),
    false,
  );
  assert.equal(
    hasRelevantBuildSystemChanges([
      "viberoots/build-tools/tools/nix/node-modules.hashes.json",
      "viberoots/build-tools/tools/dev/verify.ts",
    ]),
    true,
  );
});

test("dirty nested viberoots repo expands to build-system changed paths", async () => {
  const root = await mktemp("build-system-scope-nested-viberoots-");
  try {
    const nested = path.join(root, "viberoots");
    const toolPath = path.join(nested, "build-tools", "tools", "dev", "verify.ts");
    await fsp.mkdir(path.dirname(toolPath), { recursive: true });
    await fsp.writeFile(toolPath, "export const marker = 1;\n");
    await fsp.writeFile(path.join(nested, "TARGETS"), "# targets\n");

    await $({ cwd: nested })`git init -b main`;
    await $({ cwd: nested })`git add .`;
    await $({ cwd: nested })`git -c user.name=test -c user.email=test@example.com commit -m init`;

    await $({ cwd: root })`git init -b main`;
    await fsp.mkdir(path.join(root, ".viberoots"), { recursive: true });
    await fsp.symlink("../viberoots", path.join(root, ".viberoots", "current"));
    await $({ cwd: root })`git add viberoots`;
    await $({ cwd: root })`git add .viberoots/current`;
    await $({ cwd: root })`git -c user.name=test -c user.email=test@example.com commit -m init`;

    await fsp.writeFile(toolPath, "export const marker = 2;\n");

    const changedPaths = requireChangedPaths(await collectChangedPaths(root, {}));
    assert.equal(changedPaths.includes("viberoots"), true);
    assert.equal(changedPaths.includes("viberoots/build-tools/tools/dev/verify.ts"), true);
    assert.equal(hasRelevantBuildSystemChanges(changedPaths), true);

    const scope = await resolveBuildSystemBuckTestScope({
      root,
      requestedTargets: ["//..."],
      env: {},
    });
    assert.deepEqual(scope.targets, ["//...", "viberoots//..."]);
    assert.equal(scope.hasBuildSystemChanges, true);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("flake-mode viberoots symlink does not expand nested source changes", async () => {
  const root = await mktemp("build-system-scope-flake-viberoots-");
  const storeLike = await mktemp("build-system-scope-flake-source-");
  try {
    const toolPath = path.join(storeLike, "build-tools", "tools", "dev", "verify.ts");
    await fsp.mkdir(path.dirname(toolPath), { recursive: true });
    await fsp.writeFile(toolPath, "export const marker = 1;\n");
    await $({ cwd: storeLike })`git init -b main`;
    await $({ cwd: storeLike })`git add .`;
    await $({
      cwd: storeLike,
    })`git -c user.name=test -c user.email=test@example.com commit -m init`;
    await fsp.writeFile(toolPath, "export const marker = 2;\n");

    await $({ cwd: root })`git init -b main`;
    await fsp.mkdir(path.join(root, ".viberoots"), { recursive: true });
    await fsp.symlink(storeLike, path.join(root, ".viberoots", "current"));
    await fsp.symlink(storeLike, path.join(root, "viberoots"));
    const changedPaths = requireChangedPaths(await collectChangedPaths(root, {}));

    assert.equal(changedPaths.includes("viberoots"), true);
    assert.equal(
      changedPaths.some((p) => p.startsWith("viberoots/")),
      false,
    );
    assert.equal(hasRelevantBuildSystemChanges(changedPaths), false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(storeLike, { recursive: true, force: true });
  }
});

test("git helper probes use non-throwing zx calls", async () => {
  const txt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/lib/changed-paths.ts"),
    "utf8",
  );
  assert.match(txt, /spawn\("git", args/);
  assert.match(txt, /\["diff", "--name-status", "-z", "--find-renames"/);
  assert.match(txt, /\["status", "--porcelain=v1", "-z", "--untracked-files=all"\]/);
});

test("non-build-system target scope derives selectors from top-level workspace roots", async () => {
  await runInTemp("build-system-scope-non-build-roots", async (tmp) => {
    await fsp.mkdir(path.join(tmp, "workspace", "apps", "demo"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "workspace", "apps", "demo", "TARGETS"), "# targets\n");
    await fsp.mkdir(path.join(tmp, "docs"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "docs", "TARGETS"), "# targets\n");
    await fsp.mkdir(path.join(tmp, "build-tools", "tools"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "toolchains", "go"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });

    const targets = await resolveNonBuildSystemBuckTargets(tmp);
    assert.equal(targets.includes("//workspace/..."), true);
    assert.equal(targets.includes("//docs/..."), true);
    assert.equal(targets.includes("@viberoots//build-tools/..."), false);
    assert.equal(targets.includes("//toolchains/..."), false);
    assert.equal(targets.includes("//third_party/..."), false);
  });
});
