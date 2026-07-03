#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("graph generator app/lib source filter excludes generated directories", async () => {
  const file = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/graph-generator.nix"),
    "utf8",
  );
  assert.match(file, /isGeneratedDir/, "expected a generated-directory guard");
  assert.match(
    file,
    /!\s*isGeneratedDir\s*&&/,
    "expected generated directories to be pruned before app/lib source inclusion",
  );
  for (const dir of [
    "node_modules",
    "buck-out",
    ".direnv",
    ".pnpm-store",
    ".pnpm-home",
    "coverage",
    ".clinic",
    ".turbo",
    ".cache",
    "dist",
    "build",
    ".vite",
    ".next",
    ".wasm-producer",
  ]) {
    assert.match(file, new RegExp(`base == "${dir.replace(/\./g, "\\.")}"`));
  }
});
