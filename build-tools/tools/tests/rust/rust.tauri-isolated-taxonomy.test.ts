#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { planVerifyTargetPasses, VERIFY_ISOLATED_LABEL } from "../../dev/verify/target-passes";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";

const files = [
  "build-tools/tools/tests/rust/rust.tauri-composition.behavior.test.ts",
  "build-tools/tools/tests/rust/rust.tauri-scaffold-flake.lifecycle.test.ts",
  "build-tools/tools/tests/scaffolding/rust-shapes.scaffold-lifecycle.test.ts",
] as const;

test("disk-heavy Rust and Tauri lifecycle tests run serially before shared tests", async () => {
  const taxonomy = await fsp.readFile(
    path.join(VIBEROOTS_SOURCE_ROOT, "build-tools/tools/tests/isolated_test_conventions.bzl"),
    "utf8",
  );
  for (const file of files) assert.match(taxonomy, new RegExp(`${JSON.stringify(file)}: True`));

  const targets = files.map((file) => ({ target: `//:${file}`, labels: [VERIFY_ISOLATED_LABEL] }));
  assert.deepEqual(planVerifyTargetPasses(targets), [
    {
      name: "isolated",
      targets: targets.map(({ target }) => target),
      threadsOverride: 1,
    },
  ]);
});
