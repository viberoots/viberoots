#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("verify test-seed includes prelude path", async () => {
  const out = await $({
    stdio: "pipe",
  })`nix build --impure .#test-seed --accept-flake-config --no-link --print-out-paths`;
  const seedPath = String(out.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  assert.ok(seedPath, "expected nix build .#test-seed to output a store path");

  const prelude = path.join(seedPath, "prelude");
  const st = await fsp.lstat(prelude);
  assert.ok(
    st.isDirectory() || st.isSymbolicLink(),
    "expected prelude in verify test-seed snapshot",
  );
});
