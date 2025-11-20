#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python/defs.bzl exists and exports nix_python_* macros", async () => {
  await runInTemp("defs-bzl-exists", async (tmp, $) => {
    const p = path.join(tmp, "python", "defs.bzl");
    const ok = await fs.pathExists(p);
    if (!ok) {
      console.error("missing python/defs.bzl at", p);
      process.exit(2);
    }
    const txt = await fs.readFile(p, "utf8");
    const must = ["def nix_python_library(", "def nix_python_binary(", "def nix_python_test("];
    for (const m of must) {
      if (!txt.includes(m)) {
        console.error("expected macro missing in python/defs.bzl:", m);
        process.exit(2);
      }
    }
  });
});
