#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp: nix_cpp_test rejects invalid link_closure_overrides (fails fast)", async () => {
  await runInTemp("cpp-test-link-closure-overrides-invalid", async (tmp, $) => {
    const supportDir = path.join(tmp, "projects", "libs", "support");
    await fsp.mkdir(path.join(supportDir, "src"), { recursive: true });
    await fsp.writeFile(
      path.join(supportDir, "src", "support.cpp"),
      "int support_answer() { return 42; }\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(supportDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "support",',
        '  srcs = ["src/support.cpp"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        '  visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "src", "demo_test.cpp"),
      "int main(){return 0;}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_test")',
        "",
        "nix_cpp_test(",
        '  name = "demo_test",',
        '  srcs = ["src/demo_test.cpp"],',
        "  link_deps = [],",
        "  link_closure_overrides = {",
        '    "//projects/libs/support:support": "transitive",',
        "  },",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 test --target-platforms //:no_cgo //projects/apps/demo:demo_test`;
    if (res.exitCode === 0) {
      assert.fail("expected buck2 test to fail due to invalid link_closure_overrides");
    }
    const err = String(res.stderr || "");
    assert.ok(
      err.includes("link_closure_overrides keys must be present in link_deps"),
      "expected link_closure_overrides validation error",
    );
    assert.ok(
      err.includes("//projects/libs/support:support"),
      "expected missing dep label in error",
    );
  });
});
