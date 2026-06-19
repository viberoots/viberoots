#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function readText(file: string): Promise<string> {
  return await fsp.readFile(file, "utf8");
}

function assertNotIncludes(haystack: string, needle: string, message: string) {
  assert.ok(!haystack.includes(needle), message);
}

test("macro entrypoints keep a single merge point for labels/deps and avoid duplicated importer-mismatch logic", async () => {
  const nodeDefsNix = await readText("viberoots/build-tools/node/defs_nix.bzl");
  assertNotIncludes(
    nodeDefsNix,
    "importer != None and importer != _importer",
    "build-tools/node/defs_nix.bzl must route importer mismatch validation through a single helper (no inline mismatch checks)",
  );

  const pythonDefs = await readText("viberoots/build-tools/python/defs.bzl");
  assertNotIncludes(
    pythonDefs,
    'kwargs["labels"] = dedupe_preserve((labels or []) + (kwargs.get("labels", []) or []))',
    "viberoots/build-tools/python/defs.bzl must not manually merge labels into kwargs; route through shared wiring helper merge points",
  );
});
