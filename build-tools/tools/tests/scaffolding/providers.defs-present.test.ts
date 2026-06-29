#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import * as fsp from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";

test("legacy third_party/providers/defs.bzl removed; hidden node/python provider defs remain", async () => {
  await runInTemp("providers-defs", async (tmp) => {
    const hasGoDefs = await fsp
      .access(path.join(tmp, "third_party/providers/defs.bzl"))
      .then(() => true)
      .catch(() => false);
    if (hasGoDefs) {
      console.error("unexpected go provider defs.bzl present; should be removed");
      process.exit(2);
    }
    const nodeDefs = await fsp
      .access(path.join(tmp, ".viberoots/workspace/providers/defs_node.bzl"))
      .then(() => true)
      .catch(() => false);
    const pyDefs = await fsp
      .access(path.join(tmp, ".viberoots/workspace/providers/defs_python.bzl"))
      .then(() => true)
      .catch(() => false);
    if (!nodeDefs || !pyDefs) {
      console.error("node/python provider defs missing");
      process.exit(2);
    }
  });
});

test("hidden provider defs use deterministic write rules instead of genrule markers", async () => {
  await runInTemp("providers-defs-write-rules", async (tmp) => {
    for (const name of ["defs_cpp.bzl", "defs_node.bzl", "defs_python.bzl"]) {
      const text = await fsp.readFile(
        path.join(tmp, ".viberoots", "workspace", "providers", name),
        "utf8",
      );
      assert.match(text, /ctx\.actions\.write/);
      assert.doesNotMatch(text, /\bgenrule\b/);
      assert.doesNotMatch(text, /\bcmd\s*=/);
    }
  });
});
