#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("third_party/providers/defs_cpp.bzl defines nix_cxx_library stamp", async () => {
  await runInTemp("providers-defs-cpp", async (tmp, $) => {
    const txt = await fsp.readFile("third_party/providers/defs_cpp.bzl", "utf8");
    if (!txt.includes("def nix_cxx_library(")) {
      console.error("missing nix_cxx_library definition");
      process.exit(2);
    }
    if (!txt.includes("genrule(")) {
      console.error("missing genrule in cpp provider def");
      process.exit(2);
    }
  });
});
