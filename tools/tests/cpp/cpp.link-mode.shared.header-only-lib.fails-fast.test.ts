#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("cpp link_mode=shared rejects header-only targets", async () => {
  await runInTemp("cpp-link-mode-shared-headers", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "tools", "nix", "langs.json"),
      JSON.stringify({ enabled: ["cpp"] }, null, 2) + "\n",
      "utf8",
    );

    await fs.outputFile(
      path.join(tmp, "libs", "headers", "include", "headers.h"),
      ["#pragma once", "inline int header_only() { return 1; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "headers", "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_headers")',
        "",
        "nix_cpp_headers(",
        '  name = "headers",',
        '  srcs = ["include/headers.h"],',
        '  link_mode = "shared",',
        '  labels = ["lang:cpp", "kind:headers"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const exportRes = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    if (exportRes.exitCode !== 0) {
      const err = String(exportRes.stderr || exportRes.stdout || "");
      assert.ok(
        err.includes('link_mode="shared"') && err.includes("header-only"),
        `expected link_mode=shared header-only error; got:\n${err}`,
      );
      return;
    }

    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, BUCK_TARGET: "//libs/headers:headers" },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    assert.notEqual(build.exitCode, 0, "expected header-only link_mode=shared to fail");
    const err = String(build.stderr || build.stdout || "");
    assert.ok(
      err.includes("link_mode=shared") && err.includes("header-only"),
      `expected link_mode=shared header-only error; got:\n${err}`,
    );
  });
});
