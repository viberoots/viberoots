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

async function writeBrowserProducerTarget(pkgDir: string) {
  await fsp.mkdir(pkgDir, { recursive: true });
  await fsp.writeFile(path.join(pkgDir, "rust_bg.wasm"), "\0asm\x01\0\0\0", "binary");
  await fsp.writeFile(
    path.join(pkgDir, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      "genrule(",
      '  name = "browser",',
      '  srcs = ["rust_bg.wasm"],',
      '  out = "rust.browser",',
      '  cmd = "mkdir -p $OUT && cp $SRCS $OUT/rust_bg.wasm",',
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
      "\0asm\x01\0\0\0",
    );
    await writeProducerTarget(
      path.join(tmp, "projects", "libs", "demo-cpp-wasm"),
      "cpp_wasm",
      "cpp_emscripten.wasm",
      "\0asm\x01\0\0\0",
    );
    await writeProducerTarget(
      path.join(tmp, "projects", "libs", "demo-py-wasm"),
      "py_wasm",
      "pyext.wasm",
      "\0asm\x01\0\0\0",
    );
    await writeBrowserProducerTarget(path.join(tmp, "projects", "libs", "demo-rust-wasm"));

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "export_file")',
        'load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module")',
        "",
        'export_file(name = "index", src = "index.html")',
        "",
        "node_wasm_inline_module(",
        '  name = "go_inline",',
        '  src = "//projects/libs/demo-go-wasm:wasm",',
        '  out = "go-inline.js",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "node_wasm_inline_module(",
        '  name = "rust_inline",',
        '  src = "//projects/libs/demo-rust-wasm:browser",',
        '  artifact_name = "rust_bg.wasm",',
        '  out = "rust-inline.js",',
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
        '  app = ":index",',
        "  assets = [",
        '    {"src": ":go_inline", "output_path": "go-inline.js", "dest": "wasm-inline/go.js"},',
        '    {"src": ":cpp_inline", "output_path": "cpp-inline.js", "dest": "wasm-inline/cpp.js"},',
        '    {"src": ":py_inline", "output_path": "py-inline.js", "dest": "wasm-inline/py.js"},',
        '    {"src": ":rust_inline", "output_path": "rust-inline.js", "dest": "wasm-inline/rust.js"},',
        '    {"src": "//projects/libs/demo-rust-wasm:browser", "dest": "wasm/rust.wasm", "artifact_name": "rust_bg.wasm"},',
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
    await fsp.access(path.join(absOut, "wasm-inline", "rust.js"));
    assert.equal(
      (await fsp.readFile(path.join(absOut, "wasm", "rust.wasm"))).subarray(0, 4).toString("hex"),
      "0061736d",
    );
    const manifest = JSON.parse(
      await fsp.readFile(path.join(absOut, "asset-manifest.json"), "utf8"),
    );
    assert.equal(manifest.schemaVersion, "viberoots.node-wasm-assets.v1");
    assert.equal(manifest.assets.length, 1);
    assert.equal(manifest.assets[0]?.destination, "wasm/rust.wasm");
    assert.equal(manifest.assets[0]?.declaredSource, "//projects/libs/demo-rust-wasm:browser");
    assert.deepEqual(
      manifest.assets.map((asset: { destination: string }) => asset.destination),
      ["wasm/rust.wasm"],
      "raw inline JavaScript assets must not be recorded as WASM",
    );
    for (const asset of manifest.assets) {
      assert.match(asset.resolvedSource, /^buck:.*#sha256-[a-f0-9]{64}$/);
      assert.doesNotMatch(asset.resolvedSource, /buck-out|viberoots-test-tmp|workspace-/);
    }
  });
});
