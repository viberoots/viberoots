#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { $ } from "zx";

const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const read = (relative: string) => fsp.readFile(path.join(sourceRoot, relative), "utf8");

test("tauri_app exports app identity and declared desktop inputs", async () => {
  const target = "//build-tools/tools/tests/fixtures/rust-tauri-app:desktop";
  const result = await $({ cwd: sourceRoot, stdio: "pipe" })`
    buck2 uquery --json \
      --output-attribute labels --output-attribute frontend_dist \
      --output-attribute tauri_config --output-attribute tauri_platform \
      --output-attribute tauri_root --output-attribute cargo_root \
      --output-attribute cargo_manifest --output-attribute cargo_lock \
      --output-attribute resources \
      --output-attribute resource_sources --output-attribute resource_destinations \
      --output-attribute capabilities --output-attribute permissions --output-attribute icons \
      --output-attribute sidecar_deps --output-attribute sidecar_destinations \
      --output-attribute app_commands --output-attribute app_windows --output-attribute srcs \
      ${target}
  `;
  const contract = String(result.stdout);
  for (const expected of [
    "kind:app",
    "app:tauri",
    "platform:aarch64-darwin",
    '"tauri_root": "."',
    '"cargo_root": "build-tools/tools/tests/fixtures/rust-tauri-app"',
    "rust-tauri-app/Cargo.toml",
    "rust-tauri-app/Cargo.lock",
    "tauri.conf.json",
    "capabilities/default.json",
    "icons/icon.png",
    "help.txt",
    "help/help.txt",
    "bin/sidecar",
    "frontend",
    "sidecar",
  ]) {
    assert.match(contract, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(contract, /kind:tauri/);
});

test("tauri_app admits only the bounded src-tauri ownership layout", async () => {
  const result = await $({ cwd: sourceRoot, stdio: "pipe" })`
    buck2 uquery --json \
      --output-attribute tauri_root --output-attribute cargo_root \
      --output-attribute cargo_manifest --output-attribute cargo_lock \
      --output-attribute tauri_config \
      //build-tools/tools/tests/fixtures/rust-tauri-app:desktop_src_tauri
  `;
  const contract = String(result.stdout);
  for (const expected of [
    '"tauri_root": "src-tauri"',
    "rust-tauri-app/src-tauri",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
  ]) {
    assert.match(contract, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("tauri_app rejects unsupported platform and direct native links during analysis", async () => {
  for (const [target, expected] of [
    [
      "//build-tools/tools/tests/fixtures/rust-tauri-invalid-platform:desktop",
      "only aarch64-darwin",
    ],
    [
      "//build-tools/tools/tests/fixtures/rust-tauri-invalid-link:desktop",
      "native link_deps/header_deps are private bridge wiring",
    ],
    [
      "//build-tools/tools/tests/fixtures/rust-tauri-invalid-mapping:desktop",
      "resources dest must remain package-relative",
    ],
    [
      "//build-tools/tools/tests/fixtures/rust-tauri-invalid-command:desktop",
      "app_commands must use a conservative identifier grammar",
    ],
  ]) {
    const result = await $({
      cwd: sourceRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 uquery ${target}`;
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr || result.stdout), new RegExp(expected));
  }
});

test("Tauri planner owns frontend, policy, platform, and local signature contracts", async () => {
  const [contract, planner, composition, template, nixBuild, graph, manifest] = await Promise.all([
    read("build-tools/rust/private/tauri_contract.bzl"),
    read("build-tools/tools/nix/planner/rust-tauri.nix"),
    read("build-tools/tools/nix/planner/rust-composition.nix"),
    read("build-tools/tools/nix/templates/rust-tauri.nix"),
    read("build-tools/rust/private/nix_build.bzl"),
    read("build-tools/tools/nix/graph-generator.nix"),
    read("build-tools/tools/nix/planner/manifest.nix"),
  ]);
  assert.match(contract, /app:tauri/);
  assert.match(contract, /platform:aarch64-darwin/);
  assert.doesNotMatch(contract, /wasm_deps/);
  assert.match(planner, /webapp:static/);
  assert.match(planner, /selectedSystem != platform/);
  assert.match(composition, /\[ "runtime_deps" "sidecar_deps" \]/);
  assert.match(template, /beforeBuildCommand == null/);
  assert.match(template, /beforeDevCommand == null/);
  assert.match(template, /CARGO_NET_OFFLINE=true/);
  assert.match(template, /pkgs\.rcodesign/);
  assert.match(template, /ADHOC/);
  assert.match(template, /mode:"adhoc-platform"/);
  assert.match(template, /pkgs\.cargo-tauri/);
  assert.match(template, /withGlobalTauri == false/);
  assert.match(template, /appCommands/);
  assert.match(template, /appWindows/);
  assert.match(nixBuild, /action_timeout_sec = 1200 if kind == "tauri" else 600/);
  assert.match(
    nixBuild,
    /nix_cmd_prefix\(timeout_var = "TIMEOUT", timeout_sec = action_timeout_sec,/,
  );
  assert.match(nixBuild, /bounded %s action timed out after %ss/);
  assert.match(nixBuild, /timeout-wrapper termination, not user input/);
  assert.doesNotMatch(nixBuild, /nix_cmd_prefix\([^)]*timeout_sec = 0/);
  assert.match(graph, /mkTauri/);
  assert.match(manifest, /desktop-app/);
  assert.match(manifest, /viberoots-tauri-dev/);

  const fixture = path.join(sourceRoot, "build-tools/tools/tests/fixtures/rust-tauri-app");
  const plannerPath = path.join(sourceRoot, "build-tools/tools/nix/planner/rust-tauri.nix");
  const expression = `
    let
      owner = {
        frontend_dist = "frontend";
        sidecar_deps = [ "sidecar" ];
        tauri_platform = "aarch64-darwin";
        tauri_root = ".";
        tauri_config = "tauri.conf.json";
        resources = [ "help.txt" ];
        resource_sources = [ "help.txt" ];
        resource_destinations = [ "help/help.txt" ];
        capabilities = [ "capabilities/default.json" ];
        permissions = [];
        icons = [ "icons/icon.png" ];
        sidecar_destinations = [ "bin/sidecar" ];
        app_commands = [];
        app_windows = [ "main" ];
      };
      frontend = { labels = [ "lang:node" "kind:app" "webapp:static" ]; };
      sidecar = { labels = [ "kind:bin" "sidecar:reviewed" ]; module_surface = ""; };
      nodeFor = name: if name == "owner" then owner else if name == "frontend" then frontend else sidecar;
      ctx = {
        get = node: field: if builtins.hasAttr field node then node.\${field} else null;
        repoRootStr = ${JSON.stringify(sourceRoot)};
        dependencyArtifactOf = _: builtins.toPath ${JSON.stringify(fixture)};
      };
      P = { cleanLabel = value: value; labelsOf = node: node.labels; };
      tauri = import (builtins.toPath ${JSON.stringify(plannerPath)}) {
        lib = { imap0 = f: values: builtins.genList (index: f index (builtins.elemAt values index)) (builtins.length values); };
        inherit P ctx nodeFor;
        normalizeList = _: value: value;
        sourcePath = _: relative: ${JSON.stringify("build-tools/tools/tests/fixtures/rust-tauri-app")} + "/" + relative;
      };
    in tauri.contractFor "owner" "aarch64-darwin"
  `;
  const evaluated = await $({ cwd: sourceRoot, stdio: "pipe" })`
    nix eval --impure --json --expr ${expression}
  `;
  const result = JSON.parse(String(evaluated.stdout)) as {
    platform: string;
    resources: Array<{ source: string; destination: string }>;
    capabilities: string[];
    icons: string[];
    sidecars: Array<{ label: string; destination: string }>;
  };
  assert.equal(result.platform, "aarch64-darwin");
  assert.equal(result.resources.length, 1);
  assert.deepEqual(result.resources[0], {
    path: path.join(fixture, "help.txt"),
    source: "help.txt",
    destination: "help/help.txt",
  });
  assert.equal(result.capabilities.length, 1);
  assert.equal(result.icons.length, 1);
  assert.deepEqual(
    result.sidecars.map((item) => item.label),
    ["sidecar"],
  );
  assert.equal(result.sidecars[0]?.destination, "bin/sidecar");
});
