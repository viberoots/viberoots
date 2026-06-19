#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("python wheelhouse: contract keys wheelhouse identity to lockfile+patches only", async () => {
  const file = path.join(
    process.cwd(),
    "viberoots",
    "build-tools",
    "tools",
    "nix",
    "templates",
    "python.nix",
  );
  const txt = await fsp.readFile(file, "utf8");
  assert.ok(txt.includes("pyWheelhouse = {"), "expected pyWheelhouse definition in python.nix");
  assert.ok(txt.includes('pname = "py-wheelhouse";'));
  assert.ok(txt.includes('lockfile = "uv.lock";'));
  assert.ok(txt.includes('subdir = ".";'));
  assert.ok(txt.includes("groups = [];"));
  assert.ok(txt.includes("patchesMap = patchesMap;"));
  assert.ok(txt.includes("devOverrides = {};"));
});
