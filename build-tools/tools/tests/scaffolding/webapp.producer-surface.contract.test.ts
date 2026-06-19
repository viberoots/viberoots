#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function writeTarget(dir: string, body: string) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "TARGETS"), body, "utf8");
}

test("producer surfaces expose deterministic contract attrs", async () => {
  await runInTemp("webapp-producer-surface-contract", async (tmp, $) => {
    await writeTarget(
      path.join(tmp, "projects", "libs", "go-wasm"),
      [
        'load("@viberoots//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")',
        "",
        'nix_go_tiny_wasm_lib(name = "wasm", go_source_roots = ["src/producer"])',
        "",
      ].join("\n"),
    );
    await writeTarget(
      path.join(tmp, "projects", "libs", "cpp-wasm"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_wasm_static_lib")',
        "",
        'nix_cpp_wasm_static_lib(name = "core", cpp_source_roots = ["src/producer"])',
        "",
      ].join("\n"),
    );
    await fsp.mkdir(path.join(tmp, "projects", "libs", "py-wasm"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "projects", "libs", "py-wasm", "uv.lock"),
      "# lock\n",
      "utf8",
    );
    await writeTarget(
      path.join(tmp, "projects", "libs", "py-wasm"),
      [
        'load("@viberoots//build-tools/python:defs.bzl", "nix_python_wasm_app", "nix_python_wasm_lib")',
        "",
        "nix_python_wasm_app(",
        '  name = "app",',
        '  lockfile_label = "lockfile:projects/libs/py-wasm/uv.lock#projects/libs/py-wasm",',
        '  python_source_roots = ["src/producer"],',
        ")",
        "nix_python_wasm_lib(",
        '  name = "lib",',
        '  lockfile_label = "lockfile:projects/libs/py-wasm/uv.lock#projects/libs/py-wasm",',
        '  python_source_roots = ["src/runtime"],',
        ")",
        "",
      ].join("\n"),
    );
    await fsp.mkdir(path.join(tmp, "projects", "libs", "ts-lib"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "projects", "libs", "ts-lib", "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
    );
    await writeTarget(
      path.join(tmp, "projects", "libs", "ts-lib"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_lib")',
        "",
        'nix_node_lib(name = "lib", cmd = "echo hi > $OUT", out = "lib.stamp", ts_module_roots = ["src/modules"])',
        "",
      ].join("\n"),
    );
    await fsp.mkdir(path.join(tmp, "projects", "apps", "web"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "projects", "apps", "web", "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
    );
    await fsp.writeFile(path.join(tmp, "projects", "apps", "web", "index.html"), "<html></html>\n");
    await writeTarget(
      path.join(tmp, "projects", "apps", "web"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "node_webapp", "node_asset_stage")',
        "",
        'node_webapp(name = "app_raw", ts_module_roots = ["src/ts-modules"])',
        "node_asset_stage(",
        '  name = "app",',
        '  app = "index.html",',
        '  wasm_module_roots = ["src/wasm-producer"],',
        '  labels = ["framework:vite"],',
        ")",
        "",
      ].join("\n"),
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute module_kind --output-attribute source_roots --output-attribute artifact_mapping_policy --output-attribute watch_hints "set(//projects/libs/go-wasm:wasm__surface //projects/libs/cpp-wasm:core__surface //projects/libs/py-wasm:app__surface //projects/libs/py-wasm:lib__surface //projects/libs/ts-lib:lib__surface //projects/apps/web:app_raw__ts_surface //projects/apps/web:app__wasm_surface)"`;
    assert.equal(
      probe.exitCode,
      0,
      `buck2 producer-surface probe failed:\n${String(probe.stdout || "")}\n${String(probe.stderr || "")}`,
    );
    const out = String(probe.stdout || "");
    assert.match(out, /"module_kind"\s*:\s*"wasm"/);
    assert.match(out, /"module_kind"\s*:\s*"ts"/);
    assert.match(out, /"artifact_mapping_policy"\s*:\s*"go-tiny-wasm-v1"/);
    assert.match(out, /"artifact_mapping_policy"\s*:\s*"cpp-static-wasm-v1"/);
    assert.match(out, /"artifact_mapping_policy"\s*:\s*"python-wasm-app-v1"/);
    assert.match(out, /"artifact_mapping_policy"\s*:\s*"python-wasm-lib-v1"/);
    assert.match(out, /"source_roots"\s*:\s*\[\s*"src\/ts-modules"/);
    assert.match(out, /"source_roots"\s*:\s*\[\s*"src\/wasm-producer"/);
  });
});
