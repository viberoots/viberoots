#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("cpp emscripten template seeds EM_CACHE from a reusable derivation", async () => {
  const txt = await fsp.readFile(
    "viberoots/build-tools/tools/nix/templates/cpp-emscripten-lib.nix",
    "utf8",
  );

  assert.ok(
    txt.includes('emscriptenCacheSeed = pkgs.runCommand "emscripten-cache-seed-'),
    "expected cpp emscripten template to define a reusable emscripten cache seed derivation",
  );

  assert.ok(
    txt.includes('cp -a ${emscriptenCacheSeed}/. "$EM_CACHE"/'),
    "expected cpp emscripten template to prepopulate EM_CACHE from the shared seed derivation",
  );

  assert.ok(
    txt.includes('chmod -R u+w "$EM_CACHE"'),
    "expected copied emscripten cache to be made writable before emcc reuses it",
  );
});
