#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const scriptPath = "build-tools/tools/dev/nix-gaps-baseline.ts";

test("nix-gaps baseline generator writes required sections", async () => {
  await runInTemp("nix-gaps-baseline", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));

    const outPath = path.join(tmp, "docs/handbook/nix-gaps-baseline.md");
    await $({
      cwd: tmp,
    })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs ${scriptPath} --mode fixture --out ${outPath}`;

    const txt = await fs.readFile(outPath, "utf8");
    assert.match(txt, /# Nix gaps baseline/);
    assert.match(txt, /## How to refresh/);
    assert.match(txt, /## Environment summary/);
    assert.match(txt, /## Tool versions/);
    assert.match(txt, /## Example build commands/);
    assert.match(txt, /## Best-effort timings/);
    assert.match(txt, /## Phase 6 parity and hermeticity signals/);
  });
});
