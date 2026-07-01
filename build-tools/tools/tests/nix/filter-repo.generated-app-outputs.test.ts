#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";

test("filter-repo excludes generated app output directories from flake snapshots", async () => {
  const file = await fs.readFile(
    "viberoots/build-tools/tools/nix/flake/packages/filter-repo.nix",
    "utf8",
  );
  for (const dir of ["dist", "build", ".vite", ".next", ".wasm-producer"]) {
    assert.match(
      file,
      new RegExp(`isGeneratedTree "${dir.replace(/\./g, "\\.")}"`),
      `expected filter-repo to exclude ${dir}`,
    );
  }
  assert.match(
    file,
    /\(_type == "directory" \|\| _type == "symlink"\)/,
    "generated output filtering must exclude symlinked generated trees",
  );
  assert.doesNotMatch(
    file,
    /_type == "regular"/,
    "generated output filtering must not exclude executable files named build/dist",
  );
});
