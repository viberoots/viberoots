#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { toPosixPath, uniqSorted } from "../../lib/posix-path";

test("toPosixPath normalizes separators, trims leading ./, and uses '.' for empty", async () => {
  assert.equal(toPosixPath(""), ".");
  assert.equal(toPosixPath("."), ".");
  assert.equal(toPosixPath("./"), ".");
  assert.equal(toPosixPath(".////"), ".");
  assert.equal(toPosixPath("apps\\web\\pnpm-lock.yaml"), "apps/web/pnpm-lock.yaml");
  assert.equal(toPosixPath("./apps/web"), "apps/web");
  assert.equal(toPosixPath(".\\apps\\web"), "apps/web");
});

test("uniqSorted dedupes after normalization and sorts deterministically", async () => {
  const out = uniqSorted([
    "apps\\web\\patches\\node\\b@2.0.0.patch",
    "./apps/web/patches/node/a@1.0.0.patch",
    "apps/web/patches/node/a@1.0.0.patch",
    "",
    ".",
  ]);
  assert.deepEqual(out, [
    ".",
    "apps/web/patches/node/a@1.0.0.patch",
    "apps/web/patches/node/b@2.0.0.patch",
  ]);
});
