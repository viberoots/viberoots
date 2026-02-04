#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import * as fsp from "node:fs/promises";

test("third_party/providers/defs.bzl removed; node/python provider defs remain", async () => {
  await runInTemp("providers-defs", async () => {
    const hasGoDefs = await fsp
      .access("third_party/providers/defs.bzl")
      .then(() => true)
      .catch(() => false);
    if (hasGoDefs) {
      console.error("unexpected go provider defs.bzl present; should be removed");
      process.exit(2);
    }
    const nodeDefs = await fsp
      .access("third_party/providers/defs_node.bzl")
      .then(() => true)
      .catch(() => false);
    const pyDefs = await fsp
      .access("third_party/providers/defs_python.bzl")
      .then(() => true)
      .catch(() => false);
    if (!nodeDefs || !pyDefs) {
      console.error("node/python provider defs missing");
      process.exit(2);
    }
  });
});
