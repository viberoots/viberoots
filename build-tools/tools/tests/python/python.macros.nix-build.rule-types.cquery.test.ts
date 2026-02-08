#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python macros: nix_python_* targets use Nix-backed rules", async () => {
  await runInTemp("python-nix-build-rule-types", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "pyapp");
    await fs.mkdirp(path.join(appDir, "src", "pyapp"));
    await fs.mkdirp(path.join(appDir, "tests"));
    await fs.mkdirp(path.join(appDir, "bin"));
    await fs.writeFile(path.join(appDir, "uv.lock"), "{}", "utf8");
    await fs.writeFile(path.join(appDir, "src", "pyapp", "__init__.py"), "value = 1\n", "utf8");
    await fs.writeFile(
      path.join(appDir, "tests", "test_basic.py"),
      "def test_basic():\n    assert True\n",
      "utf8",
    );
    await fs.writeFile(path.join(appDir, "bin", "__main__.py"), "print('ok')\n", "utf8");
    await fs.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/python:defs.bzl", "nix_python_binary", "nix_python_library", "nix_python_test")',
        "",
        'nix_python_library(name = "pyapp_lib", srcs = glob(["src/**/*.py"]))',
        'nix_python_binary(name = "pyapp", deps = [":pyapp_lib"], main = "bin/__main__.py")',
        'nix_python_test(name = "pyapp_test", srcs = glob(["tests/**/*.py", "bin/__main__.py"]), deps = [":pyapp_lib"])',
        "",
      ].join("\n"),
      "utf8",
    );

    const libProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir python_nix_build_rule_types cquery "kind(python_nix_build, //projects/apps/pyapp:pyapp_lib)"`;
    assert.ok(String(libProbe.stdout || "").includes("//projects/apps/pyapp:pyapp_lib"));

    const binProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir python_nix_build_rule_types cquery "kind(python_nix_build, //projects/apps/pyapp:pyapp)"`;
    assert.ok(String(binProbe.stdout || "").includes("//projects/apps/pyapp:pyapp"));

    const testProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir python_nix_build_rule_types cquery "kind(python_nix_test, //projects/apps/pyapp:pyapp_test)"`;
    assert.ok(String(testProbe.stdout || "").includes("//projects/apps/pyapp:pyapp_test"));

    const libBuck = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir python_nix_build_rule_types cquery "kind(python_library, //projects/apps/pyapp:pyapp_lib)"`;
    assert.equal(String(libBuck.stdout || "").trim(), "");

    const binBuck = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir python_nix_build_rule_types cquery "kind(python_binary, //projects/apps/pyapp:pyapp)"`;
    assert.equal(String(binBuck.stdout || "").trim(), "");

    const testBuck = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir python_nix_build_rule_types cquery "kind(python_test, //projects/apps/pyapp:pyapp_test)"`;
    assert.equal(String(testBuck.stdout || "").trim(), "");
  });
});
