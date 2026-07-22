#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("hidden providers/defs_cpp.bzl defines nix_cxx_library and nix_cxx_provider", async () => {
  await runInTemp("providers-defs-cpp", async (tmp, $) => {
    const txt = await fsp.readFile(
      path.join(tmp, ".viberoots/workspace/providers/defs_cpp.bzl"),
      "utf8",
    );
    if (!txt.includes("def nix_cxx_library(")) {
      console.error("missing nix_cxx_library definition");
      process.exit(2);
    }
    if (!txt.includes("def nix_cxx_provider(")) {
      console.error("missing nix_cxx_provider in cpp provider defs");
      process.exit(2);
    }
    if (!txt.includes('visibility = ["PUBLIC"]')) {
      console.error("C++ provider targets are not visible across workspace cells");
      process.exit(2);
    }
    if (txt.includes('visibility = ["//visibility:public"]')) {
      console.error("C++ provider visibility is cell-relative instead of public");
      process.exit(2);
    }
  });
});
