#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function writeProducerTarget(
  pkgDir: string,
  targetName: string,
  outputName: string,
  payload: string,
) {
  await fsp.mkdir(pkgDir, { recursive: true });
  await fsp.writeFile(path.join(pkgDir, outputName), payload, "utf8");
  await fsp.writeFile(
    path.join(pkgDir, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      "",
      "genrule(",
      `  name = "${targetName}",`,
      `  srcs = ["${outputName}"],`,
      `  out = "${outputName}",`,
      '  cmd = "cp $SRCS $OUT",',
      '  visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
}

test("node wasm stage/inline works with mixed producer labels", async () => {
  await runInTemp("node-wasm-mixed-producer-labels", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(appDir, "index.html"), "<html></html>\n", "utf8");

    await writeProducerTarget(
      path.join(tmp, "projects", "libs", "demo-go-wasm"),
      "wasm",
      "top.wasm",
      "go-wasm",
    );
    await writeProducerTarget(
      path.join(tmp, "projects", "libs", "demo-cpp-wasm"),
      "cpp_wasm",
      "cpp_emscripten.wasm",
      "cpp-wasm",
    );
    await writeProducerTarget(
      path.join(tmp, "projects", "libs", "demo-py-wasm"),
      "py_wasm",
      "pyext.wasm",
      "py-wasm",
    );

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module")',
        "",
        "node_wasm_inline_module(",
        '  name = "go_inline",',
        '  src = "//projects/libs/demo-go-wasm:wasm",',
        '  out = "go-inline.js",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "node_wasm_inline_module(",
        '  name = "cpp_inline",',
        '  src = "//projects/libs/demo-cpp-wasm:cpp_wasm",',
        '  out = "cpp-inline.js",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "node_wasm_inline_module(",
        '  name = "py_inline",',
        '  src = "//projects/libs/demo-py-wasm:py_wasm",',
        '  out = "py-inline.js",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "node_asset_stage(",
        '  name = "staged",',
        '  app = "index.html",',
        "  assets = [",
        '    {"src": ":go_inline", "dest": "wasm-inline/go.js"},',
        '    {"src": ":cpp_inline", "dest": "wasm-inline/cpp.js"},',
        '    {"src": ":py_inline", "dest": "wasm-inline/py.js"},',
        "  ],",
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms prelude//platforms:default --show-output //projects/apps/web:staged`;
    assert.equal(build.exitCode, 0, String(build.stderr || build.stdout || ""));

    const outText = String(build.stdout || build.stderr || "").trim();
    const outLine = outText.split(/\n+/).pop() || "";
    const outPath = outLine.split(/\s+/).pop() || "";
    assert.ok(outPath, "expected staged output path");
    const absOut = path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);

    await fsp.access(path.join(absOut, "wasm-inline", "go.js"));
    await fsp.access(path.join(absOut, "wasm-inline", "cpp.js"));
    await fsp.access(path.join(absOut, "wasm-inline", "py.js"));
  });
});
