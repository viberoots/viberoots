#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { untrackedRequiresImpureForTargets } from "../../dev/dev-build/untracked";

test("target-aware untracked policy ignores unrelated docs/tests paths", () => {
  const r = untrackedRequiresImpureForTargets({
    untracked: [
      "docs/notes.md",
      "viberoots/build-tools/tools/tests/dev/foo.test.ts",
      "viberoots/build-tools/docs/guide.md",
    ],
    targetPackages: ["projects/apps/myapp"],
  });
  assert.equal(r.requiresImpure, false);
  assert.equal(r.relevant.length, 0);
  assert.equal(r.ignored.length, 3);
});

test("target-aware untracked policy marks target package files relevant", () => {
  const r = untrackedRequiresImpureForTargets({
    untracked: ["projects/apps/myapp/src/new.ts"],
    targetPackages: ["projects/apps/myapp"],
  });
  assert.equal(r.requiresImpure, true);
  assert.deepEqual(r.relevant, ["projects/apps/myapp/src/new.ts"]);
});

test("target-aware untracked policy marks global build inputs relevant", () => {
  const r = untrackedRequiresImpureForTargets({
    untracked: ["flake.lock", "viberoots/build-tools/node/defs_nix.bzl"],
    targetPackages: ["projects/apps/myapp"],
  });
  assert.equal(r.requiresImpure, true);
  assert.equal(r.relevant.length, 2);
});
