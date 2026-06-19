#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

test("python macros: nix_python_wasm_* targets use Nix-backed rules", async () => {
  await runInTemp("python-wasm-nix-build-rule-types", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "pywasm");
    await fs.mkdirp(path.join(appDir, "src"));
    await fs.mkdirp(path.join(appDir, "bin"));
    await fs.writeFile(path.join(appDir, "uv.lock"), "{}", "utf8");
    await fs.writeFile(path.join(appDir, "src", "main.py"), "print('ok')\n", "utf8");
    await fs.writeFile(path.join(appDir, "bin", "__main__.py"), "print('ok')\n", "utf8");
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/python:defs.bzl", "nix_python_wasm_app", "nix_python_wasm_lib")',
        "",
        'nix_python_wasm_lib(name = "pywasm_lib", srcs = glob(["src/**/*.py"]))',
        'nix_python_wasm_app(name = "pywasm_app", srcs = glob(["src/**/*.py", "bin/**/*.py"]), deps = [":pywasm_lib"])',
        "",
      ].join("\n"),
      "utf8",
    );

    const libProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("python_wasm_nix_build_rule_types")} cquery "kind(python_nix_wasm_build, //projects/apps/pywasm:pywasm_lib)"`;
    assert.ok(String(libProbe.stdout || "").includes("//projects/apps/pywasm:pywasm_lib"));

    const appProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("python_wasm_nix_build_rule_types")} cquery "kind(python_nix_wasm_build, //projects/apps/pywasm:pywasm_app)"`;
    assert.ok(String(appProbe.stdout || "").includes("//projects/apps/pywasm:pywasm_app"));

    const libBuck = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("python_wasm_nix_build_rule_types")} cquery "kind(python_library, //projects/apps/pywasm:pywasm_lib)"`;
    assert.equal(String(libBuck.stdout || "").trim(), "");

    const appBuck = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("python_wasm_nix_build_rule_types")} cquery "kind(python_library, //projects/apps/pywasm:pywasm_app)"`;
    assert.equal(String(appBuck.stdout || "").trim(), "");
  });
});
