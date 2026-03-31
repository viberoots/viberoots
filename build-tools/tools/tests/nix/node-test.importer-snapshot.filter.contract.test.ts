#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node-test importer snapshots exclude generated and cache directories", async () => {
  const file = await fsp.readFile("build-tools/tools/nix/flake/packages/node-test.nix", "utf8");
  for (const dir of [
    "node_modules",
    "dist",
    "build",
    ".vite",
    ".next",
    ".turbo",
    ".cache",
    ".direnv",
    ".pnpm-store",
    ".pnpm-home",
    "coverage",
    "report",
    "buck-out",
  ]) {
    assert.match(
      file,
      new RegExp(`"${dir.replace(/\./g, "\\.")}"`),
      `expected node-test importer snapshot to exclude ${dir}`,
    );
  }
});
