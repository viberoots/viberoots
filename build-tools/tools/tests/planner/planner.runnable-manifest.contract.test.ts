#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("planner manifest script retains runnable contract shapes for bin and webapp", async () => {
  const manifestNix = path.join(
    process.cwd(),
    "build-tools",
    "tools",
    "nix",
    "planner",
    "manifest.nix",
  );
  const txt = await fsp.readFile(manifestNix, "utf8");
  assert.ok(txt.includes('\\"runnable\\": { \\"kind\\": \\"native-bin\\"'));
  assert.ok(txt.includes('\\"runnable\\": { \\"kind\\": \\"webapp\\"'));
  assert.ok(txt.includes('\\"runnable\\": { \\"kind\\": \\"webapp-ssr\\"'));
  assert.ok(txt.includes('\\"framework\\": \\"$framework\\"'));
  assert.ok(txt.includes('\\"node\\", \\"$serverEntry\\"'));
  assert.ok(txt.includes('\\"dev:ssr\\"'));
  assert.ok(txt.includes('\\"pnpm\\", \\"--dir\\", \\"$importer\\", \\"dev\\"'));
  assert.ok(txt.includes('elif [ -d "$dist" ];'));
});
