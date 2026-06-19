#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node-test importer snapshots exclude generated and cache directories", async () => {
  const file = await fsp.readFile(
    "viberoots/build-tools/tools/nix/flake/packages/node-test.nix",
    "utf8",
  );
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
    "pnpm-workspace.yaml",
  ]) {
    assert.match(
      file,
      new RegExp(`"${dir.replace(/\./g, "\\.")}"`),
      `expected node-test importer snapshot to exclude ${dir}`,
    );
  }
  assert.match(
    file,
    /node_modules\\\\\.lockfile-guard/,
    "expected node-test importer snapshot to exclude lockfile guard artifacts",
  );
});
