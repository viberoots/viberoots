#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("toolchain package set exposes verify prewarm attrs", async () => {
  const txt = await fsp.readFile("build-tools/tools/nix/flake/packages/toolchains.nix", "utf8");

  for (const attr of ["go", "cxx", "emscripten", "tinygo"]) {
    assert.ok(
      txt.includes(`${attr} = toolchain "`),
      `expected toolchains.nix to expose toolchains.${attr} for verify prewarm`,
    );
  }
});
