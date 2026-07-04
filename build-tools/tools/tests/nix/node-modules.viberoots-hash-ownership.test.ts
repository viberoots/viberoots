#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("viberoots node_modules use source-owned hashes, not live workspace overrides", async () => {
  const perSystem = await fsp.readFile(
    "viberoots/build-tools/tools/nix/flake/per-system-context.nix",
    "utf8",
  );
  assert.match(perSystem, /viberootsNodeMods = import \.\.\/node-modules\.nix \{/);
  assert.match(perSystem, /allowLiveHashMap = false;/);

  const common = await fsp.readFile(
    "viberoots/build-tools/tools/nix/node-modules/common.nix",
    "utf8",
  );
  assert.match(common, /allowLiveHashMap \? true/);
  assert.match(common, /if \(!allowLiveHashMap\) \|\| wr == "" then \[\]/);
});
