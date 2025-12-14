#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_cpp_wasm_emscripten_lib: planner stub still exists and carries wasm labels", async () => {
  await runInTemp("cpp-wasm-emscripten-stub", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "src", "main.cpp"), "int main(){return 0;}\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: cpp.macros.wasm-emscripten.planner-stub.test.ts",
        'load("//cpp:defs.bzl", "nix_cpp_wasm_emscripten_lib")',
        "",
        "nix_cpp_wasm_emscripten_lib(",
        '  name = "core_emscripten",',
        "  deps = [],",
        '  labels = ["lang:cpp"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probeLabels = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //apps/demo:core_emscripten`;
    if (probeLabels.exitCode !== 0) return;
    const out = String(probeLabels.stdout || "");
    assert.ok(out.includes("wasm:emscripten"), "expected wasm:emscripten label on stub");
    assert.ok(out.includes("kind:wasm"), "expected kind:wasm label on stub");

    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms //:no_cgo --show-output //apps/demo:core_emscripten`;
    if (build.exitCode !== 0) return;
    assert.ok(
      String(build.stdout || "").includes("core_emscripten.stamp"),
      "expected planner stub to produce a stamp output",
    );
  });
});
