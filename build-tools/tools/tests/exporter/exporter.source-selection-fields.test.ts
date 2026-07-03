#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { normalizeTargetLabel } from "../../lib/labels";
import { readGraph } from "../../lib/graph";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

function findNode(nodes: any[], label: string): any {
  const want = normalizeTargetLabel(label);
  const found = nodes.find((n) => normalizeTargetLabel(String(n?.name || "")) === want);
  assert.ok(found, `missing expected node ${want}`);
  return found;
}

function cqueryValues(stdout: unknown): Array<Record<string, unknown>> {
  const parsed = JSON.parse(String(stdout || "")) as unknown;
  return Array.isArray(parsed)
    ? (parsed as Array<Record<string, unknown>>)
    : (Object.values(parsed as Record<string, Record<string, unknown>>) as Array<
        Record<string, unknown>
      >);
}

async function cquerySourceSelectionAttrs(
  $: any,
  cwd: string,
  isolation: string,
  target: string,
): Promise<Record<string, unknown>> {
  const result = await $({
    cwd,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`buck2 --isolation-dir ${inheritedBuckIsolation(isolation)} cquery --target-platforms //:no_cgo --json --output-attribute nixpkgs_profile --output-attribute nixpkg_pins ${target}`;
  assert.equal(
    result.exitCode,
    0,
    `cquery failed for ${target}:\n${String(result.stderr || "")}\n${String(result.stdout || "")}`,
  );
  const values = cqueryValues(result.stdout);
  assert.equal(values.length, 1, `expected one cquery result for ${target}`);
  return values[0] || {};
}

test("exporter preserves default source-selection fields on Nix-backed C++ targets", async () => {
  await runInTemp("exporter-source-selection-fields", async (tmp, $) => {
    const pkgRel = "cpp/source_selection_fields";
    const pkg = path.join(tmp, pkgRel);
    await fs.mkdirp(pkg);
    await fs.outputFile(path.join(pkg, "lib.cc"), "int value() { return 1; }\n");
    await fs.outputFile(path.join(pkg, "lib_test.cc"), "int main() { return 0; }\n");
    await fs.outputFile(
      path.join(pkg, "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library", "nix_cpp_test")',
        "",
        "nix_cpp_library(",
        '    name = "lib",',
        '    srcs = ["lib.cc"],',
        '    nixpkg_deps = ["zlib"],',
        ")",
        "",
        "nix_cpp_test(",
        '    name = "lib_test",',
        '    srcs = ["lib_test.cc"],',
        '    deps = [":lib"],',
        '    nixpkg_deps = ["pkgs.zlib"],',
        ")",
        "",
        "nix_cpp_test(",
        '    name = "lib_profile_test",',
        '    srcs = ["lib_test.cc"],',
        '    deps = [":lib"],',
        '    nixpkg_deps = ["pkgs.zlib"],',
        '    nixpkgs_profile = "profile_cpp_planner",',
        ")",
        "",
      ].join("\n"),
    );

    const cqueryGraph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    const inlineGraph = path.join(tmp, ".viberoots/workspace/buck/inline-source-selection.json");
    await fs.mkdirp(path.dirname(cqueryGraph));

    await $({ cwd: tmp })`viberoots/build-tools/tools/buck/export-graph.ts --out ${cqueryGraph}`;
    await $({
      cwd: tmp,
    })`node viberoots/build-tools/tools/buck/export-inline.ts --target //${pkgRel}:lib --out ${inlineGraph}`;

    const cqueryNodes = await readGraph(cqueryGraph);
    const inlineNodes = await readGraph(inlineGraph);
    const lib = findNode(cqueryNodes, `//${pkgRel}:lib`);
    const planner = findNode(cqueryNodes, `//${pkgRel}:lib_test__planner`);
    const explicitProfilePlanner = findNode(cqueryNodes, `//${pkgRel}:lib_profile_test__planner`);
    const inlineLib = findNode(inlineNodes, `//${pkgRel}:lib`);

    for (const node of [lib, planner, inlineLib]) {
      assert.equal(node.nixpkgs_profile, "default");
      assert.deepEqual(node.nixpkg_pins, {});
    }
    assert.equal(explicitProfilePlanner.nixpkgs_profile, "profile_cpp_planner");
    assert.deepEqual(explicitProfilePlanner.nixpkg_pins, {});
    assert.deepEqual(
      {
        nixpkgs_profile: inlineLib.nixpkgs_profile,
        nixpkg_pins: inlineLib.nixpkg_pins,
      },
      {
        nixpkgs_profile: lib.nixpkgs_profile,
        nixpkg_pins: lib.nixpkg_pins,
      },
    );
  });
});

test("Python Nix-backed artifact macros pass source-selection attrs to their rules", async () => {
  await runInTemp("python-source-selection-rule-fields", async (tmp, $) => {
    const pkgRel = "projects/apps/python_source_selection";
    const pkg = path.join(tmp, pkgRel);
    await fs.mkdirp(path.join(pkg, "src"));
    await fs.mkdirp(path.join(pkg, "bin"));
    await fs.mkdirp(path.join(pkg, "native"));
    await fs.outputFile(
      path.join(pkg, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(path.join(pkg, "src", "__init__.py"), "value = 1\n", "utf8");
    await fs.outputFile(path.join(pkg, "src", "main.py"), "print('ok')\n", "utf8");
    await fs.outputFile(path.join(pkg, "bin", "__main__.py"), "print('ok')\n", "utf8");
    await fs.outputFile(path.join(pkg, "native", "ext.c"), "int x(){return 1;}\n", "utf8");
    await fs.outputFile(
      path.join(pkg, "TARGETS"),
      [
        'load("@viberoots//build-tools/python:defs.bzl", "nix_python_binary", "nix_python_library", "nix_python_wasm_app", "nix_python_wasm_extension_module", "nix_python_wasm_lib")',
        "",
        "nix_python_library(",
        '    name = "py_lib",',
        '    lockfile_label = "lockfile:projects/apps/python_source_selection/uv.lock#projects/apps/python_source_selection",',
        '    srcs = glob(["src/**/*.py"]),',
        '    nixpkg_deps = ["zlib"],',
        '    nixpkgs_profile = "profile_py_lib",',
        ")",
        "",
        "nix_python_binary(",
        '    name = "py_bin",',
        '    lockfile_label = "lockfile:projects/apps/python_source_selection/uv.lock#projects/apps/python_source_selection",',
        '    deps = [":py_lib"],',
        '    main = "bin/__main__.py",',
        '    nixpkg_deps = ["zlib"],',
        '    nixpkgs_profile = "profile_py_bin",',
        ")",
        "",
        "nix_python_wasm_lib(",
        '    name = "py_wasm_lib",',
        '    lockfile_label = "lockfile:projects/apps/python_source_selection/uv.lock#projects/apps/python_source_selection",',
        '    srcs = glob(["src/**/*.py"]),',
        '    nixpkg_deps = ["zlib"],',
        '    nixpkgs_profile = "profile_py_wasm_lib",',
        ")",
        "",
        "nix_python_wasm_app(",
        '    name = "py_wasm_app",',
        '    lockfile_label = "lockfile:projects/apps/python_source_selection/uv.lock#projects/apps/python_source_selection",',
        '    srcs = glob(["src/**/*.py", "bin/**/*.py"]),',
        '    deps = [":py_wasm_lib"],',
        '    nixpkg_deps = ["zlib"],',
        '    nixpkgs_profile = "profile_py_wasm_app",',
        ")",
        "",
        "nix_python_wasm_extension_module(",
        '    name = "py_ext",',
        '    lockfile_label = "lockfile:projects/apps/python_source_selection/uv.lock#projects/apps/python_source_selection",',
        '    labels = ["backend:wasi"],',
        '    module = "demo._native",',
        '    srcs = ["native/ext.c"],',
        '    nixpkgs_profile = "profile_py_ext",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const expectedProfiles = new Map([
      [`//${pkgRel}:py_lib`, "profile_py_lib"],
      [`//${pkgRel}:py_bin`, "profile_py_bin"],
      [`//${pkgRel}:py_wasm_lib`, "profile_py_wasm_lib"],
      [`//${pkgRel}:py_wasm_app`, "profile_py_wasm_app"],
      [`//${pkgRel}:py_ext`, "profile_py_ext"],
    ]);

    for (const [target, expectedProfile] of expectedProfiles) {
      const attrs = await cquerySourceSelectionAttrs(
        $,
        tmp,
        "python_source_selection_rule_fields",
        target,
      );
      assert.equal(attrs.nixpkgs_profile, expectedProfile);
      assert.deepEqual(attrs.nixpkg_pins, {});
    }
  });
});

test("Go binary auto-test package library preserves source-selection attrs", async () => {
  await runInTemp("go-binary-auto-test-source-selection", async (tmp, $) => {
    const pkgRel = "projects/apps/go_source_selection";
    const pkg = path.join(tmp, pkgRel);
    await fs.mkdirp(path.join(pkg, "cmd", "demo"));
    await fs.outputFile(
      path.join(pkg, "cmd", "demo", "main.go"),
      "package main\n\nfunc main(){}\n",
      "utf8",
    );
    await fs.outputFile(
      path.join(pkg, "cmd", "demo", "demo_test.go"),
      'package main\n\nimport "testing"\n\nfunc TestDemo(t *testing.T) {}\n',
      "utf8",
    );
    await fs.outputFile(
      path.join(pkg, "TARGETS"),
      [
        'load("@viberoots//build-tools/go:defs.bzl", "nix_go_binary")',
        "",
        "nix_go_binary(",
        '    name = "demo",',
        '    srcs = ["cmd/demo/main.go"],',
        '    nixpkg_deps = ["zlib"],',
        '    nixpkgs_profile = "profile_go_auto_pkg",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const binaryAttrs = await cquerySourceSelectionAttrs(
      $,
      tmp,
      "go_binary_auto_test_source_selection",
      `//${pkgRel}:demo`,
    );
    assert.equal(binaryAttrs.nixpkgs_profile, "profile_go_auto_pkg");
    assert.deepEqual(binaryAttrs.nixpkg_pins, {});

    const pkgAttrs = await cquerySourceSelectionAttrs(
      $,
      tmp,
      "go_binary_auto_test_source_selection",
      `//${pkgRel}:demo_pkg`,
    );
    assert.equal(pkgAttrs.nixpkgs_profile, "profile_go_auto_pkg");
    assert.deepEqual(pkgAttrs.nixpkg_pins, {});
  });
});

test("Buck analysis rejects malformed nixpkg pins and exports valid non-empty pins", async () => {
  await runInTemp("exporter-source-selection-pin-validation", async (tmp, $) => {
    const malformedPkgRel = "cpp/source_selection_pin_malformed";
    const validPkgRel = "cpp/source_selection_pin_valid";
    const malformedPkg = path.join(tmp, malformedPkgRel);
    const validPkg = path.join(tmp, validPkgRel);
    await fs.mkdirp(malformedPkg);
    await fs.mkdirp(validPkg);
    await fs.outputFile(path.join(malformedPkg, "lib.cc"), "int value() { return 1; }\n");
    await fs.outputFile(path.join(validPkg, "lib.cc"), "int value() { return 1; }\n");
    await fs.outputFile(
      path.join(malformedPkg, "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '    name = "missing_rationale",',
        '    srcs = ["lib.cc"],',
        '    nixpkg_deps = ["zlib"],',
        "    nixpkg_pins = {",
        '        "zlib": {',
        '            "nixpkgs_profile": "default",',
        "        },",
        "    },",
        ")",
        "",
      ].join("\n"),
    );
    await fs.outputFile(
      path.join(validPkg, "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '    name = "non_empty_pin",',
        '    srcs = ["lib.cc"],',
        '    nixpkg_deps = ["zlib"],',
        "    nixpkg_pins = {",
        '        "zlib": {',
        '            "nixpkgs_profile": "default",',
        '            "rationale": "Temporary compatibility check.",',
        "        },",
        "    },",
        ")",
        "",
      ].join("\n"),
    );

    const malformed = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms prelude//platforms:default //${malformedPkgRel}:missing_rationale`.nothrow();
    assert.notEqual(malformed.exitCode, 0);
    assert.match(
      `${String(malformed.stderr || "")}\n${String(malformed.stdout || "")}`,
      /nixpkg_pins\[pkgs\.zlib\]\.rationale/,
    );

    const attrs = await cquerySourceSelectionAttrs(
      $,
      tmp,
      "exporter-pin-non-empty",
      `//${validPkgRel}:non_empty_pin`,
    );
    assert.deepEqual(attrs.nixpkg_pins, {
      "pkgs.zlib": {
        nixpkgs_profile: "default",
        rationale: "Temporary compatibility check.",
      },
    });
  });
});
