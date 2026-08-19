#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  applyTauriScaffoldAnswers,
  tauriBundleIdentifier,
} from "../../scaffolding/scaf/commands/tauri-validation";
import { runInTemp } from "../lib/test-helpers";

const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const read = (relative: string) => fsp.readFile(path.join(sourceRoot, relative), "utf8");

test("Tauri scaffold has managed locks and no hidden frontend command hook", async () => {
  const root = "build-tools/tools/scaffolding/templates/rust/tauri-app";
  const [
    targets,
    buildScript,
    cargo,
    cargoLock,
    copier,
    config,
    frontend,
    icon,
    packageJSON,
    pnpmLock,
    sidecar,
    viteConfig,
  ] = await Promise.all([
    read(`${root}/TARGETS.jinja`),
    read(`${root}/build.rs.jinja`),
    read(`${root}/Cargo.toml.jinja`),
    read(`${root}/Cargo.lock.jinja`),
    read(`${root}/copier.yaml`),
    read(`${root}/tauri.conf.json.jinja`),
    read(`${root}/frontend/src/main.js.jinja`),
    fsp.readFile(path.join(sourceRoot, root, "icons/icon.png")),
    read(`${root}/package.json.jinja`),
    read(`${root}/pnpm-lock.yaml.jinja`),
    read(`${root}/sidecar.c.jinja`),
    read(`${root}/vite.config.mjs.jinja`),
  ]);
  assert.match(targets, /node_asset_stage\(/);
  assert.match(targets, /enable_mobile_scaffold_targets/);
  assert.match(targets, /mobile scaffold targets are disabled/);
  assert.match(targets, /tauri_ios_app\(/);
  assert.match(targets, /ios_bundle_identifier/);
  assert.match(targets, /tauri_android_app\(/);
  assert.match(targets, /android_min_sdk/);
  assert.match(targets, /android_compile_sdk/);
  assert.match(copier, /include_mobile_release_placeholders: false/);
  assert.match(targets, /tauri-mobile:release-placeholder/);
  assert.match(targets, /frontend_dist = ":frontend"/);
  assert.match(targets, /rust_test\(/);
  assert.match(targets, /name = "\{\{ name \}\}-test"/);
  assert.match(targets, /srcs = \["src\/lib\.rs"\]/);
  assert.match(targets, /srcs = \["build\.rs", "src\/lib\.rs", "src\/main\.rs"\]/);
  assert.match(targets, /default_features = False/);
  assert.match(targets, /resources = \[\{"src": "help\.txt", "dest": "help\/help\.txt"\}\]/);
  assert.match(targets, /sidecar_deps = \[\{"src": ":\{\{ name \}\}-sidecar"/);
  assert.match(targets, /nix_cpp_binary\(/);
  assert.match(targets, /labels = \["sidecar:reviewed"\]/);
  assert.match(sidecar, /int main\(void\)/);
  assert.match(
    cargo,
    /\[\[bin\]\][\s\S]*test = false[\s\S]*bench = false[\s\S]*required-features = \["desktop"\]/,
  );
  assert.match(cargo, /\[lib\]\ncrate-type = \["cdylib", "rlib"\]/);
  assert.match(cargo, /\[features\]\ndefault = \["desktop"\]\ndesktop = \["dep:tauri"\]/);
  assert.match(cargo, /\[build-dependencies\]/);
  assert.match(cargo, /tauri = \{ version = "=2\.7\.0"[\s\S]*optional = true/);
  assert.match(buildScript, /var\("TARGET"\)[\s\S]*starts_with\("wasm32-"\)/);
  assert.match(cargoLock, /name = "\{\{ name \}\}"\nversion = "0\.1\.0"/);
  assert.doesNotMatch(cargoLock, /name = "obsolete_tauri_lock"/);
  assert.match(cargoLock, /name = "tauri"\nversion = "2\.7\.0"/);
  const tauriFamily = [
    "tauri",
    "tauri-build",
    "tauri-codegen",
    "tauri-macros",
    "tauri-runtime",
    "tauri-runtime-wry",
    "tauri-utils",
    "wry",
  ];
  const lockedTauriFamily = [
    ...cargoLock.matchAll(/^\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/gm),
  ]
    .filter((match) => tauriFamily.includes(match[1] || ""))
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(lockedTauriFamily, [
    ["tauri", "2.7.0"],
    ["tauri-build", "2.3.1"],
    ["tauri-codegen", "2.3.1"],
    ["tauri-macros", "2.3.2"],
    ["tauri-runtime", "2.7.1"],
    ["tauri-runtime-wry", "2.7.2"],
    ["tauri-utils", "2.6.0"],
    ["wry", "0.52.1"],
  ]);
  assert.ok(cargoLock.split("\n").length > 4_000);
  assert.doesNotMatch(config, /beforeBuildCommand|beforeDevCommand/);
  assert.match(config, /"identifier": "\{\{ tauri_identifier \}\}"/);
  assert.match(config, /"withGlobalTauri": false/);
  assert.match(frontend, /@tauri-apps\/api\/window/);
  assert.equal(icon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(icon.readUInt32BE(16), 32);
  assert.equal(icon.readUInt32BE(20), 32);
  assert.equal(icon[25], 6);
  assert.match(packageJSON, /"vite": "5\.4\.10"/);
  assert.match(packageJSON, /"@tauri-apps\/api": "2\.7\.0"/);
  assert.match(pnpmLock, /lockfileVersion: "9\.0"/);
  assert.match(pnpmLock, /importers:\n\s+\.:/);
  assert.match(pnpmLock, /"@tauri-apps\/api":\n\s+specifier: 2\.7\.0\n\s+version: 2\.7\.0/);
  assert.match(pnpmLock, /vite:\n\s+specifier: 5\.4\.10\n\s+version: 5\.4\.10/);
  assert.match(targets, /name = "frontend_wasm"[\s\S]*default_features = False/);
  assert.match(buildScript, /CARGO_FEATURE_DESKTOP/);
  assert.match(viteConfig, /root: "frontend"/);
  assert.doesNotMatch(viteConfig, /process\.env|command|spawn|exec/);
});

test("Tauri scaffold renders desktop-only TARGETS by default", async () => {
  await runInTemp("tauri-scaffold-desktop-only", async (tmp, $) => {
    await $({ cwd: tmp })`scaf new rust tauri-app tauri_demo --yes`;
    const targets = await fsp.readFile(path.join(tmp, "projects/apps/tauri_demo/TARGETS"), "utf8");
    const loadLines = targets.split("\n").filter((line) => line.startsWith("load("));
    assert.deepEqual(loadLines, [
      'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary")',
      'load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_webapp")',
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_test", "rust_wasm_library", "tauri_app")',
    ]);
    assert.match(targets, /tauri_app\(/);
    assert.match(targets, /name = "tauri_demo"/);
    assert.doesNotMatch(targets, /load\("@prelude\/\/:rules\.bzl", "filegroup"\)/);
    assert.doesNotMatch(targets, /tauri_ios_app"/);
    assert.doesNotMatch(targets, /tauri_android_app"/);
    assert.doesNotMatch(targets, /tauri_ios_app\(/);
    assert.doesNotMatch(targets, /tauri_android_app\(/);
    assert.doesNotMatch(targets, /tauri-mobile:release-placeholder/);
  });
});

test("Tauri scaffold mobile opt-in fails with disabled platform diagnostic", async () => {
  await runInTemp("tauri-scaffold-mobile-disabled", async (tmp, $) => {
    await $({ cwd: tmp })`
      scaf new rust tauri-app tauri_demo --yes --targets=ios,android \
        --enable_mobile_scaffold_targets=true --include_mobile_release_placeholders=true
    `;
    const targets = await fsp.readFile(path.join(tmp, "projects/apps/tauri_demo/TARGETS"), "utf8");
    assert.match(targets, /tauri_ios_app\(/);
    assert.match(targets, /tauri_android_app\(/);
    assert.match(targets, /tauri-mobile:release-placeholder/);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build --target-platforms //:no_cgo //projects/apps/tauri_demo:tauri_demo_ios`;
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr || result.stdout), /platform-not-enabled/);
  });
});

test("Tauri scaffold mobile request fails closed when feature gate is off", async () => {
  await runInTemp("tauri-scaffold-mobile-gate-off", async (tmp, $) => {
    await $({ cwd: tmp })`scaf new rust tauri-app tauri_demo --yes --targets=ios`;
    const targets = await fsp.readFile(path.join(tmp, "projects/apps/tauri_demo/TARGETS"), "utf8");
    assert.match(targets, /mobile scaffold targets are disabled/);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo //projects/apps/tauri_demo:tauri_demo`;
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr || result.stdout), /mobile scaffold targets are disabled/);
  });
});

test("Tauri scaffold owns one valid reverse-DNS bundle identifier", () => {
  assert.equal(tauriBundleIdentifier("Desktop_App"), "dev.viberoots.desktop-app");
  assert.equal(tauriBundleIdentifier(" Desktop.App "), "dev.viberoots.desktop-app");
  assert.throws(() => tauriBundleIdentifier("___"), /ASCII letter or digit/);
  assert.throws(
    () => tauriBundleIdentifier("a".repeat(64)),
    /invalid or ambiguous reverse-DNS segment/,
  );

  const answers: Record<string, any> = { name: "tauri_smoke_app" };
  applyTauriScaffoldAnswers("rust", "tauri-app", answers);
  assert.equal(answers.tauri_identifier, "dev.viberoots.tauri-smoke-app");
  const unrelated: Record<string, any> = { name: "tauri_smoke_app" };
  applyTauriScaffoldAnswers("rust", "cli", unrelated);
  assert.equal(unrelated.tauri_identifier, undefined);
});
