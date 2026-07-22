#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import { test } from "node:test";
import { buildToolPath } from "../../dev/dev-build/paths";

test("lint-global-stamping passes (no direct global Nix input labels in macros)", async () => {
  const zxInit = buildToolPath(process.cwd(), "tools/dev/zx-init.mjs");
  const script = buildToolPath(process.cwd(), "tools/dev/lint-global-stamping.ts");
  const res = await $`node --experimental-strip-types --import ${zxInit} ${script}`.nothrow();
  if (res.exitCode !== 0) {
    throw new Error("lint-global-stamping failed:\n" + String(res.stderr || res.stdout || ""));
  }
});

test("lint-global-stamping rejects old and root-qualified direct spellings", async () => {
  const script = await fs.readFile(
    buildToolPath(process.cwd(), "tools/dev/lint-global-stamping.ts"),
    "utf8",
  );
  for (const label of [
    "//.viberoots/workspace:flake.lock",
    "root//.viberoots/workspace:flake.lock",
    "//projects/config:node-modules.hashes.json",
    "root//projects/config:node-modules.hashes.json",
    "//.viberoots/workspace:nixpkgs-source-registry-extension",
    "root//.viberoots/workspace:nixpkgs-source-registry-extension",
  ]) {
    assert.ok(script.includes(JSON.stringify(label)), `lint omits forbidden spelling ${label}`);
  }
});
