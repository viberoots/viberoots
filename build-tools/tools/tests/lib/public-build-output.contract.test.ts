#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { parsePublicBuildOutPath } from "./test-helpers/public-build";

const root = "/workspace";
const target = "//projects/apps/demo:desktop";
const output = "buck-out/v2/gen/projects/apps/demo/__desktop__/artifact";

test("public build output resolves only the exact configured target", () => {
  assert.equal(
    parsePublicBuildOutPath(
      [
        "//projects/apps/demo:desktop-old buck-out/stale",
        `root${target} ${output}`,
        "noise mentioning //projects/apps/demo:desktop and buck-out/stale",
      ].join("\n"),
      target,
      root,
    ),
    path.join(root, output),
  );
});

test("public build output rejects missing, duplicate, and non-Buck outputs", () => {
  assert.throws(() => parsePublicBuildOutPath("", target, root), /found 0/);
  assert.throws(
    () =>
      parsePublicBuildOutPath(
        [`${target} ${output}`, `root${target} buck-out/second`].join("\n"),
        target,
        root,
      ),
    /found 2/,
  );
  assert.throws(
    () => parsePublicBuildOutPath(`${target} /nix/store/stale-traversal`, target, root),
    /found 0/,
  );
});
