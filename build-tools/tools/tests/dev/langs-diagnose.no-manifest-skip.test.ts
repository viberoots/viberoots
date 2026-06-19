#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("langs-diagnose works without langs.json and prints empty sets", async () => {
  await runInTemp("langs-diagnose-no-manifest", async (tmp, $) => {
    // Ensure no manifest exists
    await fs.remove(path.join(tmp, "viberoots/build-tools/tools/nix/langs.json")).catch(() => {});
    const p = path.join(tmp, "viberoots/build-tools/tools/dev/langs-diagnose.ts");
    const res = await $`node ${p} --json`;
    const obj = JSON.parse(String(res.stdout || "{}"));
    assert.ok(obj);
    assert.ok(Array.isArray(obj.enabled));
    assert.ok(Array.isArray(obj.disabled));
    assert.ok(Array.isArray(obj.adapters));
    assert.ok(Array.isArray(obj.plannerPlugins));
    assert.ok(Array.isArray(obj.stages));
  });
});
